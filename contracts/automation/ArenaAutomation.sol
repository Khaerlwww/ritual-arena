// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRitualArenaV5 {
    function settle(uint256 id) external;

    function getBattle(uint256 id) external view returns (
        address walletA,
        address walletB,
        uint256 startTime,
        uint256 endTime,
        bool settled,
        uint8 outcome,
        uint256 votedApPoolA,
        uint256 votedApPoolB,
        uint256 powerA,
        uint256 powerB
    );
}

interface IRitualScheduler {
    function schedule(
        bytes calldata data,
        uint32 gasLimit,
        uint32 startBlock,
        uint32 numCalls,
        uint32 frequency,
        uint32 ttl,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint256 value,
        address payer
    ) external returns (uint256 callId);

    function cancel(uint256 callId) external;
}

interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;
    function balanceOf(address user) external view returns (uint256);
    function lockUntil(address user) external view returns (uint256);
}

/// @title ArenaAutomation
/// @notice Additive Scheduler layer for RitualArena V5. It does not own battle
///         state and does not replace manual settlement. If Scheduler execution
///         fails or is skipped, anyone can still call RitualArena.settle(id)
///         after battle end.
contract ArenaAutomation is Ownable, ReentrancyGuard {
    address public constant RITUAL_WALLET = 0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948;
    address public constant DEFAULT_SCHEDULER = 0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B;

    IRitualArenaV5 public arena;
    IRitualScheduler public scheduler;

    uint32 public defaultGasLimit = 500_000;
    uint32 public defaultTtl = 100;
    uint32 public defaultFrequency = 1;
    uint256 public defaultMaxFeePerGas = 2 gwei;
    uint256 public defaultMaxPriorityFeePerGas = 0;

    mapping(uint256 => uint256) public resolveCallOfBattle;
    mapping(uint256 => uint256) public battleOfResolveCall;
    mapping(uint256 => uint256) public lastExecutionIndexOfBattle;
    mapping(uint256 => string) public lastResolveFailure;

    event ArenaUpdated(address indexed arena);
    event SchedulerUpdated(address indexed scheduler);
    event DefaultsUpdated(uint32 gasLimit, uint32 ttl, uint32 frequency, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas);
    event FeesDeposited(address indexed payer, uint256 amount, uint256 lockDuration);
    event BattleResolveScheduled(uint256 indexed battleId, uint256 indexed callId, uint32 startBlock);
    event BattleResolveCancelled(uint256 indexed battleId, uint256 indexed callId);
    event BattleAutoResolved(uint256 indexed battleId, uint256 indexed executionIndex);
    event BattleAutoResolveSkipped(uint256 indexed battleId, uint256 indexed executionIndex, string reason);
    event BattleAutoResolveFailed(uint256 indexed battleId, uint256 indexed executionIndex, string reason);

    error ZeroAddress();
    error UnauthorizedScheduler();
    error BadInput();
    error BattleNotFound();
    error BattleAlreadySettled();
    error ScheduleAlreadyExists();
    error NoSchedule();

    modifier onlyScheduler() {
        if (msg.sender != address(scheduler)) revert UnauthorizedScheduler();
        _;
    }

    constructor(address arena_, address scheduler_) Ownable(msg.sender) {
        if (arena_ == address(0)) revert ZeroAddress();
        arena = IRitualArenaV5(arena_);
        scheduler = IRitualScheduler(scheduler_ == address(0) ? DEFAULT_SCHEDULER : scheduler_);
    }

    function setArena(address arena_) external onlyOwner {
        if (arena_ == address(0)) revert ZeroAddress();
        arena = IRitualArenaV5(arena_);
        emit ArenaUpdated(arena_);
    }

    function setScheduler(address scheduler_) external onlyOwner {
        if (scheduler_ == address(0)) revert ZeroAddress();
        scheduler = IRitualScheduler(scheduler_);
        emit SchedulerUpdated(scheduler_);
    }

    function setDefaults(
        uint32 gasLimit,
        uint32 ttl,
        uint32 frequency,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas
    ) external onlyOwner {
        if (gasLimit == 0 || frequency == 0 || maxFeePerGas == 0) revert BadInput();
        defaultGasLimit = gasLimit;
        defaultTtl = ttl;
        defaultFrequency = frequency;
        defaultMaxFeePerGas = maxFeePerGas;
        defaultMaxPriorityFeePerGas = maxPriorityFeePerGas;
        emit DefaultsUpdated(gasLimit, ttl, frequency, maxFeePerGas, maxPriorityFeePerGas);
    }

    /// @notice Deposit RITUAL into RitualWallet for scheduled execution fees.
    /// @dev Scheduler payer is this contract, so deposits must credit address(this).
    function depositForFees(uint256 lockDuration) external payable onlyOwner {
        if (msg.value == 0 || lockDuration == 0) revert BadInput();
        IRitualWallet(RITUAL_WALLET).deposit{value: msg.value}(lockDuration);
        emit FeesDeposited(msg.sender, msg.value, lockDuration);
    }

    function feeBalance() external view returns (uint256 balance, uint256 lockUntilBlock) {
        IRitualWallet wallet = IRitualWallet(RITUAL_WALLET);
        return (wallet.balanceOf(address(this)), wallet.lockUntil(address(this)));
    }

    /// @notice Schedule one auto-resolve call for a battle at a known block.
    /// @dev Keep manual RitualArena.settle(id) as fallback if Scheduler skips.
    function scheduleResolve(uint256 battleId, uint32 startBlock) external onlyOwner nonReentrant returns (uint256 callId) {
        return _scheduleResolve(battleId, startBlock, defaultGasLimit, defaultTtl, defaultMaxFeePerGas, defaultMaxPriorityFeePerGas);
    }

    /// @notice Convenience schedule using current block + delayBlocks.
    function scheduleResolveInBlocks(uint256 battleId, uint32 delayBlocks) external onlyOwner nonReentrant returns (uint256 callId) {
        if (delayBlocks == 0) revert BadInput();
        return _scheduleResolve(
            battleId,
            uint32(block.number) + delayBlocks,
            defaultGasLimit,
            defaultTtl,
            defaultMaxFeePerGas,
            defaultMaxPriorityFeePerGas
        );
    }

    function scheduleResolveCustom(
        uint256 battleId,
        uint32 startBlock,
        uint32 gasLimit,
        uint32 ttl,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas
    ) external onlyOwner nonReentrant returns (uint256 callId) {
        return _scheduleResolve(battleId, startBlock, gasLimit, ttl, maxFeePerGas, maxPriorityFeePerGas);
    }

    function _scheduleResolve(
        uint256 battleId,
        uint32 startBlock,
        uint32 gasLimit,
        uint32 ttl,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas
    ) internal returns (uint256 callId) {
        if (battleId == 0 || startBlock <= block.number || gasLimit == 0 || maxFeePerGas == 0) revert BadInput();
        if (resolveCallOfBattle[battleId] != 0) revert ScheduleAlreadyExists();

        (address walletA,,,, bool settled,,,,,) = arena.getBattle(battleId);
        if (walletA == address(0)) revert BattleNotFound();
        if (settled) revert BattleAlreadySettled();

        bytes memory data = abi.encodeWithSelector(
            this.autoResolve.selector,
            uint256(0), // Scheduler overwrites bytes 4-35 with executionIndex.
            battleId
        );

        callId = scheduler.schedule(
            data,
            gasLimit,
            startBlock,
            1,
            defaultFrequency,
            ttl,
            maxFeePerGas,
            maxPriorityFeePerGas,
            0,
            address(this)
        );

        resolveCallOfBattle[battleId] = callId;
        battleOfResolveCall[callId] = battleId;
        emit BattleResolveScheduled(battleId, callId, startBlock);
    }

    function cancelResolve(uint256 battleId) external onlyOwner nonReentrant {
        uint256 callId = resolveCallOfBattle[battleId];
        if (callId == 0) revert NoSchedule();
        scheduler.cancel(callId);
        delete resolveCallOfBattle[battleId];
        delete battleOfResolveCall[callId];
        emit BattleResolveCancelled(battleId, callId);
    }

    /// @notice Scheduler callback. Never mutates battle state directly; delegates
    ///         to RitualArena.settle(id), preserving Arena as source of truth.
    function autoResolve(uint256 executionIndex, uint256 battleId) external onlyScheduler nonReentrant {
        lastExecutionIndexOfBattle[battleId] = executionIndex;

        (address walletA,, uint256 startTime, uint256 endTime, bool settled,,,,,) = arena.getBattle(battleId);
        if (walletA == address(0) || startTime == 0) {
            emit BattleAutoResolveSkipped(battleId, executionIndex, "battle not found");
            return;
        }
        if (settled) {
            emit BattleAutoResolveSkipped(battleId, executionIndex, "already settled");
            return;
        }
        if (block.timestamp < endTime) {
            emit BattleAutoResolveSkipped(battleId, executionIndex, "battle still active");
            return;
        }

        try arena.settle(battleId) {
            delete resolveCallOfBattle[battleId];
            emit BattleAutoResolved(battleId, executionIndex);
        } catch Error(string memory reason) {
            lastResolveFailure[battleId] = reason;
            emit BattleAutoResolveFailed(battleId, executionIndex, reason);
        } catch {
            lastResolveFailure[battleId] = "low-level settle revert";
            emit BattleAutoResolveFailed(battleId, executionIndex, "low-level settle revert");
        }
    }

    receive() external payable {}
}
