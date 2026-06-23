// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRitualAP { function mint(address to, uint256 amount) external; }
interface IIdentityRegistry {
    function updateTraining(address wallet, uint256 trainingScore, uint256 trainingLevel, uint256 totalXp) external;
}
interface IRitualAnthem {
    function hasAnthem(address wallet) external view returns (bool);
    function autoEvolveSnapshot(address wallet, uint16 newPower) external;
    function getCurrentPower(address wallet) external view returns (uint16);
}

/// @title  Ritual Training — V5 (XP + RitualAP + registry.pushTraining)
/// @notice Each successful train() mints 25 AP to the trainer via
///         the on-chain RitualAP ERC-20. Failed trains and trains
///         during the 20-hour cooldown do NOT mint AP.
///
///         The contract is granted MINTER_ROLE on RitualAP at
///         deploy time. Total AP supply is hard-capped at 21M AP
///         (cap enforced inside RitualAP, not here).
contract RitualTraining is Ownable, Pausable, ReentrancyGuard {
    uint256 public constant XP_PER_TRAIN = 25;
    uint256 public constant AP_PER_TRAIN = 25 * 10 ** 18;
    uint256 public constant LEVEL_SIZE = 500;
    uint256 public constant TRAINING_COOLDOWN_MS = 72_000_000;  // 20 hours in ms
    uint256 public constant TRAINING_COOLDOWN_S  = 20 hours;
    uint256 public constant HISTORY_SIZE = 20;
    uint256 public constant MAX_TRAINING_SCORE = 400;

    IRitualAnthem public immutable anthem;
    IRitualAP public immutable ritualAP;
    IIdentityRegistry public identityRegistry;

    struct CardProgress {
        uint256 totalXp;
        uint256 apEarned;
        uint64 trainCount;
        uint64 lastTrainedAt;
        uint64 createdAt;
    }
    struct TrainingRecord {
        uint64 trainedAt;
        uint64 levelAfter;
        uint256 xpGained;
        uint256 apGained;
    }

    mapping(uint256 => CardProgress) public cardProgress;
    mapping(uint256 => TrainingRecord[HISTORY_SIZE]) private trainingHistory;
    mapping(uint256 => uint256) public trainingHistoryCount;

    event CardTrained(
        uint256 indexed tokenId,
        address indexed wallet,
        uint256 xpGained,
        uint256 apGained,
        uint256 totalXp,
        uint256 levelAfter
    );
    event APMinted(address indexed to, uint256 amount, string reason);
    event IdentityRegistryUpdated(address indexed registry);

    error ZeroAddress();
    error NotAnthemOwner();
    error CooldownActive();
    error APMintFailed();
    error NotOwner();

    constructor(address anthem_, address ap_, address registry_) Ownable(msg.sender) {
        if (anthem_ == address(0) || ap_ == address(0) || registry_ == address(0)) revert ZeroAddress();
        anthem = IRitualAnthem(anthem_);
        ritualAP = IRitualAP(ap_);
        identityRegistry = IIdentityRegistry(registry_);
    }

    function setIdentityRegistry(address registry_) external onlyOwner {
        if (registry_ == address(0)) revert ZeroAddress();
        identityRegistry = IIdentityRegistry(registry_);
        emit IdentityRegistryUpdated(registry_);
    }

    function _cooldown() internal view returns (uint256) {
        return block.timestamp > 1_000_000_000_000 ? TRAINING_COOLDOWN_MS : TRAINING_COOLDOWN_S;
    }

    function train() external nonReentrant whenNotPaused returns (uint256 totalXp, uint256 levelAfter) {
        if (!anthem.hasAnthem(msg.sender)) revert NotAnthemOwner();
        uint256 tokenId = uint256(uint160(msg.sender));

        CardProgress storage p = cardProgress[tokenId];
        if (p.createdAt == 0) p.createdAt = uint64(block.timestamp);
        uint256 cd = _cooldown();
        if (uint256(p.lastTrainedAt) != 0 && block.timestamp < uint256(p.lastTrainedAt) + cd) revert CooldownActive();

        unchecked {
            p.totalXp += XP_PER_TRAIN;
            p.trainCount += 1;
        }
        p.lastTrainedAt = uint64(block.timestamp);
        unchecked { p.apEarned += AP_PER_TRAIN; }

        ritualAP.mint(msg.sender, AP_PER_TRAIN);
        emit APMinted(msg.sender, AP_PER_TRAIN, "training");

        levelAfter = p.totalXp / LEVEL_SIZE;

        // Push training score to registry (capped at MAX_TRAINING_SCORE)
        uint256 trainingScore = p.totalXp / 5; // 500 XP -> 100 score
        if (trainingScore > MAX_TRAINING_SCORE) trainingScore = MAX_TRAINING_SCORE;
        identityRegistry.updateTraining(msg.sender, trainingScore, levelAfter, p.totalXp);

        // Evolve the anthem's card snapshot
        uint16 currentPower = anthem.getCurrentPower(msg.sender);
        uint16 evolvedPower = uint16(currentPower + 1);
        if (evolvedPower > 100) evolvedPower = 100;
        anthem.autoEvolveSnapshot(msg.sender, evolvedPower);

        // Append to history ring
        uint256 idx = trainingHistoryCount[tokenId] % HISTORY_SIZE;
        trainingHistory[tokenId][idx] = TrainingRecord({
            trainedAt: p.lastTrainedAt,
            levelAfter: uint64(levelAfter),
            xpGained: XP_PER_TRAIN,
            apGained: AP_PER_TRAIN
        });
        unchecked { trainingHistoryCount[tokenId] += 1; }

        emit CardTrained(tokenId, msg.sender, XP_PER_TRAIN, AP_PER_TRAIN, p.totalXp, levelAfter);
        return (p.totalXp, levelAfter);
    }

    function getCardProgress(uint256 tokenId) external view returns (CardProgress memory) { return cardProgress[tokenId]; }
    function getTrainingRecord(uint256 tokenId, uint256 i) external view returns (TrainingRecord memory) {
        return trainingHistory[tokenId][i];
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
