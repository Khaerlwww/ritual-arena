// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IIdentityRegistry {
    function updateAchievement(address wallet, uint256 achievementScore) external;
}

/// @title Achievement Registry
/// @notice On-chain achievement unlocks for Ritual Arena Identity Ranking.
/// @dev Achievements are one-time, permanent, and score-capped at 300
///      (matches IdentityRegistry.MAX_ACHIEVEMENT_SCORE = 300).
contract AchievementRegistry is Ownable2Step, Pausable {
    uint256 public constant MAX_ACHIEVEMENT_SCORE = 300;
    IIdentityRegistry public identityRegistry;

    function setIdentityRegistry(address registry) external onlyOwner {
        require(registry != address(0), "zero");
        identityRegistry = IIdentityRegistry(registry);
    }

    // ── Achievement IDs (keccak256 of string) ──
    // Computed off-chain; stored as bytes32 identifiers.

    struct AchievementUnlock {
        uint16 points;
        uint64 unlockedAt;
        bytes32 sourceHash;
        uint8 version;
    }

    // wallet => achievementId => unlock data
    mapping(address => mapping(bytes32 => AchievementUnlock)) private achievements;

    // wallet => achievementIds (ordered list for enumeration)
    mapping(address => bytes32[]) private achievementList;

    // wallet => total achievement score (capped at MAX_ACHIEVEMENT_SCORE)
    mapping(address => uint256) private achievementScores;

    mapping(address => bool) public trustedUpdaters;

    event TrustedUpdaterSet(address indexed updater, bool trusted);
    event AchievementUnlocked(
        address indexed wallet,
        bytes32 indexed achievementId,
        uint16 points,
        bytes32 sourceHash,
        uint256 timestamp
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

    /// @notice Unlock a single achievement for a wallet.
    /// @dev Reverts if already unlocked (one-time only).
    function unlockAchievement(
        address wallet,
        bytes32 achievementId,
        uint16 points,
        bytes32 sourceHash
    ) external onlyUpdater whenNotPaused {
        _unlock(wallet, achievementId, points, sourceHash);
    }

    /// @notice Batch unlock achievements for a wallet.
    function batchUnlockAchievements(
        address wallet,
        bytes32[] calldata achievementIds,
        uint16[] calldata points,
        bytes32 sourceHash
    ) external onlyUpdater whenNotPaused {
        uint256 len = achievementIds.length;
        require(len == points.length, "length mismatch");
        require(len <= 50, "batch too large");

        for (uint256 i = 0; i < len; i++) {
            _unlock(wallet, achievementIds[i], points[i], sourceHash);
        }
    }

    /// @notice Check if a wallet has unlocked a specific achievement.
    function hasAchievement(address wallet, bytes32 achievementId) external view returns (bool) {
        return achievements[wallet][achievementId].unlockedAt > 0;
    }

    /// @notice Get all achievement IDs unlocked by a wallet.
    function getAchievementIds(address wallet) external view returns (bytes32[] memory) {
        return achievementList[wallet];
    }

    /// @notice Get full achievement unlock data for a wallet.
    function getAchievement(address wallet, bytes32 achievementId)
        external
        view
        returns (AchievementUnlock memory)
    {
        return achievements[wallet][achievementId];
    }

    /// @notice Get total achievement score for a wallet (capped at 2500).
    function getAchievementScore(address wallet) external view returns (uint256) {
        return achievementScores[wallet];
    }

    /// @notice Get achievement count for a wallet.
    function getAchievementCount(address wallet) external view returns (uint256) {
        return achievementList[wallet].length;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _unlock(
        address wallet,
        bytes32 achievementId,
        uint16 points,
        bytes32 sourceHash
    ) internal {
        require(wallet != address(0), "zero wallet");
        require(achievementId != bytes32(0), "zero id");
        require(points > 0, "zero points");
        require(achievements[wallet][achievementId].unlockedAt == 0, "already unlocked");

        uint256 newScore = achievementScores[wallet] + points;
        if (newScore > MAX_ACHIEVEMENT_SCORE) {
            newScore = MAX_ACHIEVEMENT_SCORE;
        }

        achievements[wallet][achievementId] = AchievementUnlock({
            points: points,
            unlockedAt: uint64(block.timestamp),
            sourceHash: sourceHash,
            version: 1
        });

        achievementList[wallet].push(achievementId);
        achievementScores[wallet] = newScore;

        // Push the new achievement score to the canonical IdentityRegistry so
        // the leaderboard updates automatically.
        if (address(identityRegistry) != address(0)) {
            identityRegistry.updateAchievement(wallet, newScore);
        }

        emit AchievementUnlocked(wallet, achievementId, points, sourceHash, block.timestamp);
    }
}
