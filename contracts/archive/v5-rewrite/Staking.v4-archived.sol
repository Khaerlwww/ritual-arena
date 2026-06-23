// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IArenaAP {
    function awardAP(address wallet, uint256 amount, string calldata reason) external;
}

/// @title Ritual Staking — Fixed-Rate AP Generation
/// @notice Flat 50 AP per RITUAL per day. 14-day lock. No tiers, no brackets, no thresholds.
/// @dev    Supports stake, claim AP, unstake, emergency withdraw, protocol caps.
///         On claim, AP is minted to the caller via the Arena contract
///         (which holds MINTER_ROLE on RitualAP). totalClaimedByWallet and
///         totalClaimedGlobal are the on-chain source of truth for "AP
///         already earned by wallet" and "AP already emitted globally" —
///         the UI must read these directly and never recompute from events.
contract RitualStakingV3Archived is Ownable, Pausable, ReentrancyGuard {
    struct StakePosition {
        address staker;
        uint256 amount;
        uint256 stakedAt;
        uint256 unlocksAt;
        uint256 lastClaimAt;
        uint256 claimedAP;
        bool withdrawn;
    }

    /// @notice Lock duration for all positions.
    uint256 public constant LOCK_DURATION = 14 days;

    /// @notice Minimum stake amount. Set to 0 in V3 — any msg.value > 0
    ///         is allowed. Kept as a constant for ABI compatibility; the
    ///         check is now `msg.value > 0` in stake().
    uint256 public constant MIN_STAKE = 0;

    /// @notice Maximum AP a single wallet can earn from staking.
    uint256 public constant MAX_STAKING_AP_PER_WALLET = 5_000;

    /// @notice Maximum number of open positions per wallet.
    uint256 public constant MAX_POSITIONS_PER_WALLET = 10;

    /// @notice Fixed AP reward rate: 150 AP per 1 RITUAL per day (V3: 3x
    ///         increase from V1/V2's 50). Cannot be changed on a deployed
    ///         contract — V3 was redeployed to apply this.
    uint256 public constant AP_PER_RITUAL_PER_DAY = 150;

    /// @notice APY denominator (1 year = 365 days). UI may render
    ///         totalClaimedByWallet[wallet] / totalStaked[wallet] / 365
    ///         for a live APY% if needed, but the canonical rate is the
    ///         fixed daily rate above.
    uint256 public constant DAYS_PER_YEAR = 365;

    /// @notice Maximum total amount a single wallet can stake.
    uint256 public maxStakePerWallet = 2 ether;

    /// @notice Maximum total amount staked across all wallets.
    uint256 public maxTotalStaked = 1_000 ether;

    uint256 public totalProtocolStaked;
    uint256 public rewardEmissionCap = 1_000_000;
    uint256 public totalClaimedGlobal;
    uint256 public lastClaimedAtByWalletAggregator; // reserved; per-wallet aggregator lives in mapping below
    bool public emergencyPause;
    address public treasuryWallet;

    IArenaAP public immutable arena;
    StakePosition[] public positions;
    mapping(address => uint256[]) public positionIds;
    mapping(address => uint256) public totalStaked;
    /// @notice Total AP the wallet has already received from staking claims.
    ///         This is the per-wallet canonical counter (name per spec
    ///         "totalClaimedByWallet"). Renamed from stakingApEarned.
    mapping(address => uint256) public totalClaimedByWallet;
    /// @notice Earliest lastClaimAt across all open positions for the
    ///         wallet — surfaced as lastClaimedAt(wallet) view. Updated
    ///         on every claim. 0 if the wallet has never claimed.
    mapping(address => uint256) public lastClaimedAtByWallet;

    event Staked(
        address indexed staker,
        uint256 indexed posId,
        uint256 amount,
        uint256 unlocksAt,
        uint256 projectedTotalAP
    );

    /// @notice Emitted on every successful AP claim. Includes the per-wallet
    ///         cumulative and global cumulative so the UI does NOT have to
    ///         recompute these from Transfer events.
    event RewardsClaimed(
        address indexed staker,
        uint256 reward,
        uint256 totalClaimedByWalletAfter,
        uint256 totalClaimedGlobalAfter
    );

    event Unstaked(address indexed staker, uint256 posId, uint256 amount);
    event EmergencyWithdrawn(address indexed staker, uint256 posId, uint256 amount);
    event ProtocolLimitsUpdated(uint256 maxTotalStaked, uint256 maxStakePerWallet, uint256 rewardEmissionCap);
    event TreasuryWalletUpdated(address indexed treasuryWallet);
    event EmergencyPauseUpdated(bool enabled);
    event StakingAPCapReached(address indexed wallet);
    event StakingEmissionCapReached();

    constructor(address arena_, address treasuryWallet_) Ownable(msg.sender) {
        require(arena_ != address(0), "zero arena");
        require(treasuryWallet_ != address(0), "zero treasury");
        arena = IArenaAP(arena_);
        treasuryWallet = treasuryWallet_;
    }

    /// @notice Stake RITUAL into a new position. Fixed 14-day lock.
    /// @dev    V3: any msg.value > 0 is allowed (MIN_STAKE removed).
    ///         The only cap is the per-wallet maxStakePerWallet (default 2
    ///         RITUAL) and the protocol maxTotalStaked.
    function stake() external payable nonReentrant whenNotPaused returns (uint256 id) {
        require(!emergencyPause, "emergency paused");
        require(msg.value > 0, "zero stake");
        require(totalStaked[msg.sender] + msg.value <= maxStakePerWallet, "exceeds wallet cap");
        require(totalProtocolStaked + msg.value <= maxTotalStaked, "exceeds protocol cap");
        require(positionIds[msg.sender].length < MAX_POSITIONS_PER_WALLET, "too many positions");

        uint256 unlocksAt = block.timestamp + LOCK_DURATION;
        id = positions.length;
        positions.push(
            StakePosition({
                staker: msg.sender,
                amount: msg.value,
                stakedAt: block.timestamp,
                unlocksAt: unlocksAt,
                lastClaimAt: block.timestamp,
                claimedAP: 0,
                withdrawn: false
            })
        );
        positionIds[msg.sender].push(id);
        totalStaked[msg.sender] += msg.value;
        totalProtocolStaked += msg.value;

        // projectedTotalAP = amount * AP_PER_RITUAL_PER_DAY * 14 days / 1 ether
        uint256 projectedAP = (msg.value * AP_PER_RITUAL_PER_DAY * 14) / 1 ether;

        emit Staked(msg.sender, id, msg.value, unlocksAt, projectedAP);
    }

    /// @notice Claim accrued AP for a single position.
    function claimAP(uint256 posId) external nonReentrant whenNotPaused {
        StakePosition storage p = _positionFor(posId, msg.sender);
        require(!p.withdrawn, "withdrawn");
        (uint256 ap, uint256 daysElapsed) = _claimableAP(posId);
        require(ap > 0, "nothing to claim");
        uint256 emitted = _emitAP(msg.sender, ap);
        if (emitted > 0) {
            _recordClaim(p, emitted);
            emit RewardsClaimed(
                msg.sender,
                emitted,
                totalClaimedByWallet[msg.sender],
                totalClaimedGlobal
            );
        }
        if (emitted < ap) {
            emit StakingAPCapReached(msg.sender);
        }
        // daysElapsed is unused in event now; left to keep ABI stable
        daysElapsed;
    }

    /// @notice Claim accrued AP for all positions owned by caller.
    function claimAllAP() external nonReentrant whenNotPaused {
        uint256[] storage ids = positionIds[msg.sender];
        uint256 claimed;
        bool capped;
        for (uint256 i = 0; i < ids.length; i++) {
            StakePosition storage p = positions[ids[i]];
            if (p.withdrawn) continue;
            (uint256 ap, ) = _claimableAP(ids[i]);
            if (ap == 0) continue;
            uint256 emitted = _emitAP(msg.sender, ap);
            if (emitted > 0) {
                _recordClaim(p, emitted);
                claimed += emitted;
            }
            if (emitted < ap) {
                capped = true;
                break;
            }
        }
        require(claimed > 0, "nothing to claim");
        emit RewardsClaimed(
            msg.sender,
            claimed,
            totalClaimedByWallet[msg.sender],
            totalClaimedGlobal
        );
        if (capped) {
            emit StakingAPCapReached(msg.sender);
        }
    }

    /// @notice Unstake a position after lock period expires. Claims pending AP first.
    function unstake(uint256 posId) external nonReentrant whenNotPaused {
        StakePosition storage p = _positionFor(posId, msg.sender);
        require(!p.withdrawn, "withdrawn");
        require(block.timestamp >= p.unlocksAt, "still locked");

        uint256 amount = p.amount;
        (uint256 ap, ) = _claimableAP(posId);
        if (ap > 0) {
            uint256 emitted = _emitAP(msg.sender, ap);
            if (emitted > 0) {
                _recordClaim(p, emitted);
                emit RewardsClaimed(
                    msg.sender,
                    emitted,
                    totalClaimedByWallet[msg.sender],
                    totalClaimedGlobal
                );
            }
            if (emitted < ap) {
                emit StakingAPCapReached(msg.sender);
            }
        }

        p.withdrawn = true;
        totalStaked[msg.sender] -= amount;
        totalProtocolStaked -= amount;

        _sendRitual(msg.sender, amount);
        emit Unstaked(msg.sender, posId, amount);
    }

    /// @notice Emergency withdraw when protocol is paused. Forfeits pending AP.
    function emergencyWithdraw(uint256 posId) external nonReentrant {
        require(emergencyPause || paused(), "not emergency");
        StakePosition storage p = _positionFor(posId, msg.sender);
        require(!p.withdrawn, "withdrawn");

        uint256 amount = p.amount;
        p.withdrawn = true;
        totalStaked[msg.sender] -= amount;
        totalProtocolStaked -= amount;

        _sendRitual(msg.sender, amount);
        emit EmergencyWithdrawn(msg.sender, posId, amount);
    }

    /// @notice Calculate accrued AP for a position.
    /// @dev    Formula: amount * AP_PER_RITUAL_PER_DAY * daysElapsed / 1 ether
    /// @param  posId Position ID
    /// @return ap Accrued AP amount
    /// @return daysElapsed Number of days since last claim (capped at unlock)
    function accruedAP(uint256 posId) public view returns (uint256 ap, uint256 daysElapsed) {
        require(posId < positions.length, "bad position");
        StakePosition storage p = positions[posId];
        if (p.withdrawn) return (0, 0);
        uint256 accrualEnd = block.timestamp < p.unlocksAt ? block.timestamp : p.unlocksAt;
        if (accrualEnd <= p.lastClaimAt) return (0, 0);
        daysElapsed = (accrualEnd - p.lastClaimAt) / 1 days;
        ap = (p.amount * AP_PER_RITUAL_PER_DAY * daysElapsed) / 1 ether;
    }

    /// @notice Estimate total AP for a given stake amount over the full lock period.
    /// @dev    V3: any amount > 0 is allowed (no minimum). Returns the
    ///         linear projection: amount * 150 AP/RITUAL/day * 14 days.
    /// @param  amount Stake amount in wei
    /// @return Total AP over 14 days
    function estimatedAP(uint256 amount) public pure returns (uint256) {
        require(amount > 0, "zero amount");
        return (amount * AP_PER_RITUAL_PER_DAY * 14) / 1 ether;
    }

    /// @notice Get all positions for a wallet.
    function getPositions(address wallet) external view returns (StakePosition[] memory out) {
        uint256[] storage ids = positionIds[wallet];
        out = new StakePosition[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) out[i] = positions[ids[i]];
    }

    /// @notice Total pending AP claimable by `wallet` across all positions.
    ///         Alias of getPendingAP for spec compliance.
    function pendingRewards(address wallet) external view returns (uint256) {
        return _pendingAP(wallet);
    }

    /// @notice Total pending AP for a wallet across all positions.
    function getPendingAP(address wallet) external view returns (uint256 total) {
        return _pendingAP(wallet);
    }

    function _pendingAP(address wallet) private view returns (uint256 total) {
        uint256[] storage ids = positionIds[wallet];
        for (uint256 i = 0; i < ids.length; i++) {
            (uint256 ap, ) = accruedAP(ids[i]);
            total += ap;
        }
        uint256 remaining = rewardEmissionCap > totalClaimedGlobal ? rewardEmissionCap - totalClaimedGlobal : 0;
        uint256 walletRemaining = _stakingApRemaining(wallet);
        if (total > remaining) total = remaining;
        if (total > walletRemaining) total = walletRemaining;
    }

    /// @notice Alias of totalStaked[wallet] for spec compliance.
    function stakedBalance(address wallet) external view returns (uint256) {
        return totalStaked[wallet];
    }

    /// @notice Alias of totalClaimedByWallet[wallet] for spec compliance.
    function totalClaimed(address wallet) external view returns (uint256) {
        return totalClaimedByWallet[wallet];
    }

    /// @notice Most recent lastClaimAt aggregator for the wallet. Updated
    ///         in _recordClaim. 0 if the wallet has never claimed.
    function lastClaimedAt(address wallet) external view returns (uint256) {
        return lastClaimedAtByWallet[wallet];
    }

    /// @notice Number of active stakers (wallets with at least one open,
    ///         non-withdrawn position). Enumerated from positions[]; O(n)
    ///         but n is bounded by maxTotalStaked / MIN_STAKE.
    function activeStakerCount() external view returns (uint256) {
        uint256 count;
        uint256 n = positions.length;
        address last;
        for (uint256 i = 0; i < n; i++) {
            StakePosition storage p = positions[i];
            if (p.withdrawn) continue;
            if (p.staker == last) continue; // count each wallet once
            last = p.staker;
            count++;
        }
        return count;
    }

    /// @notice Current APY rate (AP per RITUAL per day). Alias of
    ///         AP_PER_RITUAL_PER_DAY exposed as a callable view.
    function apPerRitualPerDay() external pure returns (uint256) {
        return AP_PER_RITUAL_PER_DAY;
    }

    /// @notice Same as apPerRitualPerDay, kept as an alias for the
    ///         "APY" naming convention used in some UIs.
    function apyPerRitualPerDay() external pure returns (uint256) {
        return AP_PER_RITUAL_PER_DAY;
    }

    /// @notice One-shot global stats for the UI. Saves RPC round-trips
    ///         for the staking header.
    function globalStakingStats() external view returns (
        uint256 _totalStaked,
        uint256 _totalClaimedGlobal,
        uint256 _rewardEmissionCap,
        uint256 _totalClaimedGlobalRemaining,
        uint256 _activeStakers
    ) {
        _totalStaked = totalProtocolStaked;
        _totalClaimedGlobal = totalClaimedGlobal;
        _rewardEmissionCap = rewardEmissionCap;
        _totalClaimedGlobalRemaining = rewardEmissionCap > totalClaimedGlobal
            ? rewardEmissionCap - totalClaimedGlobal
            : 0;
        _activeStakers = this.activeStakerCount();
    }

    /// @notice Check if a position can be unstaked.
    function canUnstake(uint256 posId) external view returns (bool ok, uint256 secondsLeft) {
        require(posId < positions.length, "bad position");
        StakePosition storage p = positions[posId];
        if (p.withdrawn) return (false, 0);
        if (block.timestamp >= p.unlocksAt) return (true, 0);
        return (false, p.unlocksAt - block.timestamp);
    }

    /// @notice Update protocol limits (owner only).
    /// @dev    V3: no longer requires maxStakePerWallet >= MIN_STAKE
    ///         (MIN_STAKE is 0 anyway). Only sanity-checks that
    ///         maxStakePerWallet > 0.
    function setProtocolLimits(uint256 maxTotalStaked_, uint256 maxStakePerWallet_, uint256 rewardEmissionCap_)
        external
        onlyOwner
    {
        require(maxTotalStaked_ >= totalProtocolStaked, "below current TVL");
        require(maxStakePerWallet_ > 0, "wallet cap must be > 0");
        require(rewardEmissionCap_ >= totalClaimedGlobal, "below emitted");
        maxTotalStaked = maxTotalStaked_;
        maxStakePerWallet = maxStakePerWallet_;
        rewardEmissionCap = rewardEmissionCap_;
        emit ProtocolLimitsUpdated(maxTotalStaked_, maxStakePerWallet_, rewardEmissionCap_);
    }

    /// @notice Update treasury wallet (owner only).
    function setTreasuryWallet(address treasuryWallet_) external onlyOwner {
        require(treasuryWallet_ != address(0), "zero treasury");
        treasuryWallet = treasuryWallet_;
        emit TreasuryWalletUpdated(treasuryWallet_);
    }

    /// @notice Toggle emergency pause (owner only).
    function setEmergencyPause(bool enabled) external onlyOwner {
        emergencyPause = enabled;
        if (enabled) _pause();
        else _unpause();
        emit EmergencyPauseUpdated(enabled);
    }

    // ── Internal ──

    function _positionFor(uint256 posId, address staker) private view returns (StakePosition storage p) {
        require(posId < positions.length, "bad position");
        p = positions[posId];
        require(p.staker == staker, "not staker");
    }

    function _claimableAP(uint256 posId) private view returns (uint256 ap, uint256 daysElapsed) {
        (ap, daysElapsed) = accruedAP(posId);
        uint256 remaining = rewardEmissionCap > totalClaimedGlobal ? rewardEmissionCap - totalClaimedGlobal : 0;
        StakePosition storage p = positions[posId];
        uint256 walletRemaining = _stakingApRemaining(p.staker);
        if (ap > remaining) ap = remaining;
        return (ap > walletRemaining ? walletRemaining : ap, daysElapsed);
    }

    function _recordClaim(StakePosition storage p, uint256 ap) private {
        uint256 accrualEnd = block.timestamp < p.unlocksAt ? block.timestamp : p.unlocksAt;
        p.lastClaimAt = accrualEnd;
        p.claimedAP += ap;
        // Per-wallet aggregator: track the most recent lastClaimAt.
        if (accrualEnd > lastClaimedAtByWallet[p.staker]) {
            lastClaimedAtByWallet[p.staker] = accrualEnd;
        }
    }

    function _emitAP(address wallet, uint256 ap) internal returns (uint256) {
        if (ap == 0) return 0;
        uint256 earned = totalClaimedByWallet[wallet];
        if (earned >= MAX_STAKING_AP_PER_WALLET) return 0;
        uint256 walletRoom = MAX_STAKING_AP_PER_WALLET - earned;
        if (ap > walletRoom) ap = walletRoom;
        uint256 globalRoom = rewardEmissionCap > totalClaimedGlobal ? rewardEmissionCap - totalClaimedGlobal : 0;
        if (ap > globalRoom) ap = globalRoom;
        if (ap == 0) return 0;
        totalClaimedByWallet[wallet] += ap;
        totalClaimedGlobal += ap;
        arena.awardAP(wallet, ap, "staking_reward");
        return ap;
    }

    function _stakingApRemaining(address wallet) private view returns (uint256) {
        return totalClaimedByWallet[wallet] < MAX_STAKING_AP_PER_WALLET ? MAX_STAKING_AP_PER_WALLET - totalClaimedByWallet[wallet] : 0;
    }

    function _sendRitual(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "transfer failed");
    }
}
