// src/hooks/useStakingActivity.ts
// Global staking activity feed — shows recent Staked, RewardsClaimed,
// and Unstaked events from ANY wallet. Maintains a rolling buffer of
// the last 50 events, kept fresh via viem watchContractEvent on the
// RitualStaking V3 contract.
//
// This is the canonical source for both the "Global Claim Log" and
// the "Global AP Analytics" sections in MarketWindow.

import { useCallback, useEffect, useState } from "react";
import { ritualStakingAbi } from "../abi/ritualStaking";
import { hasStakingContract, ritualTestnet, stakingAddress } from "../lib/chains";
import { publicClient } from "./useAnthem";

const BUFFER_SIZE = 50;
const POLL_BLOCKS = 2000;

export type ActivityKind = "stake" | "claim" | "unstake";

export type ActivityEvent = {
  /** Sorted desc by blockNumber, most recent first. */
  kind: ActivityKind;
  /** Wallet that performed the action. */
  wallet: `0x${string}`;
  /** RITUAL amount (stake / unstake) — undefined for claim. */
  amount?: bigint;
  /** AP amount (claim only) — undefined for stake / unstake. */
  apAmount?: bigint;
  /** Position ID (claim / unstake). */
  posId?: number;
  /** Cumulative AP per-wallet after the action (claim only). */
  totalClaimedByWalletAfter?: bigint;
  /** Cumulative global AP after the action (claim only). */
  totalClaimedGlobalAfter?: bigint;
  /** Block number. */
  blockNumber: bigint;
  /** Block timestamp (ms since epoch). */
  timestampMs: number;
  /** Tx hash. */
  txHash: `0x${string}`;
};

function logToActivity(log: any, kind: ActivityKind, blockTimestampMs: number): ActivityEvent | null {
  try {
    const args = log.args ?? {};
    return {
      kind,
      wallet: (args.staker ?? "0x0") as `0x${string}`,
      amount: args.amount !== undefined ? BigInt(args.amount) : undefined,
      apAmount: args.reward !== undefined ? BigInt(args.reward) : undefined,
      posId: args.posId !== undefined ? Number(args.posId) : undefined,
      totalClaimedByWalletAfter: args.totalClaimedByWalletAfter !== undefined
        ? BigInt(args.totalClaimedByWalletAfter)
        : undefined,
      totalClaimedGlobalAfter: args.totalClaimedGlobalAfter !== undefined
        ? BigInt(args.totalClaimedGlobalAfter)
        : undefined,
      blockNumber: BigInt(log.blockNumber ?? 0),
      timestampMs: blockTimestampMs,
      txHash: (log.transactionHash ?? "0x0") as `0x${string}`,
    };
  } catch {
    return null;
  }
}

export function useStakingActivity() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!hasStakingContract) {
      setEvents([]);
      setLoading(false);
      return;
    }
    try {
      const head = await publicClient.getBlockNumber();
      const fromBlock = head > BigInt(POLL_BLOCKS) ? head - BigInt(POLL_BLOCKS) : 0n;
      const [stakedLogs, claimedLogs, unstakedLogs] = await Promise.all([
        publicClient.getContractEvents({
          address: stakingAddress,
          abi: ritualStakingAbi,
          eventName: "Staked",
          fromBlock,
        }),
        publicClient.getContractEvents({
          address: stakingAddress,
          abi: ritualStakingAbi,
          eventName: "RewardsClaimed",
          fromBlock,
        }),
        publicClient.getContractEvents({
          address: stakingAddress,
          abi: ritualStakingAbi,
          eventName: "Unstaked",
          fromBlock,
        }),
      ]);
      const allLogs = [
        ...stakedLogs.map((l) => ({ log: l, kind: "stake" as ActivityKind })),
        ...claimedLogs.map((l) => ({ log: l, kind: "claim" as ActivityKind })),
        ...unstakedLogs.map((l) => ({ log: l, kind: "unstake" as ActivityKind })),
      ];
      const seen = new Set<string>();
      const dedup = allLogs.filter(({ log }) => {
        const k = `${log.transactionHash ?? ""}_${log.logIndex ?? ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const blockNums = Array.from(new Set(dedup.map((d) => d.log.blockNumber).filter(Boolean)));
      const blockTimes = await Promise.all(
        blockNums.slice(0, 32).map((bn) =>
          publicClient
            .getBlock({ blockNumber: bn as bigint })
            .then((b) => {
              // Auto-detect MS vs SEC: Ritual Chain block.timestamp returns
              // MS (13 digits, > 1e12). Older EVM chains return SEC (10 digits).
              // Same pattern as useTraining.ts:106 — convert to canonical MS.
              const raw = Number(b.timestamp);
              const ms = raw > 1e12 ? raw : raw * 1000;
              return [bn, ms] as const;
            })
            .catch(() => [bn, 0] as const),
        ),
      );
      const blockTimeMap = new Map(blockTimes.map(([bn, t]) => [bn, t]));
      const parsed: ActivityEvent[] = dedup
        .map(({ log, kind }) => logToActivity(log, kind, blockTimeMap.get(log.blockNumber) ?? 0))
        .filter((e): e is ActivityEvent => e !== null)
        .sort(
          (a, b) =>
            Number(b.blockNumber - a.blockNumber) || b.txHash.localeCompare(a.txHash),
        )
        .slice(0, BUFFER_SIZE);
      setEvents(parsed);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Live updates: subscribe to all 3 event types. Append + trim to
  // BUFFER_SIZE so the feed stays fresh within seconds of new on-chain
  // activity. Best-effort: silent no-op on RPCs that don't support filters.
  useEffect(() => {
    if (!hasStakingContract) return;
    try {
      const make = (kind: ActivityKind) =>
        publicClient.watchContractEvent({
          address: stakingAddress,
          abi: ritualStakingAbi,
          eventName: kind === "stake" ? "Staked" : kind === "claim" ? "RewardsClaimed" : "Unstaked",
          onLogs: async (logs: any[]) => {
            let ts = 0;
            if (logs[0]?.blockNumber) {
              try {
                const b = await publicClient.getBlock({ blockNumber: logs[0].blockNumber });
                // Auto-detect MS vs SEC (same pattern as useTraining.ts:106).
                // Ritual Chain block.timestamp is in MS (13 digits, > 1e12);
                // older EVM chains return SEC (10 digits).
                const raw = Number(b.timestamp);
                ts = raw > 1e12 ? raw : raw * 1000;
              } catch {
                /* ignore */
              }
            }
            const fresh = logs
              .map((l) => logToActivity(l, kind, ts))
              .filter((e): e is ActivityEvent => e !== null);
            setEvents((prev) => [...fresh, ...prev].slice(0, BUFFER_SIZE));
          },
        });
      const unwatches = ["stake", "claim", "unstake"].map((k) => make(k as ActivityKind));
      return () => {
        for (const u of unwatches) {
          try {
            (u as () => void)();
          } catch {
            /* noop */
          }
        }
      };
    } catch {
      return () => {};
    }
  }, []);

  return { events, loading, refetch };
}

export function shortAddress(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function timeAgo(ts: number): string {
  if (!ts) return "—";
  const delta = Date.now() - ts;
  if (delta < 0) return "just now";
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}
