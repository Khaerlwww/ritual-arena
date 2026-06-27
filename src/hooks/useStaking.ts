// src/hooks/useStaking.ts
//
// V5 staking hook. Only reads functions that exist on
// contracts/staking/RitualStaking.sol — the ABI is auto-generated from the
// compiled artifact, so any function call here is contract-verified.
//
// AP amounts come back as 18-decimal wei; we convert to human units via
// `toApNumber()` (which uses viem's `formatUnits`) to avoid Number(bigint)
// precision loss for values > 2^53.
//
// RITUAL amounts are 18-decimal native-coin wei; the UI should display
// them with `formatEther()` from viem.

import { useCallback, useEffect, useState } from "react";
import { isAddress, parseEther, type Address } from "viem";
import { ritualStakingAbi } from "../abi/ritualStaking";
import { hasStakingContract, ritualTestnet, stakingAddress } from "../lib/chains";
import { publicClient } from "./useAnthem";
import { getSelectedWalletProvider, getSharedWalletClient, ensureReadyForWrite } from "../lib/wallet";
import { toApNumber } from "../lib/apFormat";
import { on, emit } from "../lib/eventBus";
import { RITUAL_GAS } from "../lib/gasDefaults";

export { hasStakingContract, stakingAddress } from "../lib/chains";

export type StakePosition = {
  id: number;
  staker: Address;
  amount: bigint;            // RITUAL wei (18 decimals)
  stakedAt: number;          // unix seconds
  unlocksAt: number;         // unix seconds
  lastClaimAt: number;       // unix seconds
  claimedAP: number;         // AP units (wei / 1e18)
  withdrawn: boolean;
  pendingAP: number;         // AP units, current claimable amount
  canUnstake: boolean;       // derived locally from unlocksAt
  secondsLeft: number;       // seconds until unlock (0 if ready)
};

export type ClaimRecord = {
  claimIndex: number;
  timestamp: number;
  positionId: number;
  stakeAmount: number;
  apClaimed: number;         // AP units
  cumulativeClaimedAP: number;
  txHash: string;
};

export type StakingProtocol = {
  totalProtocolStaked: bigint;       // RITUAL wei
  maxTotalStaked: bigint;            // RITUAL wei
  maxStakePerWallet: bigint;         // RITUAL wei
  rewardEmissionCap: number;         // AP units
  totalClaimedGlobal: number;        // AP units
  emergencyPause: boolean;
  treasuryWallet?: Address;
  minStake: bigint;                  // RITUAL wei
  apPerRitualPerDay: number;         // AP units per RITUAL per day (read from chain)
  activeStakerCount: number;
  totalClaimedGlobalRemaining: number; // AP units
};

/** Build a StakePosition from the on-chain tuple + a derived canUnstake. */
function decodePosition(
  raw: readonly [Address, bigint, bigint, bigint, bigint, bigint, boolean] | {
    staker: Address; amount: bigint; stakedAt: bigint; unlocksAt: bigint;
    lastClaimAt: bigint; claimedAP: bigint; withdrawn: boolean;
  },
  id: number,
  pendingAP: bigint,
  nowSec: number,
): StakePosition {
  const obj: any = Array.isArray(raw) ? {
    staker: raw[0], amount: raw[1], stakedAt: raw[2], unlocksAt: raw[3],
    lastClaimAt: raw[4], claimedAP: raw[5], withdrawn: raw[6],
  } : raw;
  const unlocksAt = Number(obj.unlocksAt);
  const secondsLeft = Math.max(0, unlocksAt - nowSec);
  return {
    id,
    staker: obj.staker as Address,
    amount: BigInt(obj.amount ?? 0n),
    stakedAt: Number(obj.stakedAt ?? 0n),
    unlocksAt,
    lastClaimAt: Number(obj.lastClaimAt ?? 0n),
    // AP fields are 18-decimal wei on-chain — convert to human AP units.
    claimedAP: toApNumber(obj.claimedAP ?? 0n),
    withdrawn: Boolean(obj.withdrawn),
    pendingAP: toApNumber(pendingAP),
    // canUnstake is derived locally — no extra contract call needed.
    canUnstake: unlocksAt > 0 && nowSec >= unlocksAt && !Boolean(obj.withdrawn),
    secondsLeft,
  };
}

export function useStaking(wallet?: Address) {
  const [positions, setPositions] = useState<StakePosition[]>([]);
  const [totalStaked, setTotalStaked] = useState<bigint>(0n);
  const [totalPendingAP, setTotalPendingAP] = useState(0);
  const [walletBalance, setWalletBalance] = useState<bigint>(0n);
  const [protocol, setProtocol] = useState<StakingProtocol>({
    totalProtocolStaked: 0n,
    maxTotalStaked: 0n,
    maxStakePerWallet: 0n,
    rewardEmissionCap: 0,
    totalClaimedGlobal: 0,
    emergencyPause: false,
    minStake: 0n,
    apPerRitualPerDay: 0,
    activeStakerCount: 0,
    totalClaimedGlobalRemaining: 0,
  });
  /** Per-wallet AP — read directly from on-chain, never recomputed from
   *  event logs. Canonical source per V5 contract. */
  const [walletTotalClaimedAP, setWalletTotalClaimedAP] = useState(0);
  const [walletLastClaimedAt, setWalletLastClaimedAt] = useState(0);
  const [claimHistory, setClaimHistory] = useState<ClaimRecord[]>([]);
  /** Bump this to force refetch — incremented by event-bus listeners
   *  after stake/claim/unstake txs so the UI updates without a manual reload. */
  const [refetchNonce, setRefetchNonce] = useState(0);

  /** Projected AP for a hypothetical stake amount. Calls the contract's
   *  estimatedAP() pure view, so the result is bit-identical to what the
   *  contract will actually emit on a 14-day claim. No client-side
   *  integer-math mismatch. */
  const estimatedAPForAmount = useCallback(async (amountWei: bigint): Promise<bigint> => {
    if (!hasStakingContract || amountWei === 0n) return 0n;
    try {
      return (await publicClient.readContract({
        address: stakingAddress,
        abi: ritualStakingAbi,
        functionName: "estimatedAP",
        args: [amountWei],
      })) as bigint;
    } catch {
      return 0n;
    }
  }, []);

  const refetch = useCallback(async () => {
    if (!hasStakingContract || !wallet || !isAddress(wallet)) {
      setPositions([]);
      setTotalStaked(0n);
      setTotalPendingAP(0);
      setWalletBalance(0n);
      setWalletTotalClaimedAP(0);
      setWalletLastClaimedAt(0);
      return;
    }

    // ── Per-wallet block (independent) ──
    try {
      // V5 reads: positionIds, pendingRewards, RITUAL balance, totalClaimed,
      // lastClaimedAt — all in parallel. NOTE: the contract has no
      // `totalStaked(wallet)` view — `totalProtocolStaked` is exposed via
      // `globalStakingStats()[0]` (global only) and via
      // `getPositionIds(wallet)` for per-wallet. The wallet-level
      // staked total is derived from the loaded position structs.
      const nowSec = Math.floor(Date.now() / 1000);
      const [
        posIds,
        pending,
        balance,
        walletTotalClaimed,
        lastClaimed,
      ] = await Promise.all([
        publicClient.readContract({
          address: stakingAddress,
          abi: ritualStakingAbi,
          functionName: "getPositionIds",
          args: [wallet],
        }) as Promise<readonly bigint[]>,
        publicClient.readContract({
          address: stakingAddress,
          abi: ritualStakingAbi,
          functionName: "pendingRewards",
          args: [wallet],
        }) as Promise<bigint>,
        publicClient.getBalance({ address: wallet }),
        publicClient.readContract({
          address: stakingAddress,
          abi: ritualStakingAbi,
          functionName: "totalClaimed",
          args: [wallet],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: stakingAddress,
          abi: ritualStakingAbi,
          functionName: "lastClaimedAt",
          args: [wallet],
        }) as Promise<bigint>,
      ]);

      // For each position id, load the position struct + its pending AP.
      const decoded = await Promise.all(
        posIds.map(async (idRaw) => {
          const id = Number(idRaw);
          const [pos, acc] = await Promise.all([
            publicClient.readContract({
              address: stakingAddress,
              abi: ritualStakingAbi,
              functionName: "getPosition",
              args: [BigInt(id)],
            }) as Promise<{
              staker: Address;
              amount: bigint;
              stakedAt: bigint;
              unlocksAt: bigint;
              lastClaimAt: bigint;
              claimedAP: bigint;
              withdrawn: boolean;
            }>,
            publicClient.readContract({
              address: stakingAddress,
              abi: ritualStakingAbi,
              functionName: "accruedAP",
              args: [BigInt(id)],
            }) as Promise<readonly [bigint, bigint]>,
          ]);
          return decodePosition(pos, id, acc[0], nowSec);
        }),
      );

      // Derive per-wallet staked total from the loaded position
      // structs (sum of `amount` over non-withdrawn positions). The
      // contract does not expose a `totalStaked(wallet)` view.
      const walletStaked = decoded.reduce(
        (acc, p) => (p.withdrawn ? acc : acc + p.amount),
        0n,
      );

      setPositions(decoded);
      setTotalStaked(walletStaked);
      // AP fields are 18-decimal wei on-chain — convert to human units.
      setTotalPendingAP(toApNumber(pending));
      setWalletBalance(balance);
      setWalletTotalClaimedAP(toApNumber(walletTotalClaimed));
      setWalletLastClaimedAt(Number(lastClaimed));
    } catch {
      setPositions([]);
      setTotalStaked(0n);
      setTotalPendingAP(0);
      setWalletBalance(0n);
      setWalletTotalClaimedAP(0);
      setWalletLastClaimedAt(0);
    }

    // ── Global stats block (independent) ──
    // Read on-chain even if the per-wallet block above fails — the
    // Analytics header depends on RATE_PER_RITUAL (= apPerRitualPerDay)
    // and the "Global Staking Stats" panel reads `protocol.*` directly.
    try {
      const [
        statsTuple,
        _maxTotalStaked,
        _maxStakePerWallet,
        _emergencyPause,
        _treasuryWallet,
        _minStake,
        _apPerRitualPerDay,
      ] = await Promise.all([
        publicClient.readContract({
          address: stakingAddress,
          abi: ritualStakingAbi,
          functionName: "globalStakingStats",
        }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
        publicClient.readContract({ address: stakingAddress, abi: ritualStakingAbi, functionName: "maxTotalStaked" }) as Promise<bigint>,
        publicClient.readContract({ address: stakingAddress, abi: ritualStakingAbi, functionName: "maxStakePerWallet" }) as Promise<bigint>,
        publicClient.readContract({ address: stakingAddress, abi: ritualStakingAbi, functionName: "emergencyPause" }) as Promise<boolean>,
        publicClient.readContract({ address: stakingAddress, abi: ritualStakingAbi, functionName: "treasuryWallet" }) as Promise<Address>,
        publicClient.readContract({ address: stakingAddress, abi: ritualStakingAbi, functionName: "MIN_STAKE" }) as Promise<bigint>,
        publicClient.readContract({ address: stakingAddress, abi: ritualStakingAbi, functionName: "apPerRitualPerDay" }) as Promise<bigint>,
      ]);
      // statsTuple = (totalStaked, totalClaimedGlobal, rewardEmissionCap,
      //               totalClaimedGlobalRemaining, activeStakers)

      setProtocol({
        totalProtocolStaked: statsTuple[0],
        maxTotalStaked: _maxTotalStaked,
        maxStakePerWallet: _maxStakePerWallet,
        rewardEmissionCap: toApNumber(statsTuple[2]),
        totalClaimedGlobal: toApNumber(statsTuple[1]),
        emergencyPause: _emergencyPause,
        treasuryWallet: _treasuryWallet,
        minStake: _minStake,
        apPerRitualPerDay: toApNumber(_apPerRitualPerDay),
        activeStakerCount: Number(statsTuple[4]),
        totalClaimedGlobalRemaining: toApNumber(statsTuple[3]),
      });
    } catch {
      // Global stats read failed — keep last-known protocol state. Do
      // NOT touch per-wallet state here (handled in the per-wallet
      // try/catch above).
    }

    // ── Claim history block (independent) ──
    // Read on-chain even if the per-wallet block above fails — the
    // Analytics header depends on RATE_PER_RITUAL (= apPerRitualPerDay)
    // and the "Global Staking Stats" panel reads `protocol.*` directly.
    try {
      const logs = (await publicClient.getContractEvents({
        address: stakingAddress,
        abi: ritualStakingAbi,
        eventName: "RewardsClaimed",
        args: { staker: wallet },
        fromBlock: 0n,
      })) as any[];
      let cumulative = 0;
      const records: ClaimRecord[] = logs.map((log, i) => {
        // RewardsClaimed event reward value is 18-decimal wei.
        const ap = toApNumber(log.args?.reward ?? 0n);
        cumulative += ap;
        return {
          claimIndex: i + 1,
          timestamp: 0,
          positionId: 0,
          stakeAmount: 0,
          apClaimed: ap,
          cumulativeClaimedAP: cumulative,
          txHash: log.transactionHash ?? "",
        };
      });
      setClaimHistory(records);
    } catch {
      setClaimHistory([]);
    }
  }, [wallet]);

  useEffect(() => {
    void refetch();
  }, [refetch, refetchNonce]);

  // Refresh after any staking action via client-side event bus
  // (stake writes, claim writes, unstake writes all emit 'position-changed'
  // or 'ap-changed' so other hooks can invalidate too).
  useEffect(() => {
    return on("position-changed", () => setRefetchNonce((n) => n + 1));
  }, []);

  return {
    positions,
    totalStaked,
    totalPendingAP,
    walletBalance,
    walletTotalClaimedAP,
    walletLastClaimedAt,
    protocol,
    claimHistory,
    refetch,
    estimatedAPForAmount,
    supported: hasStakingContract,
  };
}

export function useStakingWrites() {
  const [isPending, setIsPending] = useState(false);
  const [txHash, setTxHash] = useState<string>();
  /** Granular phase so the UI can render clear status text:
   *  "Claiming AP...", "Staking...", "Unstaking...", "Withdrawing..." */
  const [phase, setPhase] = useState<"idle" | "claiming" | "staking" | "unstaking" | "withdrawing">("idle");

  const run = useCallback(
    async (
      functionName: "stake" | "claimAP" | "claimAllAP" | "unstake" | "emergencyWithdraw",
      args: readonly unknown[],
      phaseLabel: typeof phase = "idle",
      value?: bigint,
    ) => {
      if (!hasStakingContract) throw new Error("Staking is unavailable right now.");
      const walletClient = getSharedWalletClient();
      if (!walletClient) throw new Error("Wallet extension not found.");
      setIsPending(true);
      setTxHash(undefined);
      setPhase(phaseLabel);
      try {
        const account = await ensureReadyForWrite();
        await publicClient.simulateContract({
          account,
          address: stakingAddress,
          abi: ritualStakingAbi,
          functionName: functionName as never,
          args: args as never,
          value: value ?? 0n,
        });
        const hash = await walletClient.writeContract({
          account,
          chain: ritualTestnet,
          address: stakingAddress,
          abi: ritualStakingAbi,
          functionName: functionName as never,
          args: args as never,
          value: value ?? 0n,
          maxFeePerGas: RITUAL_GAS.maxFeePerGas,
          maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
        });
        setTxHash(hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        // Cross-hook invalidation — refresh AP balance + staking view +
        // (for claim) any identity hook that depends on cumulative AP.
        const reason: 'stake' | 'claim' | 'unstake' | 'other' =
          functionName === 'stake' ? 'stake' :
          functionName === 'unstake' || functionName === 'emergencyWithdraw' ? 'unstake' :
          functionName === 'claimAP' || functionName === 'claimAllAP' ? 'claim' : 'other';
        emit({ type: 'position-changed', reason });
        emit({ type: 'ap-changed', reason: 'stake-claim' });
        return { hash, receipt };
      } finally {
        setIsPending(false);
        setPhase("idle");
      }
    },
    [],
  );

  return {
    isPending,
    phase,
    txHash,
    hasWallet: Boolean(getSelectedWalletProvider()),
    stake: (amountEther: string) => run("stake", [], "staking", parseEther(amountEther || "0")),
    claimAP: (posId: number) => run("claimAP", [BigInt(posId)], "claiming"),
    claimAllAP: () => run("claimAllAP", [], "claiming"),
    unstake: (posId: number) => run("unstake", [BigInt(posId)], "unstaking"),
    emergencyWithdraw: (posId: number) => run("emergencyWithdraw", [BigInt(posId)], "withdrawing"),
  };
}
