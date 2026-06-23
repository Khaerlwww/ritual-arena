// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title Identity Registry
/// @notice Canonical Identity Score registry for Ritual Arena.
///
/// Stores all 5 score components per wallet:
///   - trainingScore      (40% of max 1_000)
///   - achievementScore   (30%)
///   - arenaScore         (20%)
///   - collectionScore    (10%)
///   - totalScore         (sum, max 1_000)
///
/// Auto-recomputes the official Identity Rank on every update.
///
/// Trusted updaters (Training, Arena, AchievementRegistry, PackManager,
/// IdentityCard) push components directly. The registry derives
/// totalScore and rank automatically — no manual sync required.
contract IdentityRegistry is Ownable2Step, Pausable {
    // ── Official Identity Rank thresholds (max 1_000) ──
    // Identity Score is normalized to a Rank Score first:
    //   rankScore = identityScore (already in 0..1000)
    //
    // Rank Score 0..99    -> INITIATE
    // Rank Score 100..249  -> ASCENDANT
    // Rank Score 250..449  -> BITTY
    // Rank Score 450..699  -> RITTY
    // Rank Score 700..899  -> RITUALIST
    // Rank Score 900..1000 -> RADIANT RITUALIST
    uint256 public constant RANK_INITIATE_MAX = 99;
    uint256 public constant RANK_ASCENDANT_MAX = 249;
    uint256 public constant RANK_BITTY_MAX = 449;
    uint256 public constant RANK_RITTY_MAX = 699;
    uint256 public constant RANK_RITUALIST_MAX = 899;
    uint256 public constant RANK_RADIANT_RITUALIST_MAX = 1_000;

    uint8 public constant RANK_INITIATE = 0;
    uint8 public constant RANK_ASCENDANT = 1;
    uint8 public constant RANK_BITTY = 2;
    uint8 public constant RANK_RITTY = 3;
    uint8 public constant RANK_RITUALIST = 4;
    uint8 public constant RANK_RADIANT_RITUALIST = 5;

    // ── Score component caps (max contributions) ──
    // 40% / 30% / 20% / 10% of 1_000 = 400 / 300 / 200 / 100
    uint256 public constant MAX_TRAINING_SCORE = 400;
    uint256 public constant MAX_ACHIEVEMENT_SCORE = 300;
    uint256 public constant MAX_ARENA_SCORE = 200;
    uint256 public constant MAX_COLLECTION_SCORE = 100;
    uint256 public constant MAX_TOTAL_SCORE = 1_000;

    /// @notice Per-wallet snapshot of all 5 score components + derived rank.
    struct IdentitySnapshot {
        uint256 trainingScore;
        uint256 achievementScore;
        uint256 arenaScore;
        uint256 collectionScore;
        uint256 totalScore;
        uint8 rank;             // 0..5 (INITIATE..RADIANT RITUALIST)
        uint256 trainingLevel;  // 0 if unknown
        uint256 totalXp;        // 0 if unknown
        uint16 currentPower;    // 0 if unknown
        uint8 currentRarity;    // 0..4 (COMMON..MYTHIC)
        uint32 version;         // monotonic per-wallet
        uint64 updatedAt;
    }

    mapping(address => IdentitySnapshot) private snapshots;
    mapping(address => bool) public trustedUpdaters;
    address[] public indexedWallets;

    mapping(address => bool) private _indexed;
    mapping(address => uint256) private _indexPos;

    event TrustedUpdaterSet(address indexed updater, bool trusted);
    event IdentityScoreUpdated(
        address indexed wallet,
        uint256 trainingScore,
        uint256 achievementScore,
        uint256 arenaScore,
        uint256 collectionScore,
        uint256 totalScore,
        uint8 rank,
        uint16 currentPower,
        uint8 currentRarity,
        uint32 version
    );

    modifier onlyUpdater() {
        require(msg.sender == owner() || trustedUpdaters[msg.sender], "not updater");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {
        require(initialOwner != address(0), "zero owner");
    }

    function setTrustedUpdater(address updater, bool trusted) external onlyOwner {
        require(updater != address(0), "zero updater");
        trustedUpdaters[updater] = trusted;
        emit TrustedUpdaterSet(updater, trusted);
    }

    /// @notice Pure normalization helper. The Identity Score is already
    ///         in 0..MAX_TOTAL_SCORE (=1_000) range; rankScore IS the
    ///         score (no scaling). Returns the canonical Identity Rank
    ///         (0..5) from the given totalScore.
    function rankForScore(uint256 score) public pure returns (uint8) {
        if (score > MAX_TOTAL_SCORE) score = MAX_TOTAL_SCORE;
        uint256 rankScore = score; // already 0..1000
        if (rankScore > RANK_RITUALIST_MAX) return RANK_RADIANT_RITUALIST;
        if (rankScore > RANK_RITTY_MAX) return RANK_RITUALIST;
        if (rankScore > RANK_BITTY_MAX) return RANK_RITTY;
        if (rankScore > RANK_ASCENDANT_MAX) return RANK_BITTY;
        if (rankScore > RANK_INITIATE_MAX) return RANK_ASCENDANT;
        return RANK_INITIATE;
    }

    /// @notice Read the canonical Identity Score snapshot for a wallet.
    function getIdentity(address wallet) external view returns (IdentitySnapshot memory) {
        return snapshots[wallet];
    }

    /// @notice Convenience: total score only.
    function getTotalScore(address wallet) external view returns (uint256) {
        return snapshots[wallet].totalScore;
    }

    /// @notice Convenience: rank only.
    function getRank(address wallet) external view returns (uint8) {
        return snapshots[wallet].rank;
    }

    /// @notice Number of wallets currently indexed (for the leaderboard).
    function indexedLength() external view returns (uint256) {
        return indexedWallets.length;
    }

    /// @notice All indexed wallets (for the global leaderboard).
    function getIndexedWallets(uint256 offset, uint256 limit) external view returns (address[] memory wallets) {
        uint256 len = indexedWallets.length;
        if (offset >= len) return new address[](0);
        uint256 end = offset + limit;
        if (end > len) end = len;
        wallets = new address[](end - offset);
        for (uint256 i = 0; i < end - offset; i++) {
            wallets[i] = indexedWallets[offset + i];
        }
    }

    // ── Trusted-updater entry points ──
    // Each trusted protocol contract calls the matching function after it
    // changes its own state. The registry derives totalScore and rank here.

    /// @notice Training contract calls this when a wallet trains.
    function updateTraining(
        address wallet,
        uint256 trainingScore,
        uint256 trainingLevel,
        uint256 totalXp
    ) external onlyUpdater whenNotPaused {
        _setComponent(wallet, "training", trainingScore, trainingLevel, totalXp);
    }

    /// @notice AchievementRegistry / PackManager / IdentityCard
    ///         call these to push their own component values.
    function updateAchievement(address wallet, uint256 achievementScore) external onlyUpdater whenNotPaused {
        _setComponent(wallet, "achievement", achievementScore, 0, 0);
    }

    function updateArena(address wallet, uint256 arenaScore) external onlyUpdater whenNotPaused {
        _setComponent(wallet, "arena", arenaScore, 0, 0);
    }

    function updateCollection(address wallet, uint256 collectionScore) external onlyUpdater whenNotPaused {
        _setComponent(wallet, "collection", collectionScore, 0, 0);
    }

    /// @notice Pushed by IdentityCard whenever currentPower or currentRarity
    ///         changes (post-forge initial values + every autoEvolveSnapshot()).
    ///         Keeps the registry's canonical card-snapshot fields in sync
    ///         with IdentityCard.cardSnapshots[wallet] so the leaderboard
    ///         shows the same Power / Grade as the Identity Profile.
    ///         Does NOT touch any score component (training/achievement/arena/collection)
    ///         or totalScore / rank — those are recomputed only by the
    ///         component pushes. This function only mirrors card power/rarity
    ///         so the leaderboard can display them.
    function updateCardSnapshot(
        address wallet,
        uint16 currentPower,
        uint8 currentRarity
    ) external onlyUpdater whenNotPaused {
        require(wallet != address(0), "zero wallet");
        require(currentRarity <= 4, "rarity out of range");
        // currentPower=0 is allowed (e.g. card snapshot cleared) but
        // a freshly forged card always has currentPower >= 1.
        IdentitySnapshot storage s = snapshots[wallet];
        s.currentPower = currentPower;
        s.currentRarity = currentRarity;
        s.version += 1;
        s.updatedAt = uint64(block.timestamp);
        _index(wallet);
        emit IdentityScoreUpdated(
            wallet,
            s.trainingScore,
            s.achievementScore,
            s.arenaScore,
            s.collectionScore,
            s.totalScore,
            s.rank,
            s.currentPower,
            s.currentRarity,
            s.version
        );
    }

    /// @notice One-shot full update (used by an initial indexer / emergency repair).
    function updateAll(
        address wallet,
        uint256 trainingScore,
        uint256 achievementScore,
        uint256 arenaScore,
        uint256 collectionScore,
        uint256 trainingLevel,
        uint256 totalXp,
        uint16 currentPower,
        uint8 currentRarity
    ) external onlyUpdater whenNotPaused {
        _setAll(wallet, trainingScore, achievementScore, arenaScore, collectionScore, trainingLevel, totalXp, currentPower, currentRarity);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Internal ──

    function _setComponent(
        address wallet,
        bytes32 key,
        uint256 componentScore,
        uint256 trainingLevel,
        uint256 totalXp
    ) internal {
        require(wallet != address(0), "zero wallet");
        IdentitySnapshot storage s = snapshots[wallet];
        if (key == "training") {
            require(componentScore <= MAX_TRAINING_SCORE, "training score too high");
            s.trainingScore = componentScore;
            s.trainingLevel = trainingLevel;
            s.totalXp = totalXp;
        } else if (key == "achievement") {
            require(componentScore <= MAX_ACHIEVEMENT_SCORE, "achievement too high");
            s.achievementScore = componentScore;
        } else if (key == "arena") {
            require(componentScore <= MAX_ARENA_SCORE, "arena too high");
            s.arenaScore = componentScore;
        } else if (key == "collection") {
            require(componentScore <= MAX_COLLECTION_SCORE, "collection too high");
            s.collectionScore = componentScore;
        } else {
            revert("unknown component");
        }
        s.totalScore = _cap(s.trainingScore + s.achievementScore + s.arenaScore + s.collectionScore);
        s.rank = rankForScore(s.totalScore);
        s.version += 1;
        s.updatedAt = uint64(block.timestamp);
        _index(wallet);
        emit IdentityScoreUpdated(
            wallet,
            s.trainingScore,
            s.achievementScore,
            s.arenaScore,
            s.collectionScore,
            s.totalScore,
            s.rank,
            s.currentPower,
            s.currentRarity,
            s.version
        );
    }

    function _setAll(
        address wallet,
        uint256 trainingScore,
        uint256 achievementScore,
        uint256 arenaScore,
        uint256 collectionScore,
        uint256 trainingLevel,
        uint256 totalXp,
        uint16 currentPower,
        uint8 currentRarity
    ) internal {
        require(wallet != address(0), "zero wallet");
        require(trainingScore <= MAX_TRAINING_SCORE, "training too high");
        require(achievementScore <= MAX_ACHIEVEMENT_SCORE, "achievement too high");
        require(arenaScore <= MAX_ARENA_SCORE, "arena too high");
        require(collectionScore <= MAX_COLLECTION_SCORE, "collection too high");
        IdentitySnapshot storage s = snapshots[wallet];
        s.trainingScore = trainingScore;
        s.achievementScore = achievementScore;
        s.arenaScore = arenaScore;
        s.collectionScore = collectionScore;
        s.trainingLevel = trainingLevel;
        s.totalXp = totalXp;
        s.currentPower = currentPower;
        s.currentRarity = currentRarity;
        s.totalScore = _cap(trainingScore + achievementScore + arenaScore + collectionScore);
        s.rank = rankForScore(s.totalScore);
        s.version += 1;
        s.updatedAt = uint64(block.timestamp);
        _index(wallet);
        emit IdentityScoreUpdated(
            wallet,
            s.trainingScore,
            s.achievementScore,
            s.arenaScore,
            s.collectionScore,
            s.totalScore,
            s.rank,
            s.currentPower,
            s.currentRarity,
            s.version
        );
    }

    function _cap(uint256 s) internal pure returns (uint256) {
        return s > MAX_TOTAL_SCORE ? MAX_TOTAL_SCORE : s;
    }

    function _index(address wallet) internal {
        if (_indexed[wallet]) return;
        _indexed[wallet] = true;
        _indexPos[wallet] = indexedWallets.length;
        indexedWallets.push(wallet);
    }
}
