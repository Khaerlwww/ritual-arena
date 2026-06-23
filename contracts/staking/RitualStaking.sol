// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRitualAP {
    function mint(address to, uint256 amount) external;
}

/// @title  Ritual Staking — V5 (direct RitualAP mint)
/// @notice Fixed-rate staking. `claimAP()` mints RitualAP directly
///         to the staker. There is NO arena indirection and NO
///         internal AP balance storage. RitualAP is the only AP ledger.
contract RitualStaking is Ownable, Pausable, ReentrancyGuard {
    struct StakePosition {
        address staker;
        uint256 amount;
        uint256 stakedAt;
        uint256 unlocksAt;
        uint256 lastClaimAt;
        uint256 claimedAP;
        bool withdrawn;
    }

    // ── Constants ────────────────────────────────────────────────
    uint256 public constant LOCK_DURATION = 14 days;
    uint256 public constant MIN_STAKE = 0;
    uint256 public constant MAX_STAKING_AP_PER_WALLET = 5_000 * 10 ** 18;
    uint256 public constant AP_PER_RITUAL_PER_DAY = 150 * 10 ** 18;
    uint256 public constant MAX_POSITIONS_PER_WALLET = 10;
    uint256 public constant DAYS_PER_YEAR = 365;

    // ── Config (owner-settable) ──────────────────────────────────
    uint256 public maxStakePerWallet = 2 ether;
    uint256 public maxTotalStaked = 1_000 ether;
    uint256 public rewardEmissionCap = 1_000_000 * 10 ** 18;
    bool public emergencyPause;
    address public treasuryWallet;

    // ── External refs ────────────────────────────────────────────
    IRitualAP public ap;

    // ── Storage ──────────────────────────────────────────────────
    StakePosition[] public positions;
    mapping(address => uint256[]) public positionIds;
    mapping(address => uint256) public totalStaked;
    mapping(address => uint256) public totalClaimedByWallet;
    mapping(address => uint256) public lastClaimedAtByWallet;
    uint256 public totalProtocolStaked;
    uint256 public totalClaimedGlobal;

    // ── Events ───────────────────────────────────────────────────
    event Staked(
        address indexed staker,
        uint256 indexed posId,
        uint256 amount,
        uint256 unlocksAt,
        uint256 projectedTotalAP
    );
    event RewardsClaimed(
        address indexed staker,
        uint256 reward,
        uint256 totalClaimedByWalletAfter,
        uint256 totalClaimedGlobalAfter
    );
    event Unstaked(address indexed staker, uint256 posId, uint256 amount);
    event EmergencyWithdrawn(address indexed staker, uint256 posId, uint256 amount);
    event APAddressUpdated(address indexed ap);
    event ProtocolLimitsUpdated(uint256 maxTotalStaked, uint256 maxStakePerWallet, uint256 rewardEmissionCap);
    event TreasuryWalletUpdated(address indexed treasuryWallet);
    event EmergencyPauseUpdated(bool enabled);
    event StakingAPCapReached(address indexed wallet);
    event StakingEmissionCapReached();

    // ── Errors ───────────────────────────────────────────────────
    error ZeroAddress();
    error EmergencyPaused();
    error ZeroStake();
    error ExceedsWalletCap();
    error ExceedsProtocolCap();
    error TooManyPositions();
    error NotOwner();
    error Withdrawn();
    error NothingToClaim();
    error StillLocked();
    error TransferFailed();

    constructor(address ap_, address treasury_) Ownable(msg.sender) {
        if (ap_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        ap = IRitualAP(ap_);
        treasuryWallet = treasury_;
    }

    /// @notice Ritual Chain quirk: block.timestamp is in MILLISECONDS, not
    ///         seconds (standard EVM). Divide by 1000 to get true seconds.
    ///         All time math below uses this helper so LOCK_DURATION,
    ///         1 days, etc. behave as intended.
    function _now() internal view returns (uint256) {
        return block.timestamp / 1000;
    }

    // ── Setters ──────────────────────────────────────────────────
    function setAP(address ap_) external onlyOwner {
        if (ap_ == address(0)) revert ZeroAddress();
        ap = IRitualAP(ap_);
        emit APAddressUpdated(ap_);
    }
    function setProtocolLimits(uint256 maxTotalStaked_, uint256 maxStakePerWallet_, uint256 rewardEmissionCap_) external onlyOwner {
        maxTotalStaked = maxTotalStaked_;
        maxStakePerWallet = maxStakePerWallet_;
        rewardEmissionCap = rewardEmissionCap_;
        emit ProtocolLimitsUpdated(maxTotalStaked_, maxStakePerWallet_, rewardEmissionCap_);
    }
    function setTreasuryWallet(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasuryWallet = treasury_;
        emit TreasuryWalletUpdated(treasury_);
    }
    function setEmergencyPause(bool enabled) external onlyOwner {
        emergencyPause = enabled;
        emit EmergencyPauseUpdated(enabled);
    }

    // ── Stake / Claim / Unstake ──────────────────────────────────
    function stake() external payable nonReentrant whenNotPaused returns (uint256 id) {
        if (emergencyPause) revert EmergencyPaused();
        if (msg.value == 0) revert ZeroStake();
        if (totalStaked[msg.sender] + msg.value > maxStakePerWallet) revert ExceedsWalletCap();
        if (totalProtocolStaked + msg.value > maxTotalStaked) revert ExceedsProtocolCap();
        if (positionIds[msg.sender].length >= MAX_POSITIONS_PER_WALLET) revert TooManyPositions();

        uint256 nowSec = _now();
        uint256 unlocksAt = nowSec + LOCK_DURATION;
        id = positions.length;
        positions.push(
            StakePosition({
                staker: msg.sender,
                amount: msg.value,
                stakedAt: nowSec,
                unlocksAt: unlocksAt,
                lastClaimAt: nowSec,
                claimedAP: 0,
                withdrawn: false
            })
        );
        positionIds[msg.sender].push(id);
        totalStaked[msg.sender] += msg.value;
        totalProtocolStaked += msg.value;

        uint256 projectedAP = (msg.value * AP_PER_RITUAL_PER_DAY * 14) / 1 ether;
        emit Staked(msg.sender, id, msg.value, unlocksAt, projectedAP);
    }

    function claimAP(uint256 posId) external nonReentrant whenNotPaused {
        StakePosition storage p = positions[posId];
        if (p.staker != msg.sender) revert NotOwner();
        if (p.withdrawn) revert Withdrawn();
        (uint256 reward, ) = _claimableAP(p);
        if (reward == 0) revert NothingToClaim();

        uint256 emitted = _emitAP(msg.sender, reward);
        if (emitted > 0) {
            p.claimedAP += emitted;
            p.lastClaimAt = _now();
            totalClaimedByWallet[msg.sender] += emitted;
            lastClaimedAtByWallet[msg.sender] = _now();
            totalClaimedGlobal += emitted;
            emit RewardsClaimed(msg.sender, emitted, totalClaimedByWallet[msg.sender], totalClaimedGlobal);
        }
        if (emitted < reward) emit StakingAPCapReached(msg.sender);
    }

    function claimAllAP() external nonReentrant whenNotPaused {
        uint256[] storage ids = positionIds[msg.sender];
        uint256 totalEmitted;
        bool capped;
        for (uint256 i = 0; i < ids.length; i++) {
            StakePosition storage p = positions[ids[i]];
            if (p.withdrawn) continue;
            (uint256 reward, ) = _claimableAP(p);
            if (reward == 0) continue;
            uint256 emitted = _emitAP(msg.sender, reward);
            if (emitted > 0) {
                p.claimedAP += emitted;
                p.lastClaimAt = _now();
                totalEmitted += emitted;
                if (emitted < reward) capped = true;
            }
        }
        if (totalEmitted > 0) {
            totalClaimedByWallet[msg.sender] += totalEmitted;
            lastClaimedAtByWallet[msg.sender] = _now();
            totalClaimedGlobal += totalEmitted;
            emit RewardsClaimed(msg.sender, totalEmitted, totalClaimedByWallet[msg.sender], totalClaimedGlobal);
        }
        if (capped) emit StakingAPCapReached(msg.sender);
    }

    function unstake(uint256 posId) external nonReentrant {
        StakePosition storage p = positions[posId];
        if (p.staker != msg.sender) revert NotOwner();
        if (p.withdrawn) revert Withdrawn();
        if (_now() < p.unlocksAt) revert StillLocked();
        (uint256 reward, ) = _claimableAP(p);
        uint256 emitted;
        if (reward > 0) emitted = _emitAP(msg.sender, reward);
        p.withdrawn = true;
        totalStaked[msg.sender] -= p.amount;
        totalProtocolStaked -= p.amount;
        (bool ok, ) = msg.sender.call{value: p.amount}("");
        if (!ok) revert TransferFailed();
        if (emitted > 0) {
            p.claimedAP += emitted;
            totalClaimedByWallet[msg.sender] += emitted;
            lastClaimedAtByWallet[msg.sender] = _now();
            totalClaimedGlobal += emitted;
            emit RewardsClaimed(msg.sender, emitted, totalClaimedByWallet[msg.sender], totalClaimedGlobal);
        }
        emit Unstaked(msg.sender, posId, p.amount);
    }

    function emergencyWithdraw(uint256 posId) external nonReentrant {
        StakePosition storage p = positions[posId];
        if (p.staker != msg.sender) revert NotOwner();
        if (p.withdrawn) revert Withdrawn();
        p.withdrawn = true;
        uint256 penalty = p.amount / 20; // 5% penalty
        uint256 refund = p.amount - penalty;
        totalStaked[msg.sender] -= p.amount;
        totalProtocolStaked -= p.amount;
        (bool ok1, ) = msg.sender.call{value: refund}("");
        if (!ok1) revert TransferFailed();
        (bool ok2, ) = treasuryWallet.call{value: penalty}("");
        if (!ok2) revert TransferFailed();
        emit EmergencyWithdrawn(msg.sender, posId, refund);
    }

    // ── Internal helpers ─────────────────────────────────────────
    function _emitAP(address wallet, uint256 reward) internal returns (uint256) {
        uint256 already = totalClaimedByWallet[wallet];
        if (already >= MAX_STAKING_AP_PER_WALLET) return 0;
        uint256 allowed = MAX_STAKING_AP_PER_WALLET - already;
        uint256 amount = reward > allowed ? allowed : reward;
        if (totalClaimedGlobal >= rewardEmissionCap) {
            emit StakingEmissionCapReached();
            return 0;
        }
        if (totalClaimedGlobal + amount > rewardEmissionCap) {
            amount = rewardEmissionCap - totalClaimedGlobal;
        }
        if (amount == 0) return 0;
        ap.mint(wallet, amount);
        return amount;
    }

    function _claimableAP(StakePosition storage p) internal view returns (uint256 reward, uint256 daysElapsed) {
        if (p.withdrawn) return (0, 0);
        uint256 nowSec = _now();
        uint256 end = nowSec < p.unlocksAt ? nowSec : p.unlocksAt;
        if (end <= p.lastClaimAt) return (0, 0);
        daysElapsed = (end - p.lastClaimAt) / 1 days;
        if (daysElapsed == 0) return (0, 0);
        reward = (p.amount * AP_PER_RITUAL_PER_DAY * daysElapsed) / 1 ether;
    }

    // ── View helpers ─────────────────────────────────────────────
    function getPosition(uint256 posId) external view returns (StakePosition memory) { return positions[posId]; }
    function getPositionIds(address wallet) external view returns (uint256[] memory) { return positionIds[wallet]; }

    // ── Convenience views (frontend compatibility) ───────────────
    // These are thin wrappers that surface constants and on-chain state
    // in the shape the V5 frontend expects. They add no storage, no
    // accounting change — same source of truth as the contract.
    //
    // AP values are returned in 18-decimal wei; the frontend is
    // responsible for formatUnits(value, 18) to display AP units.

    /// @notice AP earned per RITUAL staked per day (18-decimal wei).
    /// @dev    Pure view mirroring the AP_PER_RITUAL_PER_DAY constant.
    function apPerRitualPerDay() external pure returns (uint256) {
        return AP_PER_RITUAL_PER_DAY;
    }

    /// @notice Projected AP earned for a full 14-day lock at `amount` wei.
    /// @dev    Uses the same integer math as the on-chain _claimableAP().
    ///         Note: LOCK_DURATION is in seconds; we divide by `1 days`
    ///         to convert to days so the formula matches per-day AP.
    function estimatedAP(uint256 amount) external pure returns (uint256) {
        return (amount * AP_PER_RITUAL_PER_DAY * LOCK_DURATION / 1 days) / 1 ether;
    }

    /// @notice Claimable AP for one position, plus the days elapsed since
    ///         its last claim. Returns 0s for unknown / withdrawn positions.
    function accruedAP(uint256 posId) external view returns (uint256 apAmount, uint256 daysElapsed) {
        if (posId >= positions.length) return (0, 0);
        return _claimableAP(positions[posId]);
    }

    /// @notice Sum of claimable AP across all non-withdrawn positions
    ///         owned by `wallet`.
    function pendingRewards(address wallet) external view returns (uint256 total) {
        uint256[] storage ids = positionIds[wallet];
        for (uint256 i = 0; i < ids.length; i++) {
            (uint256 reward, ) = _claimableAP(positions[ids[i]]);
            total += reward;
        }
    }

    /// @notice Alias for totalClaimedByWallet[wallet] for frontend clarity.
    function totalClaimed(address wallet) external view returns (uint256) {
        return totalClaimedByWallet[wallet];
    }

    /// @notice Alias for lastClaimedAtByWallet[wallet] for frontend clarity.
    function lastClaimedAt(address wallet) external view returns (uint256) {
        return lastClaimedAtByWallet[wallet];
    }

    /// @notice Count of non-withdrawn positions across all stakers.
    /// @dev    O(n) over positions. Acceptable for V5 scale.
    function activeStakerCount() public view returns (uint256 count) {
        for (uint256 i = 0; i < positions.length; i++) {
            if (!positions[i].withdrawn) count++;
        }
    }

    /// @notice Aggregate view used by the global analytics panel.
    /// @return _totalStaked                 Sum of all active stakes.
    /// @return _totalClaimedGlobal          Lifetime AP minted.
    /// @return _rewardEmissionCap           Configured cap.
    /// @return _totalClaimedGlobalRemaining Cap - already-claimed.
    /// @return _activeStakers               Count of non-withdrawn positions.
    function globalStakingStats() external view returns (
        uint256 _totalStaked,
        uint256 _totalClaimedGlobal,
        uint256 _rewardEmissionCap,
        uint256 _totalClaimedGlobalRemaining,
        uint256 _activeStakers
    ) {
        return (
            totalProtocolStaked,
            totalClaimedGlobal,
            rewardEmissionCap,
            rewardEmissionCap > totalClaimedGlobal ? rewardEmissionCap - totalClaimedGlobal : 0,
            activeStakerCount()
        );
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
