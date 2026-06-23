// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title IIdentityCard — minimal read surface for the Identity Card NFT.
interface IIdentityCard {
    function hasAnthem(address wallet) external view returns (bool);
    function getCurrentPower(address wallet) external view returns (uint16);
    function getCurrentRarity(address wallet) external view returns (uint8);
    function hasCardSnapshot(address wallet) external view returns (bool);
}

/// @title IIdentityRegistry — push channel for Arena Score updates.
interface IIdentityRegistry {
    function updateArena(address wallet, uint256 arenaScore) external;
}

/// @title Arena — AP-only competitive match system
/// @notice Winner determined by AP support pools only. No ELO.
///         Arena Score replaces ELO for Arena-related contribution.
///
///         arenaScore rewards:
///         - winner of a settled match: +100
///         - loser of a settled match: +10
///         - participation (match entered): +5
///         - support given (per AP staked): tracked separately in supportGiven
///         - support received (per AP backed): tracked separately in supportReceived
///
///         Power handicap applied to AP weights during settlement.
contract Arena is ReentrancyGuard {
    // --- Timing ---
    uint256 internal constant _DUR_SEC = 86400;
    uint256 internal constant _REPEAT_SEC = 604800;
    function _dur() internal view returns (uint256) { return block.timestamp > 1e12 ? _DUR_SEC * 1000 : _DUR_SEC; }
    function _cd() internal view returns (uint256) { return block.timestamp > 1e12 ? _DUR_SEC * 1000 : _DUR_SEC; }
    function _ci() internal view returns (uint256) { return block.timestamp > 1e12 ? _DUR_SEC * 1000 : _DUR_SEC; }
    function _ro() internal view returns (uint256) { return block.timestamp > 1e12 ? _REPEAT_SEC * 1000 : _REPEAT_SEC; }

    // --- Constants ---
    uint256 public constant DAILY_MIN = 20 hours;
    uint256 public constant DAILY_MAX = 48 hours;
    uint256 public constant MILESTONE_7 = 7;
    uint256 public constant MILESTONE_14 = 14;
    uint256 public constant MILESTONE_30 = 30;
    uint256 public constant DUEL_FEE = 50;
    uint256 public constant FEE_BPS = 500;
    uint256 public constant HANDICAP_DIV = 200;
    uint256 public constant MAX_HANDICAP = 150;
    uint256 public constant MAX_AP_DAY = 50_000;
    uint256 public constant MAX_DELTA = 35;
    uint256 public constant LB_SIZE = 20;
    uint256 public constant MAX_BATTLES = 20;

    // --- State ---
    IIdentityCard public immutable identityCard;
    IIdentityRegistry public identityRegistry;
    address public owner;
    address public pendingOwner;
    mapping(address => bool) public trustedCallers;
    address public keeper;
    uint256 public lastCycletime;
    mapping(address => uint256) public lastBattleEndTime;
    mapping(address => bool) public arenaOptOut;
    mapping(address => mapping(address => uint256)) public lastOpponentMatch;
    mapping(address => uint256) public ritualPoints;

    struct DailyStreak { uint64 streak; uint64 lastCheckIn; uint64 longestStreak; uint64 totalCheckIns; }
    mapping(address => DailyStreak) public dailyStreaks;
    mapping(address => uint8) public milestonesClaimed;

    enum Outcome { Unsettled, WinA, WinB, Tie }

    struct Battle {
        address walletA; address walletB;
        uint256 startTime; uint256 endTime;
        bool settled; Outcome outcome;
        uint256 ownerDepositA; uint256 ownerDepositB;
        uint256 votedApPool; uint256 votedApPoolA; uint256 votedApPoolB;
        uint256 powerA; uint256 powerB;
    }

    uint256 public nextBattleId = 1;
    mapping(uint256 => Battle) public battles;
    mapping(address => uint256) public activeBattleOf;
    mapping(uint256 => mapping(address => bool)) public voterSide;
    mapping(uint256 => mapping(address => bool)) public voterSideSet;
    mapping(uint256 => mapping(address => uint256)) public userStakeA;
    mapping(uint256 => mapping(address => uint256)) public userStakeB;
    mapping(uint256 => uint256) public votedApPoolClaimable;

    // --- Arena Score (replaces ELO) ---
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

    // --- Events ---
    event PointsEarned(address indexed w, uint256 amt, string r, uint256 bal);
    event DailyCheckIn(address indexed w, uint256 s, uint256 b, uint256 bo, uint256 bal);
    event BattleCreated(uint256 indexed id, address indexed a, address indexed b, uint256 end);
    event VotedAP(uint256 indexed id, address indexed v, bool forA, uint256 amt);
    event BattleSettled(uint256 indexed id, address w, uint256 poolA, uint256 poolB);
    event VotedAPClaimed(uint256 indexed id, address indexed b, uint256 amt);
    event MatchmakingCycleComplete(uint256 t, uint256 c, uint256 s);
    event TrustedCallerSet(address indexed c, bool t);
    event APDeducted(address indexed w, uint256 a, address indexed b);
    event ArenaOptOut(address indexed w, bool o);
    event KeeperSet(address indexed k);
    event OwnershipTransferStarted(address indexed p, address indexed n);
    event OwnershipTransferred(address indexed o, address indexed n);
    event ArenaScoreUpdated(address indexed w, uint256 newScore, uint256 delta);
    event BattleStatsUpdated(address indexed w, uint256 wins, uint256 losses, uint256 settled);

    // --- Modifiers ---
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyTrusted() { require(trustedCallers[msg.sender], "not trusted"); _; }
    modifier onlyKeeper() { require(msg.sender == keeper, "not keeper"); _; }

    constructor(address card_) {
        require(card_ != address(0), "zero");
        identityCard = IIdentityCard(card_);
        owner = msg.sender;
        keeper = msg.sender;
    }

    function isEligible(address w) public view returns (bool) { return identityCard.hasAnthem(w); }

    // --- Daily Check-In ---
    function dailyCheckIn() external returns (uint256 m) {
        require(identityCard.hasAnthem(msg.sender), "no card");
        DailyStreak storage d = dailyStreaks[msg.sender];
        if (d.lastCheckIn == 0) d.streak = 1;
        else {
            uint256 e = block.timestamp - d.lastCheckIn;
            require(e >= DAILY_MIN, "cooldown");
            d.streak = e <= DAILY_MAX ? d.streak + 1 : 1;
        }
        d.lastCheckIn = uint64(block.timestamp);
        d.totalCheckIns++;
        if (d.streak > d.longestStreak) d.longestStreak = d.streak;
        uint256 base = 10;
        uint256 bonus;
        uint8 bits = milestonesClaimed[msg.sender];
        if (d.streak >= 30 && (bits & 4) == 0) { bonus += 200; bits |= 4; }
        if (d.streak >= 14 && (bits & 2) == 0) { bonus += 100; bits |= 2; }
        if (d.streak >= 7 && (bits & 1) == 0) { bonus += 50; bits |= 1; }
        milestonesClaimed[msg.sender] = bits;
        m = base + bonus;
        ritualPoints[msg.sender] += m;
        emit DailyCheckIn(msg.sender, d.streak, base, bonus, ritualPoints[msg.sender]);
    }

    // --- Match creation (Keeper) ---
    function setKeeper(address k) external onlyOwner {
        require(k != address(0), "zero");
        keeper = k;
        emit KeeperSet(k);
    }

    function keeperIsOwner() external view returns (bool) { return keeper == owner; }

    function setIdentityRegistry(address registry) external onlyOwner {
        require(registry != address(0), "zero");
        identityRegistry = IIdentityRegistry(registry);
    }

    function createBattle(address a, address b, uint256 pa, uint256 pb) external onlyOwner returns (uint256 id) {
        id = _createBattle(a, b, pa, pb);
    }

    function setArenaOptOut(bool o) external {
        require(identityCard.hasAnthem(msg.sender), "no card");
        arenaOptOut[msg.sender] = o;
        emit ArenaOptOut(msg.sender, o);
    }

    function isMatchmakingEligible(address w) public view returns (bool, string memory) {
        if (!identityCard.hasAnthem(w)) return (false, "no card");
        if (!identityCard.hasCardSnapshot(w)) return (false, "no snap");
        if (arenaOptOut[w]) return (false, "opted out");
        if (activeBattleOf[w] != 0) return (false, "in battle");
        if (block.timestamp < lastBattleEndTime[w] + _cd()) return (false, "cooldown");
        return (true, "eligible");
    }

    function scheduleBatch(address[2][] calldata ws, uint256[2][] calldata ps) external onlyKeeper nonReentrant {
        require(ws.length == ps.length && ws.length > 0, "bad input");
        require(block.timestamp >= lastCycletime + _ci(), "cycle soon");
        require(ws.length <= MAX_BATTLES, "too many");
        lastCycletime = block.timestamp;
        uint256 created;
        uint256 skipped;
        for (uint256 i = 0; i < ws.length; i++) {
            address a = ws[i][0]; address b = ws[i][1]; uint256 pa = ps[i][0]; uint256 pb = ps[i][1];
            if (a == b || pa > 100 || pb > 100 || pa != _p(a) || pb != _p(b)) { skipped++; continue; }
            uint256 dt = pa > pb ? pa - pb : pb - pa;
            if (dt > MAX_DELTA) { skipped++; continue; }
            (bool ea,) = isMatchmakingEligible(a); (bool eb,) = isMatchmakingEligible(b);
            if (!ea || !eb) { skipped++; continue; }
            if (block.timestamp < lastOpponentMatch[a][b] + _ro()) { skipped++; continue; }
            if (block.timestamp < lastOpponentMatch[b][a] + _ro()) { skipped++; continue; }
            _createBattle(a, b, pa, pb);
            created++;
        }
        emit MatchmakingCycleComplete(block.timestamp, created, skipped);
    }

    function _createBattle(address a, address b, uint256 pa, uint256 pb) internal returns (uint256 id) {
        require(a != b && a != address(0) && b != address(0), "bad");
        require(identityCard.hasAnthem(a) && identityCard.hasAnthem(b), "no card");
        require(identityCard.hasCardSnapshot(a) && identityCard.hasCardSnapshot(b), "no snap");
        require(activeBattleOf[a] == 0 && activeBattleOf[b] == 0, "in battle");
        require(pa <= 100 && pb <= 100 && pa == _p(a) && pb == _p(b) && pa > 0 && pb > 0, "bad power");
        id = nextBattleId++;
        Battle storage x = battles[id];
        x.walletA = a; x.walletB = b;
        x.startTime = block.timestamp;
        x.endTime = block.timestamp + _dur();
        x.powerA = pa; x.powerB = pb;
        activeBattleOf[a] = id; activeBattleOf[b] = id;
        // Award participation Arena Score to both entrants.
        _addArenaScore(a, 5);
        _addArenaScore(b, 5);
        arenaStats[a].settledBattles += 1; // counted at entry; ++ at settlement
        arenaStats[b].settledBattles += 1;
        emit BattleCreated(id, a, b, x.endTime);
    }

    // --- AP Support ---
    function voteAP(uint256 id, bool forA, uint256 amt) external {
        Battle storage b = battles[id];
        require(b.walletA != address(0) && !b.settled && block.timestamp < b.endTime, "bad battle");
        require(amt > 0 && msg.sender != b.walletA && msg.sender != b.walletB, "bad input");
        require(ritualPoints[msg.sender] >= amt, "no AP");
        if (!voterSideSet[id][msg.sender]) {
            voterSide[id][msg.sender] = forA;
            voterSideSet[id][msg.sender] = true;
        } else require(voterSide[id][msg.sender] == forA, "switch");
        ritualPoints[msg.sender] -= amt;
        if (forA) {
            b.votedApPoolA += amt;
            userStakeA[id][msg.sender] += amt;
        } else {
            b.votedApPoolB += amt;
            userStakeB[id][msg.sender] += amt;
        }
        b.votedApPool += amt;
        // Track support given/received for Arena Score.
        arenaStats[msg.sender].supportGiven += amt;
        if (forA) arenaStats[b.walletA].supportReceived += amt;
        else arenaStats[b.walletB].supportReceived += amt;
        emit VotedAP(id, msg.sender, forA, amt);
    }

    // --- Settlement ---
    function settle(uint256 id) external nonReentrant {
        Battle storage b = battles[id];
        require(b.walletA != address(0) && !b.settled && block.timestamp >= b.endTime, "bad");
        address a = b.walletA;
        address c = b.walletB;
        uint256 pA = b.votedApPoolA;
        uint256 pB = b.votedApPoolB;
        b.settled = true;
        activeBattleOf[a] = 0; activeBattleOf[c] = 0;
        lastBattleEndTime[a] = block.timestamp; lastBattleEndTime[c] = block.timestamp;
        lastOpponentMatch[a][c] = block.timestamp; lastOpponentMatch[c][a] = block.timestamp;
        address winner;
        if (pA == 0 && pB == 0) {
            b.outcome = Outcome.Tie;
            _tiePools(id, b);
            _recordResult(a, false, false); _recordResult(c, false, false);
        } else {
            (uint256 eA, uint256 eB) = _ew(pA, pB, b.powerA, b.powerB);
            if (eA > eB) { winner = a; b.outcome = Outcome.WinA; }
            else if (eB > eA) { winner = c; b.outcome = Outcome.WinB; }
            else { b.outcome = Outcome.Tie; _tiePools(id, b); }
            if (winner != address(0)) {
                address loser = winner == a ? c : a;
                _recordResult(winner, true, false);
                _recordResult(loser, false, true);
                _winPools(id, b, winner);
                _lb(winner); _lb(loser);
            }
        }
        _hist(a, id); _hist(c, id);
        emit BattleSettled(id, winner, pA, pB);
    }

    // --- Claim AP payout ---
    function claimVotedAP(uint256 id) external nonReentrant {
        Battle storage b = battles[id]; require(b.settled, "not settled");
        uint256 mA = userStakeA[id][msg.sender];
        uint256 mB = userStakeB[id][msg.sender];
        uint256 total = mA + mB; require(total > 0, "no stake");
        uint256 dist = votedApPoolClaimable[id];
        if (b.outcome == Outcome.Tie) {
            uint256 pool = b.votedApPoolA + b.votedApPoolB; require(pool > 0, "no pool");
            uint256 share = (total * dist) / pool;
            userStakeA[id][msg.sender] = 0; userStakeB[id][msg.sender] = 0;
            if (share > 0) _award(msg.sender, share, "ap_tie");
            emit VotedAPClaimed(id, msg.sender, share); return;
        }
        bool wA = b.outcome == Outcome.WinA;
        uint256 wStake = wA ? mA : mB; require(wStake > 0, "loser");
        uint256 wPool = wA ? b.votedApPoolA : b.votedApPoolB;
        uint256 profit = dist > 0 ? (wStake * dist) / wPool : 0;
        userStakeA[id][msg.sender] = 0; userStakeB[id][msg.sender] = 0;
        uint256 payout = wStake + profit;
        _award(msg.sender, payout, "ap_win");
        emit VotedAPClaimed(id, msg.sender, payout);
    }

    // --- Views ---
    function timeLeft(uint256 id) external view returns (uint256) {
        Battle storage b = battles[id];
        return (b.walletA != address(0) && block.timestamp < b.endTime) ? b.endTime - block.timestamp : 0;
    }
    function isSettleable(uint256 id) external view returns (bool) {
        Battle storage b = battles[id];
        return b.walletA != address(0) && b.settled && block.timestamp >= b.endTime;
    }

    /// @notice Returns the Arena Score leaderboard. No ELO.
    function getLeaderboard() external view returns (address[] memory wallets, uint256[] memory scores, uint256[] memory wins) {
        uint256 n = leaderboard.length;
        wallets = new address[](n);
        scores = new uint256[](n);
        wins = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            address x = leaderboard[i];
            wallets[i] = x;
            scores[i] = arenaStats[x].arenaScore;
            wins[i] = arenaStats[x].wins;
        }
    }

    function getRecentBattles(address w) external view returns (uint256[] memory ids) {
        uint256 n = historyCount[w];
        uint256 c = n < 10 ? n : 10;
        ids = new uint256[](c);
        for (uint256 i = 0; i < c; i++) ids[i] = historyRing[w][(n - 1 - i) % 10];
    }

    function effectiveWeights(uint256 id) external view returns (uint256 a, uint256 b, uint256 pa, uint256 pb) {
        Battle storage x = battles[id];
        require(x.walletA != address(0), "no battle");
        (a, b) = _ew(x.votedApPoolA, x.votedApPoolB, x.powerA, x.powerB);
        return (a, b, x.powerA, x.powerB);
    }

    /// @notice Reads arena stats for a wallet. No ELO.
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

    // --- Admin ---
    function addTrustedCaller(address c) external onlyOwner {
        require(c != address(0), "zero");
        trustedCallers[c] = true;
        emit TrustedCallerSet(c, true);
    }
    function removeTrustedCaller(address c) external onlyOwner {
        trustedCallers[c] = false;
        emit TrustedCallerSet(c, false);
    }
    function transferOwnership(address n) external onlyOwner {
        require(n != address(0), "zero");
        pendingOwner = n;
        emit OwnershipTransferStarted(owner, n);
    }
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }
    function deductAP(address w, uint256 a) external onlyTrusted {
        require(ritualPoints[w] >= a, "no AP");
        ritualPoints[w] -= a;
        emit APDeducted(w, a, msg.sender);
    }
    function awardAP(address w, uint256 a, string calldata r) external onlyTrusted {
        if (block.timestamp >= lastAwardReset[msg.sender] + 1 days) {
            lastAwardReset[msg.sender] = block.timestamp;
            lastAwardEmitted[msg.sender] = 0;
        }
        require(lastAwardEmitted[msg.sender] + a <= MAX_AP_DAY, "cap");
        lastAwardEmitted[msg.sender] += a;
        _award(w, a, r);
    }
    mapping(address => uint256) public lastAwardReset;
    mapping(address => uint256) public lastAwardEmitted;

    // --- Internal ---
    function _p(address w) internal view returns (uint256) { return identityCard.getCurrentPower(w); }

    function _ew(uint256 rA, uint256 rB, uint256 pA, uint256 pB) internal pure returns (uint256 a, uint256 b) {
        if (pA == pB) return (rA, rB);
        uint256 d = pA > pB ? pA - pB : pb_safe(pA, pB);
        uint256 bp = 100 + (d * 100) / HANDICAP_DIV; if (bp > MAX_HANDICAP) bp = MAX_HANDICAP;
        if (pA < pB) return ((rA * bp) / 100, rB);
        return (rA, (rB * bp) / 100);
    }
    function pb_safe(uint256 pA, uint256 pB) internal pure returns (uint256) { return pB - pA; }

    function _award(address w, uint256 a, string memory r) internal {
        if (a == 0) return;
        ritualPoints[w] += a;
        emit PointsEarned(w, a, r, ritualPoints[w]);
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
        // Cap at 2_000 to fit the 20% Identity Score component ceiling.
        uint256 capped = s.arenaScore > 2000 ? 2000 : s.arenaScore;
        emit ArenaScoreUpdated(w, s.arenaScore, delta);
        // Push the (capped) Arena Score to the canonical IdentityRegistry
        // so the leaderboard updates automatically.
        if (address(identityRegistry) != address(0)) {
            identityRegistry.updateArena(w, capped);
        }
    }

    function _tiePools(uint256 id, Battle storage b) internal {
        if (b.ownerDepositA > 0) _award(b.walletA, b.ownerDepositA, "tie_refund");
        if (b.ownerDepositB > 0) _award(b.walletB, b.ownerDepositB, "tie_refund");
        uint256 vp = b.votedApPoolA + b.votedApPoolB; if (vp == 0) return;
        uint256 fee = (vp * FEE_BPS) / 10_000;
        votedApPoolClaimable[id] = vp - fee;
        if (fee > 0) _award(owner, fee, "fee_tie");
    }

    function _winPools(uint256 id, Battle storage b, address w) internal {
        uint256 op = b.ownerDepositA + b.ownerDepositB; if (op > 0) _award(w, op, "duel_win");
        uint256 wp = w == b.walletA ? b.votedApPoolA : b.votedApPoolB;
        uint256 lp = w == b.walletA ? b.votedApPoolB : b.votedApPoolA;
        if (wp == 0) { if (lp > 0) _award(owner, lp, "fee_no_backers"); return; }
        uint256 dist;
        if (lp > 0) { uint256 fee = (lp * FEE_BPS) / 10_000; dist = lp - fee; _award(owner, fee, "fee"); }
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
