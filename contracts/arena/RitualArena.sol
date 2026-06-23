// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRitualAP {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IIdentityRegistry {
    function updateArena(address wallet, uint256 arenaScore) external;
}

interface IRitualAnthem {
    function hasAnthem(address wallet) external view returns (bool);
    function hasCardSnapshot(address wallet) external view returns (bool);
    function getCurrentPower(address wallet) external view returns (uint16);
}

/// @title  Ritual Arena — V5 Battle System
/// @notice V5 battle system restored from V4 architecture. AP-backed
///         community voting. Highest effective weight (AP × power handicap)
///         wins. No ELO, no daily check-in. AP is escrowed via RitualAP
///         transferFrom; payouts transfer winners their stake + pro-rata
///         share of the losing pool minus a 5% protocol fee.
contract RitualArena is Ownable, Pausable, ReentrancyGuard {
    // ── Constants ────────────────────────────────────────────────
    // NOTE: Ritual chain uses MILLISECONDS for block.timestamp (13-digit
    // values, ~1.78e12). Solidity's `24 hours` literal evaluates to 86400
    // (in seconds), so we multiply by 1000 to convert to ms. Otherwise
    // BATTLE_DURATION/COOLDOWN/CYCLE/REPEAT_COOLDOWN are all 86 seconds
    // shorter than intended and battles expire before users can vote.
    uint256 public constant BATTLE_DURATION = 24 hours * 1000;       // 86_400_000 ms = 24h
    uint256 public constant COOLDOWN = 24 hours * 1000;              // 24h
    uint256 public constant REPEAT_COOLDOWN = 7 days * 1000;          // 7d
    uint256 public constant CYCLE_INTERVAL = 24 hours * 1000;         // 24h
    uint256 public constant MAX_BATTLES_PER_CYCLE = 20;
    uint256 public constant MAX_POWER_DELTA = 35;
    uint256 public constant HANDICAP_DIV = 200;
    uint256 public constant MAX_HANDICAP_BPS = 150; // 1.5×
    uint256 public constant FEE_BPS = 500; // 5%
    uint256 public constant MAX_ARENA_SCORE = 200;
    uint256 public constant LB_SIZE = 20;

    // ── External refs ────────────────────────────────────────────
    IRitualAP public ap;
    IIdentityRegistry public identityRegistry;
    IRitualAnthem public identityCard;

    // ── Matchmaker state ─────────────────────────────────────────
    address public keeper;
    uint256 public lastCycletime;
    mapping(address => uint256) public lastBattleEndTime;
    mapping(address => bool) public arenaOptOut;
    mapping(address => mapping(address => uint256)) public lastOpponentMatch;

    // ── Battle state ─────────────────────────────────────────────
    enum Outcome { Unsettled, WinA, WinB, Tie }

    struct Battle {
        address walletA;
        address walletB;
        uint256 startTime;
        uint256 endTime;
        bool settled;
        Outcome outcome;
        uint256 votedApPoolA;
        uint256 votedApPoolB;
        uint256 powerA;
        uint256 powerB;
    }

    uint256 public nextBattleId = 1;
    mapping(uint256 => Battle) public battles;
    mapping(address => uint256) public activeBattleOf;
    mapping(uint256 => mapping(address => bool)) public voterSide;
    mapping(uint256 => mapping(address => bool)) public voterSideSet;
    mapping(uint256 => mapping(address => uint256)) public userStakeA;
    mapping(uint256 => mapping(address => uint256)) public userStakeB;
    mapping(uint256 => uint256) public votedApPoolClaimable;

    // ── Player stats ─────────────────────────────────────────────
    struct PlayerStats {
        uint256 wins;
        uint256 losses;
        uint256 settledBattles;
        uint256 supportGiven;
        uint256 supportReceived;
        uint256 arenaScore;
        uint256 winStreak;
        uint256 bestWinStreak;
    }
    mapping(address => PlayerStats) public arenaStats;
    mapping(address => uint256) public leaderboardIndex;
    address[] public leaderboard;
    mapping(address => uint256[10]) private historyRing;
    mapping(address => uint256) public historyCount;

    // ── Events ───────────────────────────────────────────────────
    event BattleCreated(uint256 indexed id, address indexed a, address indexed b, uint256 end);
    event VotedAP(uint256 indexed id, address indexed voter, bool forA, uint256 amount);
    event BattleSettled(uint256 indexed id, address indexed winner, uint256 poolA, uint256 poolB, uint256 powerA, uint256 powerB);
    event VotedAPClaimed(uint256 indexed id, address indexed backer, uint256 amount);
    event MatchmakingCycleComplete(uint256 t, uint256 c, uint256 s);
    event ArenaOptOut(address indexed w, bool o);
    event KeeperSet(address indexed k);
    event ArenaScoreUpdated(address indexed w, uint256 newScore, uint256 delta);
    event BattleStatsUpdated(address indexed w, uint256 wins, uint256 losses, uint256 settledBattles);
    event APAddressUpdated(address indexed ap);
    event IdentityRegistryUpdated(address indexed registry);
    event IdentityCardUpdated(address indexed card);

    // ── Errors ───────────────────────────────────────────────────
    error NotEligible(string reason);
    error NoAnthem();
    error AlreadyInBattle();
    error Cooldown();
    error BadInput();
    error BattleNotFound();
    error NotSettled();
    error NotSettledYet();
    error BattleNotEnded();
    error NotParticipant();
    error SameSideOnly();
    error InsufficientAP();
    error TransferFailed();
    error ZeroAddress();
    error NotKeeper();
    error PowerDeltaTooLarge();

    // ── Modifiers ────────────────────────────────────────────────
    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────
    constructor(address ap_, address registry_, address card_) Ownable(msg.sender) {
        if (ap_ == address(0) || registry_ == address(0) || card_ == address(0)) revert ZeroAddress();
        ap = IRitualAP(ap_);
        identityRegistry = IIdentityRegistry(registry_);
        identityCard = IRitualAnthem(card_);
        keeper = msg.sender;
    }

    // ── Setters ──────────────────────────────────────────────────
    function setAP(address ap_) external onlyOwner {
        if (ap_ == address(0)) revert ZeroAddress();
        ap = IRitualAP(ap_);
        emit APAddressUpdated(ap_);
    }
    function setIdentityRegistry(address registry_) external onlyOwner {
        if (registry_ == address(0)) revert ZeroAddress();
        identityRegistry = IIdentityRegistry(registry_);
        emit IdentityRegistryUpdated(registry_);
    }
    function setIdentityCard(address card_) external onlyOwner {
        if (card_ == address(0)) revert ZeroAddress();
        identityCard = IRitualAnthem(card_);
        emit IdentityCardUpdated(card_);
    }
    function setKeeper(address k) external onlyOwner {
        if (k == address(0)) revert ZeroAddress();
        keeper = k;
        emit KeeperSet(k);
    }
    function setArenaOptOut(bool o) external {
        if (!identityCard.hasAnthem(msg.sender)) revert NoAnthem();
        arenaOptOut[msg.sender] = o;
        emit ArenaOptOut(msg.sender, o);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── Eligibility ──────────────────────────────────────────────
    // All forged cards are eligible. Only constraint: not currently in
    // an active battle. No cooldown between matches, no repeat-opponent
    // cooldown — cards can rematch any time after their prior battle
    // settles.
    function isMatchmakingEligible(address w) public view returns (bool ok, string memory reason) {
        if (!identityCard.hasAnthem(w)) return (false, "no card");
        if (!identityCard.hasCardSnapshot(w)) return (false, "no snapshot");
        if (arenaOptOut[w]) return (false, "opted out");
        if (activeBattleOf[w] != 0) return (false, "in battle");
        return (true, "eligible");
    }

    // ── Battle creation (owner) ──────────────────────────────────
    function createBattle(address a, address b) external onlyOwner returns (uint256 id) {
        id = _createBattle(a, b);
    }

    // ── Matchmaking batch (keeper) ───────────────────────────────
    function scheduleBatch(address[2][] calldata ws) external onlyKeeper nonReentrant {
        if (ws.length == 0 || ws.length > MAX_BATTLES_PER_CYCLE) revert BadInput();
        if (block.timestamp < lastCycletime + CYCLE_INTERVAL) revert Cooldown();
        lastCycletime = block.timestamp;
        uint256 created;
        uint256 skipped;
        for (uint256 i = 0; i < ws.length; i++) {
            address a = ws[i][0];
            address b = ws[i][1];
            if (a == b || a == address(0) || b == address(0)) { skipped++; continue; }
            (bool ea,) = isMatchmakingEligible(a);
            (bool eb,) = isMatchmakingEligible(b);
            if (!ea || !eb) { skipped++; continue; }
            uint256 pa = identityCard.getCurrentPower(a);
            uint256 pb = identityCard.getCurrentPower(b);
            if (pa == 0 || pb == 0) { skipped++; continue; }
            uint256 dt = pa > pb ? pa - pb : pb - pa;
            if (dt > MAX_POWER_DELTA) { skipped++; continue; }
            _createBattle(a, b);
            created++;
        }
        emit MatchmakingCycleComplete(block.timestamp, created, skipped);
    }

    function _createBattle(address a, address b) internal returns (uint256 id) {
        if (a == b || a == address(0) || b == address(0)) revert BadInput();
        if (!identityCard.hasAnthem(a) || !identityCard.hasAnthem(b)) revert NoAnthem();
        if (!identityCard.hasCardSnapshot(a) || !identityCard.hasCardSnapshot(b)) revert NoAnthem();
        if (activeBattleOf[a] != 0 || activeBattleOf[b] != 0) revert AlreadyInBattle();
        id = nextBattleId++;
        Battle storage x = battles[id];
        x.walletA = a;
        x.walletB = b;
        x.startTime = block.timestamp;
        x.endTime = block.timestamp + BATTLE_DURATION;
        x.powerA = identityCard.getCurrentPower(a);
        x.powerB = identityCard.getCurrentPower(b);
        activeBattleOf[a] = id;
        activeBattleOf[b] = id;
        _addArenaScore(a, 5);
        _addArenaScore(b, 5);
        _lb(a);
        _lb(b);
        emit BattleCreated(id, a, b, x.endTime);
    }

    // ── AP Support (community voting) ────────────────────────────
    function voteAP(uint256 id, bool forA, uint256 amount) external nonReentrant whenNotPaused {
        Battle storage b = battles[id];
        if (b.walletA == address(0)) revert BattleNotFound();
        if (b.settled) revert NotSettled();
        if (block.timestamp >= b.endTime) revert BattleNotEnded();
        if (msg.sender == b.walletA || msg.sender == b.walletB) revert NotParticipant();
        if (amount == 0) revert BadInput();
        if (ap.balanceOf(msg.sender) < amount) revert InsufficientAP();
        if (!voterSideSet[id][msg.sender]) {
            voterSide[id][msg.sender] = forA;
            voterSideSet[id][msg.sender] = true;
        } else if (voterSide[id][msg.sender] != forA) {
            revert SameSideOnly();
        }
        if (!ap.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (forA) {
            b.votedApPoolA += amount;
            userStakeA[id][msg.sender] += amount;
            arenaStats[b.walletA].supportReceived += amount;
        } else {
            b.votedApPoolB += amount;
            userStakeB[id][msg.sender] += amount;
            arenaStats[b.walletB].supportReceived += amount;
        }
        arenaStats[msg.sender].supportGiven += amount;
        emit VotedAP(id, msg.sender, forA, amount);
    }

    // ── Settlement ───────────────────────────────────────────────
    function settle(uint256 id) external nonReentrant {
        Battle storage b = battles[id];
        if (b.walletA == address(0)) revert BattleNotFound();
        if (b.settled) revert NotSettled();
        if (block.timestamp < b.endTime) revert BattleNotEnded();
        address a = b.walletA;
        address c = b.walletB;
        uint256 pA = b.votedApPoolA;
        uint256 pB = b.votedApPoolB;
        b.settled = true;
        activeBattleOf[a] = 0;
        activeBattleOf[c] = 0;
        lastBattleEndTime[a] = block.timestamp;
        lastBattleEndTime[c] = block.timestamp;
        lastOpponentMatch[a][c] = block.timestamp;
        lastOpponentMatch[c][a] = block.timestamp;

        address winner;
        if (pA == 0 && pB == 0) {
            b.outcome = Outcome.Tie;
            _recordResult(a, false, false);
            _recordResult(c, false, false);
        } else {
            (uint256 eA, uint256 eB) = _ew(pA, pB, b.powerA, b.powerB);
            if (eA > eB) {
                winner = a;
                b.outcome = Outcome.WinA;
            } else if (eB > eA) {
                winner = c;
                b.outcome = Outcome.WinB;
            } else {
                b.outcome = Outcome.Tie;
                // Tie with backers: pool minus 5% fee goes back to backers pro-rata.
                uint256 pool = pA + pB;
                if (pool > 0) {
                    uint256 fee = (pool * FEE_BPS) / 10_000;
                    votedApPoolClaimable[id] = pool - fee;
                    if (fee > 0 && !ap.transfer(owner(), fee)) revert TransferFailed();
                }
            }
            if (winner != address(0)) {
                address loser = winner == a ? c : a;
                _recordResult(winner, true, false);
                _recordResult(loser, false, true);
                _winPools(id, b, winner);
                _lb(winner);
                _lb(loser);
            }
        }
        _hist(a, id);
        _hist(c, id);
        emit BattleSettled(id, winner, pA, pB, b.powerA, b.powerB);
    }

    // ── Claim AP payout ──────────────────────────────────────────
    function claimVotedAP(uint256 id) external nonReentrant {
        Battle storage b = battles[id];
        if (!b.settled) revert NotSettledYet();
        uint256 mA = userStakeA[id][msg.sender];
        uint256 mB = userStakeB[id][msg.sender];
        uint256 total = mA + mB;
        if (total == 0) revert InsufficientAP();
        userStakeA[id][msg.sender] = 0;
        userStakeB[id][msg.sender] = 0;
        uint256 dist = votedApPoolClaimable[id];
        uint256 payout;
        if (b.outcome == Outcome.Tie) {
            uint256 pool = b.votedApPoolA + b.votedApPoolB;
            if (pool > 0) {
                payout = (total * dist) / pool;
            }
        } else {
            bool wA = b.outcome == Outcome.WinA;
            uint256 wStake = wA ? mA : mB;
            if (wStake == 0) {
                // Loser side → no payout (stake stays in claimable pool
                // for the protocol owner to sweep).
                emit VotedAPClaimed(id, msg.sender, 0);
                return;
            }
            uint256 wPool = wA ? b.votedApPoolA : b.votedApPoolB;
            uint256 profit = wPool > 0 && dist > 0 ? (wStake * dist) / wPool : 0;
            payout = wStake + profit;
        }
        if (payout > 0) {
            if (!ap.transfer(msg.sender, payout)) revert TransferFailed();
        }
        emit VotedAPClaimed(id, msg.sender, payout);
    }

    // ── Views ────────────────────────────────────────────────────
    function timeLeft(uint256 id) external view returns (uint256) {
        Battle storage b = battles[id];
        if (b.walletA == address(0)) return 0;
        return block.timestamp < b.endTime ? b.endTime - block.timestamp : 0;
    }

    function effectiveWeights(uint256 id) external view returns (uint256 a, uint256 b, uint256 pa, uint256 pb) {
        Battle storage x = battles[id];
        if (x.walletA == address(0)) revert BattleNotFound();
        (a, b) = _ew(x.votedApPoolA, x.votedApPoolB, x.powerA, x.powerB);
        return (a, b, x.powerA, x.powerB);
    }

    function getArenaStats(address w) external view returns (
        uint256 wins,
        uint256 losses,
        uint256 settledBattles,
        uint256 supportGiven,
        uint256 supportReceived,
        uint256 arenaScore,
        uint256 winStreak,
        uint256 bestWinStreak
    ) {
        PlayerStats memory s = arenaStats[w];
        return (s.wins, s.losses, s.settledBattles, s.supportGiven, s.supportReceived, s.arenaScore, s.winStreak, s.bestWinStreak);
    }

    function getRecentBattles(address w) external view returns (uint256[] memory ids) {
        uint256 n = historyCount[w];
        uint256 c = n < 10 ? n : 10;
        ids = new uint256[](c);
        for (uint256 i = 0; i < c; i++) ids[i] = historyRing[w][(n - 1 - i) % 10];
    }

    function getLeaderboard(uint256 offset, uint256 limit) external view returns (address[] memory wallets, uint256[] memory scores) {
        uint256 n = leaderboard.length;
        if (offset >= n) {
            return (new address[](0), new uint256[](0));
        }
        uint256 end = offset + limit;
        if (end > n) end = n;
        uint256 len = end - offset;
        wallets = new address[](len);
        scores = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            address x = leaderboard[offset + i];
            wallets[i] = x;
            scores[i] = arenaStats[x].arenaScore;
        }
    }

    function leaderboardLength() external view returns (uint256) { return leaderboard.length; }

    function getBattle(uint256 id) external view returns (
        address walletA, address walletB, uint256 startTime, uint256 endTime,
        bool settled, uint8 outcome, uint256 votedApPoolA, uint256 votedApPoolB,
        uint256 powerA, uint256 powerB
    ) {
        Battle storage b = battles[id];
        return (b.walletA, b.walletB, b.startTime, b.endTime, b.settled, uint8(b.outcome), b.votedApPoolA, b.votedApPoolB, b.powerA, b.powerB);
    }

    // ── Internal ─────────────────────────────────────────────────
    function _ew(uint256 rA, uint256 rB, uint256 pA, uint256 pB) internal pure returns (uint256 a, uint256 b) {
        if (pA == pB) return (rA, rB);
        uint256 d = pA > pB ? pA - pB : pB - pA;
        uint256 bp = 100 + (d * 100) / HANDICAP_DIV;
        if (bp > MAX_HANDICAP_BPS) bp = MAX_HANDICAP_BPS;
        if (pA < pB) return ((rA * bp) / 100, rB);
        return (rA, (rB * bp) / 100);
    }

    function _recordResult(address w, bool isWinner, bool isLoser) internal {
        PlayerStats storage s = arenaStats[w];
        s.settledBattles += 1;
        if (isWinner) {
            s.wins += 1;
            s.winStreak += 1;
            if (s.winStreak > s.bestWinStreak) s.bestWinStreak = s.winStreak;
            _addArenaScore(w, 100);
        } else if (isLoser) {
            s.losses += 1;
            if (s.winStreak > 0) s.winStreak = 0;
            _addArenaScore(w, 10);
        }
        emit BattleStatsUpdated(w, s.wins, s.losses, s.settledBattles);
    }

    function _addArenaScore(address w, uint256 delta) internal {
        PlayerStats storage s = arenaStats[w];
        s.arenaScore += delta;
        uint256 capped = s.arenaScore > MAX_ARENA_SCORE ? MAX_ARENA_SCORE : s.arenaScore;
        emit ArenaScoreUpdated(w, s.arenaScore, delta);
        if (address(identityRegistry) != address(0)) {
            identityRegistry.updateArena(w, capped);
        }
    }

    function _winPools(uint256 id, Battle storage b, address w) internal {
        uint256 wp = w == b.walletA ? b.votedApPoolA : b.votedApPoolB;
        uint256 lp = w == b.walletA ? b.votedApPoolB : b.votedApPoolA;
        if (wp == 0) {
            if (lp > 0) {
                uint256 fee = (lp * FEE_BPS) / 10_000;
                votedApPoolClaimable[id] = lp - fee;
                if (fee > 0 && !ap.transfer(owner(), fee)) revert TransferFailed();
            }
            return;
        }
        uint256 dist;
        if (lp > 0) {
            uint256 fee = (lp * FEE_BPS) / 10_000;
            dist = lp - fee;
            if (fee > 0 && !ap.transfer(owner(), fee)) revert TransferFailed();
        }
        votedApPoolClaimable[id] = dist;
    }

    function _lb(address w) internal {
        if (leaderboardIndex[w] == 0) {
            leaderboard.push(w);
            leaderboardIndex[w] = leaderboard.length;
        }
    }

    function _hist(address w, uint256 id) internal {
        uint256 n = historyCount[w];
        historyRing[w][n % 10] = id;
        historyCount[w] = n + 1;
    }
}
