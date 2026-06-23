// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRitualAnthem {
    struct Anthem {
        uint256 tokenId;
        address wallet;
        string xHandle;
        string mood;
        string lyrics;
        string musicPrompt;
        string audioURI;
        string metadataURI;
        uint256 createdAt;
    }

    function hasAnthem(address wallet) external view returns (bool);
    function getAnthem(address wallet) external view returns (Anthem memory);

    /// @notice Get the current on-chain power for a wallet's card.
    ///         Returns 0 if the wallet has no card or no snapshot.
    function getCurrentPower(address wallet) external view returns (uint16);

    /// @notice Get the current on-chain rarity rank for a wallet's card.
    ///         Returns 0 (COMMON) if the wallet has no card or no snapshot.
    function getCurrentRarity(address wallet) external view returns (uint8);

    /// @notice Check if a wallet has a valid CardSnapshot (snapshotVersion > 0).
    ///         Returns false for cards without a snapshot or wallets without a card.
    function hasCardSnapshot(address wallet) external view returns (bool);
}

/// @title Anthem Arena
/// @notice Duel + Arena Points layer for Ritual Arena.
/// @dev    Power is read from RitualAnthem CardSnapshot currentPower (1-100).
///         Wallets without a valid snapshot (snapshotVersion > 0) cannot battle.
contract AnthemArena is ReentrancyGuard {
    uint256 public constant POINTS_DAILY_CHECKIN = 10;
    uint256 public constant POINTS_MILESTONE_7 = 50;
    uint256 public constant POINTS_MILESTONE_14 = 100;
    uint256 public constant POINTS_MILESTONE_30 = 200;
    uint256 public constant POINTS_BATTLE_WIN = 30;
    uint256 public constant POINTS_BATTLE_TIE = 10;
    uint256 public constant POINTS_PASSIVE_VOTED = 5;

    uint256 public constant RP_PER_VOTE = 10;
    uint256 public constant MAX_VOTE_WEIGHT_PER_BATTLE = 50;
    uint256 internal constant _BATTLE_DURATION_SEC = 86400; // 24h in seconds
    uint256 internal constant _MATCHMAKING_COOLDOWN_SEC = 86400; // 24h in seconds
    uint256 internal constant _CYCLE_INTERVAL_SEC = 86400; // 24h in seconds
    uint256 internal constant _REPEAT_OPPONENT_COOLDOWN_SEC = 604800; // 7 days in seconds

    /// @notice Returns the battle duration in the chain's timestamp units.
    function _battleDuration() internal view returns (uint256) {
        return block.timestamp > 1e12 ? _BATTLE_DURATION_SEC * 1000 : _BATTLE_DURATION_SEC;
    }

    /// @notice Returns the matchmaking cooldown in the chain's timestamp units.
    function _matchmakingCooldown() internal view returns (uint256) {
        return block.timestamp > 1e12 ? _MATCHMAKING_COOLDOWN_SEC * 1000 : _MATCHMAKING_COOLDOWN_SEC;
    }

    /// @notice Returns the cycle interval in the chain's timestamp units.
    function _cycleInterval() internal view returns (uint256) {
        return block.timestamp > 1e12 ? _CYCLE_INTERVAL_SEC * 1000 : _CYCLE_INTERVAL_SEC;
    }

    /// @notice Returns the repeat opponent cooldown in the chain's timestamp units.
    function _repeatOpponentCooldown() internal view returns (uint256) {
        return block.timestamp > 1e12 ? _REPEAT_OPPONENT_COOLDOWN_SEC * 1000 : _REPEAT_OPPONENT_COOLDOWN_SEC;
    }

    uint256 public constant DAILY_MIN = 20 hours;
    uint256 public constant DAILY_MAX = 48 hours;
    uint256 public constant MILESTONE_7 = 7;
    uint256 public constant MILESTONE_14 = 14;
    uint256 public constant MILESTONE_30 = 30;
    uint256 public constant MIN_VOTERS_FOR_WIN_REWARD = 2;

    uint256 public constant ELO_START = 1000;
    uint256 public constant DUEL_ENTRY_FEE = 50;
    uint256 public constant PROTOCOL_FEE_BPS = 500;
    uint256 public constant HANDICAP_DIVISOR = 200;
    uint256 public constant MAX_HANDICAP_PCT = 150;
    uint256 public constant WINNER_VOTER_SHARE_PCT = 70;
    uint256 public constant CARD_WINNER_BONUS_PCT = 30;
    uint256 public constant MAX_AP_PER_CALLER_PER_DAY = 50_000;
    uint256 public constant MAX_POWER_DELTA = 35;
    uint256 public constant LEADERBOARD_SIZE = 20;

    // --- Auto-matchmaking ---
    /// Maximum battles created per daily matchmaking cycle.
    uint256 public constant MAX_DAILY_BATTLES = 20;
    // Cooldown after a battle before a wallet re-enters the matchmaking pool.
    // Old time constants replaced with timestamp-unit-aware functions above

    IRitualAnthem public immutable anthem;
    address public owner;
    address public pendingOwner;
    mapping(address => bool) public trustedCallers;
    // --- Auto-matchmaking storage ---
    /// Address allowed to call scheduleBatch (keeper / trusted EOA / multisig).
    address public keeper;
    /// Timestamp of the last matchmaking cycle.
    uint256 public lastCycletime;
    /// Per-wallet: timestamp when their last battle ended (for cooldown check).
    mapping(address => uint256) public lastBattleEndTime;
    /// Per-wallet: opt-out flag. Default false = opted in.
    mapping(address => bool) public arenaOptOut;
    /// Per-pair: timestamp of the last match (for repeat opponent protection).
    mapping(address => mapping(address => uint256)) public lastOpponentMatch;

    mapping(address => uint256) public ritualPoints;

    struct DailyStreak {
        uint64 streak;
        uint64 lastCheckIn;
        uint64 longestStreak;
        uint64 totalCheckIns;
    }

    mapping(address => DailyStreak) public dailyStreaks;
    mapping(address => uint8) public milestonesClaimed;

    enum Outcome {
        Unsettled,
        WinA,
        WinB,
        Tie
    }

    struct Battle {
        address walletA;
        address walletB;
        uint256 startTime;
        uint256 endTime;
        uint256 weightA;
        uint256 weightB;
        uint256 voterCount;
        bool settled;
        Outcome outcome;
        uint256 ownerDepositA;
        uint256 ownerDepositB;
        uint256 votedApPool;
        uint256 votedApPoolA;
        uint256 votedApPoolB;
        uint256 powerA;
        uint256 powerB;
        uint256 cardWinnerBonus;
        bool cardBonusClaimed;
    }

    uint256 public nextBattleId = 1;
    mapping(uint256 => Battle) public battles;
    mapping(address => uint256) public activeBattleOf;
    mapping(uint256 => mapping(address => uint256)) public weightUsed;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => bool)) public voterSide;
    mapping(uint256 => mapping(address => bool)) public voterSideSet;
    mapping(uint256 => mapping(address => bool)) public claimedVoterReward;
    mapping(uint256 => uint256) public votedApClaimableTotal;

    mapping(address => uint256) public elo;
    mapping(address => bool) public openToChallenge;
    mapping(address => uint256) public challengeDeposit;
    mapping(address => address) public pendingChallenge;
    mapping(address => address) public challengeTargetOf;

    mapping(uint256 => mapping(address => uint256)) public votedApA;
    mapping(uint256 => mapping(address => uint256)) public votedApB;
    struct CallerWindow {
        uint256 windowStart;
        uint256 emittedInWindow;
    }

    mapping(address => CallerWindow) public callerWindows;

    struct Player {
        uint256 wins;
        uint256 totalBattles;
        uint256 winStreak;
        uint256 bestWinStreak;
    }

    mapping(address => Player) public players;
    mapping(address => uint256[10]) private historyRing;
    mapping(address => uint256) public historyCount;
    address[] private leaderboard;
    mapping(address => bool) public onLeaderboard;

    event PointsEarned(address indexed wallet, uint256 amount, string reason, uint256 newBalance);
    event DailyCheckIn(address indexed wallet, uint256 streak, uint256 baseRP, uint256 bonusRP, uint256 newBalance);
    event BattleCreated(uint256 indexed battleId, address indexed walletA, address indexed walletB, uint256 endTime);
    event VoteCast(uint256 indexed battleId, address indexed voter, bool forA, uint256 weight, uint256 rpSpent);
    event BattleSettled(uint256 indexed battleId, address winner, uint256 weightA, uint256 weightB, uint256 voterCount);
    event TrustedCallerSet(address indexed caller, bool trusted);
    event APDeducted(address indexed wallet, uint256 amount, address indexed by);
    event ChallengeIssued(address indexed challenger, address indexed target);
    event ChallengeAccepted(address indexed challenger, address indexed target, uint256 battleId);
    event ChallengeCancelled(address indexed challenger, address indexed target);
    event ChallengeStatusSet(address indexed wallet, bool open);
    event VotedAP(uint256 indexed battleId, address indexed voter, bool forA, uint256 amount);
    event EloUpdated(address indexed winner, uint256 newWinnerElo, address indexed loser, uint256 newLoserElo);
    event OwnershipTransferStarted(address indexed prev, address indexed next);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event VoterRewardClaimed(uint256 indexed battleId, address indexed voter, uint256 amount);
    event CardWinnerBonusClaimed(uint256 indexed battleId, address indexed winner, uint256 amount);
    event VotedAPClaimed(uint256 indexed battleId, address indexed backer, uint256 amount);
    event MatchmakingCycleComplete(uint256 cycleTime, uint256 battlesCreated, uint256 skipped);
    event ArenaOptOut(address indexed wallet, bool optedOut);
    event KeeperSet(address indexed keeper);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyTrusted() {
        require(trustedCallers[msg.sender], "not a trusted caller");
        _;
    }

    constructor(address ritualAnthem_) {
        require(ritualAnthem_ != address(0), "zero anthem");
        anthem = IRitualAnthem(ritualAnthem_);
        owner = msg.sender;
        keeper = msg.sender;
    }

    function isEligible(address wallet) public view returns (bool) {
        return anthem.hasAnthem(wallet);
    }

    function dailyCheckIn() external returns (uint256 minted) {
        require(anthem.hasAnthem(msg.sender), "no anthem");

        DailyStreak storage d = dailyStreaks[msg.sender];
        if (d.lastCheckIn == 0) {
            d.streak = 1;
        } else {
            uint256 elapsed = block.timestamp - d.lastCheckIn;
            require(elapsed >= DAILY_MIN, "already checked in today");
            d.streak = elapsed <= DAILY_MAX ? d.streak + 1 : 1;
        }

        d.lastCheckIn = uint64(block.timestamp);
        d.totalCheckIns += 1;
        if (d.streak > d.longestStreak) d.longestStreak = d.streak;

        uint256 base = POINTS_DAILY_CHECKIN;
        uint256 bonus;
        uint8 bits = milestonesClaimed[msg.sender];
        if (d.streak >= MILESTONE_30 && (bits & 4) == 0) {
            bonus += POINTS_MILESTONE_30;
            bits |= 4;
        }
        if (d.streak >= MILESTONE_14 && (bits & 2) == 0) {
            bonus += POINTS_MILESTONE_14;
            bits |= 2;
        }
        if (d.streak >= MILESTONE_7 && (bits & 1) == 0) {
            bonus += POINTS_MILESTONE_7;
            bits |= 1;
        }
        milestonesClaimed[msg.sender] = bits;

        minted = base + bonus;
        ritualPoints[msg.sender] += minted;
        emit DailyCheckIn(msg.sender, d.streak, base, bonus, ritualPoints[msg.sender]);
    }

    /// @notice Admin-only legacy battle creation. User-facing duels use challenge flow.
    function createBattle(address walletA, address walletB, uint256 powerA, uint256 powerB) external onlyOwner returns (uint256 battleId) {
        battleId = _createBattle(walletA, walletB, powerA, powerB);
    }

    // ---------------------------------------------------------------------
    // Auto-matchmaking
    // ---------------------------------------------------------------------

    /// @notice Owner sets the keeper allowed to run matchmaking cycles.
    function setKeeper(address keeper_) external onlyOwner {
        require(keeper_ != address(0), "zero keeper");
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function keeperIsOwner() external view returns (bool) {
        return keeper == owner;
    }

    /// @notice Toggle matchmaking participation. Call with true to opt out,
    ///         false to re-enter the pool.
    function setArenaOptOut(bool optOut) external {
        require(anthem.hasAnthem(msg.sender), "no anthem");
        arenaOptOut[msg.sender] = optOut;
        emit ArenaOptOut(msg.sender, optOut);
    }

    /// @notice Check if a wallet is eligible for matchmaking right now.
    ///         Requires a valid CardSnapshot (snapshotVersion > 0).
    function isMatchmakingEligible(address wallet) public view returns (bool, string memory) {
        if (!anthem.hasAnthem(wallet)) return (false, "no anthem");
        if (!anthem.hasCardSnapshot(wallet)) return (false, "no card snapshot");
        if (arenaOptOut[wallet]) return (false, "opted out");
        if (activeBattleOf[wallet] != 0) return (false, "in active battle");
        if (block.timestamp < lastBattleEndTime[wallet] + _matchmakingCooldown()) return (false, "matchmaking cooldown active");
        return (true, "eligible");
    }

    /// @notice Called by the keeper with pre-computed pairs. Each pair is
    ///         [walletA, walletB] with matching [powerA, powerB]. The contract
    ///         re-verifies every pair before creating a battle, so the keeper
    ///         can never force an invalid or unfair match. Invalid pairs are
    ///         skipped (not reverted) so one bad pair cannot block the cycle.
    /// @param wallets Array of [walletA, walletB] tuples.
    /// @param powers  Array of [powerA, powerB] tuples (current CardSnapshot power values).
    function scheduleBatch(address[2][] calldata wallets, uint256[2][] calldata powers) external nonReentrant {
        require(msg.sender == keeper, "not keeper");
        require(wallets.length == powers.length, "length mismatch");
        require(wallets.length > 0, "empty batch");
        require(block.timestamp >= lastCycletime + _cycleInterval(), "cycle too soon");
        require(wallets.length <= MAX_DAILY_BATTLES, "exceeds max battles");

        lastCycletime = block.timestamp;
        uint256 created;
        uint256 skipped;

        for (uint256 i = 0; i < wallets.length; i++) {
            address a = wallets[i][0];
            address b = wallets[i][1];
            uint256 pA = powers[i][0];
            uint256 pB = powers[i][1];

            if (a == b) {
                skipped++;
                continue;
            }

            // Re-verify eligibility on-chain - the keeper cannot force an invalid battle.
            (bool eligA, ) = isMatchmakingEligible(a);
            (bool eligB, ) = isMatchmakingEligible(b);
            if (!eligA || !eligB) {
                skipped++;
                continue;
            }

            // Power scores must match stored CardSnapshot currentPower and stay within delta.
            if (pA > 100 || pB > 100 || pA != _powerOf(a) || pB != _powerOf(b)) {
                skipped++;
                continue;
            }
            uint256 delta = pA > pB ? pA - pB : pB - pA;
            if (delta > MAX_POWER_DELTA) {
                skipped++;
                continue;
            }

            // Reject repeat opponents within the cooldown window.
            if (block.timestamp < lastOpponentMatch[a][b] + _repeatOpponentCooldown()) {
                skipped++;
                continue;
            }
            if (block.timestamp < lastOpponentMatch[b][a] + _repeatOpponentCooldown()) {
                skipped++;
                continue;
            }

            // All guards above guarantee _createBattle's requires never revert.
            _createBattle(a, b, pA, pB);
            created++;
        }

        emit MatchmakingCycleComplete(block.timestamp, created, skipped);
    }

    function setOpenToChallenge(bool open) external {
        require(anthem.hasAnthem(msg.sender), "no card");
        openToChallenge[msg.sender] = open;
        emit ChallengeStatusSet(msg.sender, open);
    }

    function issueChallenge(address target) external {
        require(anthem.hasAnthem(msg.sender), "no card");
        require(anthem.hasCardSnapshot(msg.sender), "no snapshot");
        require(anthem.hasCardSnapshot(target), "target has no snapshot");
        require(target != msg.sender, "cannot challenge self");
        require(openToChallenge[target], "target not open to matchmaking");
        require(!arenaOptOut[msg.sender], "opted out");
        require(!arenaOptOut[target], "target opted out");
        require(activeBattleOf[target] == 0, "target already in duel");
        require(activeBattleOf[msg.sender] == 0, "already in duel");
        require(block.timestamp >= lastBattleEndTime[msg.sender] + _matchmakingCooldown(), "matchmaking cooldown active");
        require(block.timestamp >= lastBattleEndTime[target] + _matchmakingCooldown(), "target in cooldown");
        require(pendingChallenge[target] == address(0), "pending challenge exists");
        require(challengeTargetOf[msg.sender] == address(0), "already has active challenge");
        require(ritualPoints[msg.sender] >= DUEL_ENTRY_FEE, "insufficient AP for duel entry fee");

        ritualPoints[msg.sender] -= DUEL_ENTRY_FEE;
        challengeDeposit[msg.sender] = DUEL_ENTRY_FEE;
        pendingChallenge[target] = msg.sender;
        challengeTargetOf[msg.sender] = target;

        emit ChallengeIssued(msg.sender, target);
    }

    function acceptChallenge() external returns (uint256 battleId) {
        address challenger = pendingChallenge[msg.sender];
        require(challenger != address(0), "no pending challenge");
        require(activeBattleOf[msg.sender] == 0, "target in duel");
        require(activeBattleOf[challenger] == 0, "challenger in duel");
        require(block.timestamp >= lastBattleEndTime[msg.sender] + _matchmakingCooldown(), "you in cooldown");
        require(block.timestamp >= lastBattleEndTime[challenger] + _matchmakingCooldown(), "challenger in cooldown");
        require(ritualPoints[msg.sender] >= DUEL_ENTRY_FEE, "insufficient AP");

        ritualPoints[msg.sender] -= DUEL_ENTRY_FEE;
        pendingChallenge[msg.sender] = address(0);
        challengeTargetOf[challenger] = address(0);
        challengeDeposit[challenger] = 0;

        battleId = _createBattle(challenger, msg.sender, _powerOf(challenger), _powerOf(msg.sender));
        Battle storage b = battles[battleId];
        b.ownerDepositA = DUEL_ENTRY_FEE;
        b.ownerDepositB = DUEL_ENTRY_FEE;
        b.votedApPool = DUEL_ENTRY_FEE * 2;

        emit ChallengeAccepted(challenger, msg.sender, battleId);
    }

    function cancelChallenge(address target) external {
        require(pendingChallenge[target] == msg.sender, "not your challenge");
        _cancelChallenge(msg.sender, target);
    }

    function declineChallenge() external {
        address challenger = pendingChallenge[msg.sender];
        require(challenger != address(0), "no pending challenge");
        _cancelChallenge(challenger, msg.sender);
    }

    function voteAP(uint256 battleId, bool forA, uint256 apAmount) external {
        Battle storage b = battles[battleId];
        require(b.walletA != address(0), "no battle");
        require(!b.settled, "settled");
        require(block.timestamp < b.endTime, "ended");
        require(apAmount > 0, "zero voted AP");
        require(msg.sender != b.walletA && msg.sender != b.walletB, "owner cannot vote AP");
        require(ritualPoints[msg.sender] >= apAmount, "insufficient AP");

        if (!voterSideSet[battleId][msg.sender]) {
            voterSide[battleId][msg.sender] = forA;
            voterSideSet[battleId][msg.sender] = true;
        } else {
            require(voterSide[battleId][msg.sender] == forA, "cannot switch sides");
        }

        ritualPoints[msg.sender] -= apAmount;
        if (forA) {
            votedApA[battleId][msg.sender] += apAmount;
            b.votedApPoolA += apAmount;
        } else {
            votedApB[battleId][msg.sender] += apAmount;
            b.votedApPoolB += apAmount;
        }
        b.votedApPool += apAmount;

        emit VotedAP(battleId, msg.sender, forA, apAmount);
    }

    function castVote(uint256 battleId, bool forA, uint256 weight) external {
        Battle storage b = battles[battleId];
        require(b.walletA != address(0), "no such battle");
        require(!b.settled, "battle settled");
        require(block.timestamp < b.endTime, "battle ended");
        require(msg.sender != b.walletA && msg.sender != b.walletB, "owner cannot vote");
        require(weight >= 1, "min 1 vote weight");

        uint256 used = weightUsed[battleId][msg.sender];
        require(used + weight <= MAX_VOTE_WEIGHT_PER_BATTLE, "exceeds 50 weight cap");

        uint256 cost = weight * RP_PER_VOTE;
        require(ritualPoints[msg.sender] >= cost, "insufficient RP");

        ritualPoints[msg.sender] -= cost;
        weightUsed[battleId][msg.sender] = used + weight;
        if (!hasVoted[battleId][msg.sender]) {
            hasVoted[battleId][msg.sender] = true;
            b.voterCount += 1;
        }
        if (!voterSideSet[battleId][msg.sender]) {
            voterSide[battleId][msg.sender] = forA;
            voterSideSet[battleId][msg.sender] = true;
        } else {
            require(voterSide[battleId][msg.sender] == forA, "cannot switch sides");
        }
        if (forA) b.weightA += weight;
        else b.weightB += weight;

        emit VoteCast(battleId, msg.sender, forA, weight, cost);
    }

    function settle(uint256 battleId) external nonReentrant {
        Battle storage b = battles[battleId];
        require(b.walletA != address(0), "no such battle");
        require(!b.settled, "already settled");
        require(block.timestamp >= b.endTime, "battle still live");

        address a = b.walletA;
        address c = b.walletB;
        uint256 wA = b.weightA;
        uint256 wB = b.weightB;

        b.settled = true;
        activeBattleOf[a] = 0;
        activeBattleOf[c] = 0;
        // Start the matchmaking cooldown for both duelists.
        lastBattleEndTime[a] = block.timestamp;
        lastBattleEndTime[c] = block.timestamp;
        // Record opponent match for repeat-opponent protection.
        lastOpponentMatch[a][c] = block.timestamp;
        lastOpponentMatch[c][a] = block.timestamp;

        players[a].totalBattles += 1;
        players[c].totalBattles += 1;

        if (wA == 0 && wB == 0) {
            b.outcome = Outcome.Tie;
            players[a].winStreak = 0;
            players[c].winStreak = 0;
            _settleTiePools(battleId, b);
            _pushHistory(a, battleId);
            _pushHistory(c, battleId);
            emit BattleSettled(battleId, address(0), wA, wB, b.voterCount);
            return;
        }

        if (wA > 0) _award(a, POINTS_PASSIVE_VOTED, "passive_votes");
        if (wB > 0) _award(c, POINTS_PASSIVE_VOTED, "passive_votes");

        (uint256 effA, uint256 effB) = _effectiveWeights(wA, wB, b.powerA, b.powerB);

        address winner;
        if (effA > effB) {
            winner = a;
            b.outcome = Outcome.WinA;
        } else if (effB > effA) {
            winner = c;
            b.outcome = Outcome.WinB;
        } else {
            b.outcome = Outcome.Tie;
        }

        if (winner == address(0)) {
            _award(a, POINTS_BATTLE_TIE, "tie");
            _award(c, POINTS_BATTLE_TIE, "tie");
            players[a].winStreak = 0;
            players[c].winStreak = 0;
            _settleTiePools(battleId, b);
        } else {
            address loser = winner == a ? c : a;
            uint256 loserWeight = winner == a ? wB : wA;
            if (loserWeight > 0) {
                b.cardWinnerBonus = (loserWeight * RP_PER_VOTE * CARD_WINNER_BONUS_PCT) / 100;
            }
            if (b.voterCount >= MIN_VOTERS_FOR_WIN_REWARD) {
                _award(winner, POINTS_BATTLE_WIN, "battle_win");
            }

            Player storage wp = players[winner];
            wp.wins += 1;
            wp.winStreak += 1;
            if (wp.winStreak > wp.bestWinStreak) wp.bestWinStreak = wp.winStreak;
            players[loser].winStreak = 0;

            _applyElo(winner, loser);
            _settleWinnerPools(battleId, b, winner);
            _updateLeaderboard(winner);
            _updateLeaderboard(loser);
        }

        _pushHistory(a, battleId);
        _pushHistory(c, battleId);
        emit BattleSettled(battleId, winner, wA, wB, b.voterCount);
    }

    function claimVoterReward(uint256 battleId) external nonReentrant {
        Battle storage b = battles[battleId];
        require(b.settled, "battle not settled");
        require(b.outcome != Outcome.Tie, "no redistribution on tie");
        require(hasVoted[battleId][msg.sender], "did not vote");
        require(!claimedVoterReward[battleId][msg.sender], "already claimed");

        bool winnerIsA = b.outcome == Outcome.WinA;
        require(voterSide[battleId][msg.sender] == winnerIsA, "voted for losing side");

        uint256 winnerWeight = winnerIsA ? b.weightA : b.weightB;
        uint256 loserWeight = winnerIsA ? b.weightB : b.weightA;
        uint256 poolForVoters = (loserWeight * RP_PER_VOTE * WINNER_VOTER_SHARE_PCT) / 100;
        uint256 voterShare = (weightUsed[battleId][msg.sender] * poolForVoters) / winnerWeight;
        require(voterShare > 0, "share rounds to zero");

        claimedVoterReward[battleId][msg.sender] = true;
        _award(msg.sender, voterShare, "voter_reward");
        emit VoterRewardClaimed(battleId, msg.sender, voterShare);
    }

    function claimCardWinnerBonus(uint256 battleId) external nonReentrant {
        Battle storage b = battles[battleId];
        require(b.settled, "battle not settled");
        require(b.outcome != Outcome.Tie, "no bonus on tie");
        require(!b.cardBonusClaimed, "already claimed");

        address cardWinner = b.outcome == Outcome.WinA ? b.walletA : b.walletB;
        require(msg.sender == cardWinner, "not the card winner");
        require(b.cardWinnerBonus > 0, "no bonus (no losing votes)");

        b.cardBonusClaimed = true;
        _award(msg.sender, b.cardWinnerBonus, "card_winner_bonus");
        emit CardWinnerBonusClaimed(battleId, msg.sender, b.cardWinnerBonus);
    }

    function claimVotedAP(uint256 battleId) external nonReentrant {
        Battle storage b = battles[battleId];
        require(b.settled, "not settled");

        bool isTie = b.outcome == Outcome.Tie;
        uint256 stakeA = votedApA[battleId][msg.sender];
        uint256 stakeB = votedApB[battleId][msg.sender];
        uint256 myStake = stakeA + stakeB;
        require(myStake > 0, "no stake");

        if (isTie) {
            uint256 totalPool = b.votedApPoolA + b.votedApPoolB;
            require(totalPool > 0, "no pool");

            uint256 tieDistributable = votedApClaimableTotal[battleId];
            uint256 share = (myStake * tieDistributable) / totalPool;

            votedApA[battleId][msg.sender] = 0;
            votedApB[battleId][msg.sender] = 0;

            if (share > 0) _award(msg.sender, share, "voted_ap_tie_refund");
            emit VotedAPClaimed(battleId, msg.sender, share);
            return;
        }

        bool winnerIsA = b.outcome == Outcome.WinA;
        uint256 myWinnerStake = winnerIsA ? stakeA : stakeB;
        require(myWinnerStake > 0, "voted for losing side");

        uint256 winnerPool = winnerIsA ? b.votedApPoolA : b.votedApPoolB;
        uint256 distributable = votedApClaimableTotal[battleId];
        uint256 profitShare = distributable > 0 ? (myWinnerStake * distributable) / winnerPool : 0;

        votedApA[battleId][msg.sender] = 0;
        votedApB[battleId][msg.sender] = 0;

        uint256 payout = myWinnerStake + profitShare;
        _award(msg.sender, payout, "voted_ap_win");
        emit VotedAPClaimed(battleId, msg.sender, payout);
    }

    function previewVoterReward(uint256 battleId, address voter)
        external
        view
        returns (uint256 share, bool eligible, string memory reason)
    {
        Battle storage b = battles[battleId];
        if (!b.settled) return (0, false, "not settled");
        if (b.outcome == Outcome.Tie) return (0, false, "tie battle");
        if (!hasVoted[battleId][voter]) return (0, false, "did not vote");
        if (claimedVoterReward[battleId][voter]) return (0, false, "already claimed");

        bool winnerIsA = b.outcome == Outcome.WinA;
        if (voterSide[battleId][voter] != winnerIsA) return (0, false, "voted for loser");

        uint256 winnerWeight = winnerIsA ? b.weightA : b.weightB;
        uint256 loserWeight = winnerIsA ? b.weightB : b.weightA;
        uint256 poolForVoters = (loserWeight * RP_PER_VOTE * WINNER_VOTER_SHARE_PCT) / 100;
        share = (weightUsed[battleId][voter] * poolForVoters) / winnerWeight;
        return (share, share > 0, share > 0 ? "eligible" : "share rounds to zero");
    }

    function effectiveWeights(uint256 battleId) external view returns (uint256 effA, uint256 effB, uint256 powerA, uint256 powerB) {
        Battle storage b = battles[battleId];
        require(b.walletA != address(0), "no such battle");
        (effA, effB) = _effectiveWeights(b.weightA, b.weightB, b.powerA, b.powerB);
        return (effA, effB, b.powerA, b.powerB);
    }

    function addTrustedCaller(address caller) external onlyOwner {
        require(caller != address(0), "zero caller");
        trustedCallers[caller] = true;
        emit TrustedCallerSet(caller, true);
    }

    function removeTrustedCaller(address caller) external onlyOwner {
        trustedCallers[caller] = false;
        emit TrustedCallerSet(caller, false);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function deductAP(address wallet, uint256 amount) external onlyTrusted {
        require(ritualPoints[wallet] >= amount, "insufficient AP");
        ritualPoints[wallet] -= amount;
        emit APDeducted(wallet, amount, msg.sender);
    }

    function awardAP(address wallet, uint256 amount, string calldata reason) external onlyTrusted {
        CallerWindow storage w = callerWindows[msg.sender];
        if (block.timestamp >= w.windowStart + 1 days) {
            w.windowStart = block.timestamp;
            w.emittedInWindow = 0;
        }
        require(w.emittedInWindow + amount <= MAX_AP_PER_CALLER_PER_DAY, "daily cap");
        w.emittedInWindow += amount;
        _award(wallet, amount, reason);
    }

    /// @notice Internal battle creation. Power must match CardSnapshot currentPower (1-100).
    ///         Both wallets must have valid snapshots (snapshotVersion > 0).
    function _createBattle(address walletA, address walletB, uint256 powerA, uint256 powerB) internal returns (uint256 battleId) {
        require(walletA != walletB, "same wallet");
        require(walletA != address(0) && walletB != address(0), "zero wallet");
        require(anthem.hasAnthem(walletA), "A has no anthem");
        require(anthem.hasAnthem(walletB), "B has no anthem");
        require(anthem.hasCardSnapshot(walletA), "A no snap");
        require(anthem.hasCardSnapshot(walletB), "B no snap");
        require(activeBattleOf[walletA] == 0, "A in a battle");
        require(activeBattleOf[walletB] == 0, "B in a battle");
        require(powerA <= 100 && powerB <= 100, "power OOR");
        require(powerA == _powerOf(walletA) && powerB == _powerOf(walletB), "power mismatch");
        require(powerA > 0 && powerB > 0, "zero");

        battleId = nextBattleId++;
        Battle storage b = battles[battleId];
        b.walletA = walletA;
        b.walletB = walletB;
        b.startTime = block.timestamp;
        b.endTime = block.timestamp + _battleDuration();
        b.outcome = Outcome.Unsettled;
        b.powerA = powerA;
        b.powerB = powerB;

        activeBattleOf[walletA] = battleId;
        activeBattleOf[walletB] = battleId;

        emit BattleCreated(battleId, walletA, walletB, b.endTime);
    }

    function _effectiveWeights(uint256 rawA, uint256 rawB, uint256 powerA, uint256 powerB)
        internal
        pure
        returns (uint256 effA, uint256 effB)
    {
        if (powerA == powerB) return (rawA, rawB);
        uint256 delta = powerA > powerB ? powerA - powerB : powerB - powerA;
        uint256 bonusPct = 100 + (delta * 100) / HANDICAP_DIVISOR;
        if (bonusPct > MAX_HANDICAP_PCT) bonusPct = MAX_HANDICAP_PCT;
        if (powerA < powerB) return ((rawA * bonusPct) / 100, rawB);
        return (rawA, (rawB * bonusPct) / 100);
    }

    function _powerOf(address wallet) internal view returns (uint256) {
        return anthem.getCurrentPower(wallet);
    }



    function _cancelChallenge(address challenger, address target) internal {
        pendingChallenge[target] = address(0);
        challengeTargetOf[challenger] = address(0);
        uint256 refund = challengeDeposit[challenger];
        challengeDeposit[challenger] = 0;
        if (refund > 0) ritualPoints[challenger] += refund;
        emit ChallengeCancelled(challenger, target);
    }

    function _award(address wallet, uint256 amount, string memory reason) internal {
        if (amount == 0) return;
        ritualPoints[wallet] += amount;
        emit PointsEarned(wallet, amount, reason, ritualPoints[wallet]);
    }

    function _applyElo(address winner, address loser) internal {
        uint256 winnerElo = _effectiveElo(winner);
        uint256 loserElo = _effectiveElo(loser);
        (uint256 gain, uint256 lossElo) = _eloChange(winnerElo, loserElo);

        uint256 nextWinner = winnerElo + gain;
        uint256 nextLoser = loserElo > lossElo ? loserElo - lossElo : 100;
        if (nextLoser < 100) nextLoser = 100;

        elo[winner] = nextWinner;
        elo[loser] = nextLoser;
        emit EloUpdated(winner, nextWinner, loser, nextLoser);
    }

    function _settleWinnerPools(uint256 battleId, Battle storage b, address winner) internal {
        uint256 ownerPool = b.ownerDepositA + b.ownerDepositB;
        if (ownerPool > 0) _award(winner, ownerPool, "duel_owner_win");

        bool winnerIsA = winner == b.walletA;
        uint256 winnerPool = winnerIsA ? b.votedApPoolA : b.votedApPoolB;
        uint256 loserPool = winnerIsA ? b.votedApPoolB : b.votedApPoolA;

        if (winnerPool == 0) {
            if (loserPool > 0) _award(owner, loserPool, "protocol_fee_no_winners");
            return;
        }

        uint256 distributable;
        if (loserPool > 0) {
            uint256 fee = (loserPool * PROTOCOL_FEE_BPS) / 10_000;
            distributable = loserPool - fee;
            _award(owner, fee, "protocol_fee");
        }

        votedApClaimableTotal[battleId] = distributable;
    }

    function _settleTiePools(uint256 battleId, Battle storage b) internal {
        if (b.ownerDepositA > 0) _award(b.walletA, b.ownerDepositA, "duel_tie_refund");
        if (b.ownerDepositB > 0) _award(b.walletB, b.ownerDepositB, "duel_tie_refund");

        uint256 votedPool = b.votedApPoolA + b.votedApPoolB;
        if (votedPool == 0) return;

        uint256 fee = (votedPool * PROTOCOL_FEE_BPS) / 10_000;
        uint256 distributable = votedPool - fee;

        if (fee > 0) _award(owner, fee, "protocol_fee_tie");
        votedApClaimableTotal[battleId] = distributable;
    }

    function _pushHistory(address wallet, uint256 battleId) internal {
        uint256 n = historyCount[wallet];
        historyRing[wallet][n % 10] = battleId;
        historyCount[wallet] = n + 1;
    }

    function _updateLeaderboard(address wallet) internal {
        uint256 score = _effectiveElo(wallet);
        uint256 len = leaderboard.length;

        if (!onLeaderboard[wallet]) {
            if (len < LEADERBOARD_SIZE) {
                leaderboard.push(wallet);
                onLeaderboard[wallet] = true;
            } else {
                address last = leaderboard[len - 1];
                if (_effectiveElo(last) >= score) return;
                onLeaderboard[last] = false;
                leaderboard[len - 1] = wallet;
                onLeaderboard[wallet] = true;
            }
        }
        _sortLeaderboard();
    }

    function _sortLeaderboard() private {
        uint256 len = leaderboard.length;
        for (uint256 i = 1; i < len; i++) {
            address current = leaderboard[i];
            uint256 currentScore = _effectiveElo(current);
            uint256 j = i;
            while (j > 0 && _effectiveElo(leaderboard[j - 1]) < currentScore) {
                leaderboard[j] = leaderboard[j - 1];
                j--;
            }
            leaderboard[j] = current;
        }
    }

    function _effectiveElo(address wallet) internal view returns (uint256) {
        uint256 e = elo[wallet];
        return e == 0 ? ELO_START : e;
    }

    function _eloChange(uint256 winnerElo, uint256 loserElo) internal pure returns (uint256 gain, uint256 loss) {
        uint256 base = 20;
        if (winnerElo >= loserElo) {
            uint256 diff = (winnerElo - loserElo) / 100;
            gain = diff >= base ? 3 : base - diff;
            loss = diff >= base ? 35 : base + diff;
        } else {
            uint256 diff = (loserElo - winnerElo) / 100;
            gain = base + (diff * 3);
            gain = gain > 50 ? 50 : gain;
            loss = diff >= base ? 3 : base - diff;
        }
    }

    function checkInPreview(address wallet)
        external
        view
        returns (bool canCheckIn, uint256 secsUntilNext, uint256 nextStreak, uint256 baseReward, uint256 bonusReward)
    {
        if (!anthem.hasAnthem(wallet)) return (false, 0, 0, 0, 0);
        DailyStreak storage d = dailyStreaks[wallet];

        if (d.lastCheckIn == 0) {
            canCheckIn = true;
            nextStreak = 1;
        } else {
            uint256 elapsed = block.timestamp - d.lastCheckIn;
            if (elapsed < DAILY_MIN) {
                canCheckIn = false;
                secsUntilNext = DAILY_MIN - elapsed;
            } else {
                canCheckIn = true;
            }
            nextStreak = elapsed > DAILY_MAX ? 1 : uint256(d.streak) + 1;
        }

        baseReward = POINTS_DAILY_CHECKIN;
        uint8 bits = milestonesClaimed[wallet];
        if (nextStreak >= MILESTONE_30 && (bits & 4) == 0) bonusReward += POINTS_MILESTONE_30;
        if (nextStreak >= MILESTONE_14 && (bits & 2) == 0) bonusReward += POINTS_MILESTONE_14;
        if (nextStreak >= MILESTONE_7 && (bits & 1) == 0) bonusReward += POINTS_MILESTONE_7;
    }

    function weightLeft(uint256 battleId, address voter) external view returns (uint256) {
        return MAX_VOTE_WEIGHT_PER_BATTLE - weightUsed[battleId][voter];
    }

    function timeLeft(uint256 battleId) external view returns (uint256) {
        Battle storage b = battles[battleId];
        if (b.walletA == address(0) || block.timestamp >= b.endTime) return 0;
        return b.endTime - block.timestamp;
    }

    function isSettleable(uint256 battleId) external view returns (bool) {
        Battle storage b = battles[battleId];
        return b.walletA != address(0) && !b.settled && block.timestamp >= b.endTime;
    }

    function getRecentBattles(address wallet) external view returns (uint256[] memory ids) {
        uint256 n = historyCount[wallet];
        uint256 count = n < 10 ? n : 10;
        ids = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            ids[i] = historyRing[wallet][(n - 1 - i) % 10];
        }
    }

    function getLeaderboard() external view returns (address[] memory wallets, uint256[] memory ratings, uint256[] memory wins) {
        uint256 len = leaderboard.length;
        wallets = new address[](len);
        ratings = new uint256[](len);
        wins = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            address w = leaderboard[i];
            wallets[i] = w;
            ratings[i] = _effectiveElo(w);
            wins[i] = players[w].wins;
        }
    }

    function rankTier(address wallet) public view returns (string memory) {
        uint256 e = _effectiveElo(wallet);
        if (e >= 4000) return "LEGEND";
        if (e >= 3000) return "CHAMPION";
        if (e >= 2000) return "ELITE";
        if (e >= 1000) return "CONTENDER";
        return "ROOKIE";
    }

    // Faction identity — reserved.
}
