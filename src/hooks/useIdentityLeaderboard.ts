// useIdentityLeaderboard.ts
// Reads the canonical Identity Score for every indexed wallet from the
// IdentityRegistry contract. IdentityRegistry is the single source of truth.
//
// NO fallbacks. NO local cache. NO gallery-based ranking. NO client-side
// score calculation. If a wallet has no registry snapshot, it is shown as
// "Sync Pending" or omitted from the ranked list entirely.
//
// Sorting: totalScore descending only. No tie-breaking.

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { publicClient } from "./useAnthem";
import { identityRegistryAbi } from "../abi/identityRegistry";
import { identityRegistryAddress, hasIdentityRegistry, zeroAddress } from "../lib/chains";
import { rankLabelFromUint, RANK_UNKNOWN, type RankLabelOrUnknown } from "../lib/identityRanks";

export interface IdentityLeaderboardEntry {
  wallet: Address;
  totalScore: number;
  rankScore: number;
  identityTier: RankLabelOrUnknown;
  trainingLevel: number;
  totalXp: number;
  currentPower: number;
  currentRarity: number;
}

// Subscribe to IdentityScoreUpdated so leaderboard refreshes the moment
// any contract pushes a new score. Defensive: if the public RPC doesn't
// support filters, the watcher may fail and we silently fall back to
// 30s polling. We intentionally do NOT block initial load on the
// watcher — the first poll below also reads fresh data.
function tryWatchIdentityScoreUpdated(onAnyUpdate: () => void): () => void {
  try {
    const address = identityRegistryAddress;
    if (address === zeroAddress) return () => {};
    const unwatch = publicClient.watchContractEvent({
      address,
      abi: identityRegistryAbi,
      eventName: "IdentityScoreUpdated",
      onLogs: () => onAnyUpdate(),
    });
    if (typeof unwatch === "function") return unwatch;
    return () => {};
  } catch {
    return () => {};
  }
}

export function useIdentityLeaderboard() {
  const [rows, setRows] = useState<IdentityLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Auto-refresh: poll the canonical registry every 30s (paused when tab
  // is hidden) and on any IdentityScoreUpdated event. The event watcher
  // is best-effort; if the RPC doesn't support filters it silently no-ops.
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => setReloadTick((t) => t + 1), 30_000);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    if (typeof document !== "undefined") {
      if (document.visibilityState === "visible") start();
      const onVis = () => {
        if (document.visibilityState === "visible") { start(); setReloadTick((t) => t + 1); }
        else stop();
      };
      document.addEventListener("visibilitychange", onVis);
      return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
    }
    start();
    return () => stop();
  }, []);

  useEffect(() => {
    const unwatch = tryWatchIdentityScoreUpdated(() => setReloadTick((t) => t + 1));
    return () => { try { (unwatch as () => void)(); } catch { /* noop */ } };
  }, []);

  useEffect(() => {
    if (!hasIdentityRegistry) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        // Read the canonical wallet list from the registry.
        const lenBig = (await publicClient.readContract({
          address: identityRegistryAddress,
          abi: identityRegistryAbi,
          functionName: "indexedLength",
        })) as bigint;
        const len = Number(lenBig);
        if (len === 0) {
          if (!cancelled) {
            setRows([]);
            setLoading(false);
          }
          return;
        }

        // Page through indexed wallets (max 100 per page per ABI).
        const wallets: Address[] = [];
        const PAGE = 100;
        for (let off = 0; off < len; off += PAGE) {
          const batch = (await publicClient.readContract({
            address: identityRegistryAddress,
            abi: identityRegistryAbi,
            functionName: "getIndexedWallets",
            args: [BigInt(off), BigInt(PAGE)],
          })) as Address[];
          for (const w of batch) wallets.push(w);
        }

        // Read each wallet's canonical snapshot in parallel.
        const snaps = await Promise.all(
          wallets.map((w) =>
            publicClient
              .readContract({
                address: identityRegistryAddress,
                abi: identityRegistryAbi,
                functionName: "getIdentity",
                args: [w],
              })
              .then((snap) => ({ wallet: w, snap: snap as unknown as { totalScore: bigint; rank: bigint; trainingLevel: bigint; totalXp: bigint; currentPower: bigint; currentRarity: bigint } }))
              .catch(() => null),
          ),
        );

        const entries: IdentityLeaderboardEntry[] = [];
        for (const entry of snaps) {
          if (!entry) continue;
          const totalScore = Number(entry.snap.totalScore);
          if (totalScore === 0) continue; // skip unsynced
          entries.push({
            wallet: entry.wallet,
            totalScore,
            rankScore: totalScore,
            identityTier: rankLabelFromUint(entry.snap.rank),
            trainingLevel: Number(entry.snap.trainingLevel),
            totalXp: Number(entry.snap.totalXp),
            currentPower: Number(entry.snap.currentPower),
            currentRarity: Number(entry.snap.currentRarity),
          });
        }

        // Source-of-truth: totalScore descending only. No tie-breaking.
        entries.sort((a, b) => b.totalScore - a.totalScore);

        if (!cancelled) {
          setRows(entries);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  return {
    rows,
    loading,
    syncPending: hasIdentityRegistry && !loading && rows.length === 0,
    refetch: () => setReloadTick((t) => t + 1),
  };
}
