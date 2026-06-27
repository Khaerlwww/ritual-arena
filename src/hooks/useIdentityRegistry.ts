import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { identityRegistryAbi } from "../abi/identityRegistry";
import { identityRegistryAddress, hasIdentityRegistry, zeroAddress } from "../lib/chains";
import { identityProgress, type IdentityView } from "../lib/identityEngine";
import { publicClient } from "./useAnthem";
import { rankLabelFromUint } from "../lib/identityRanks";
import { on } from "../lib/eventBus";

export { identityRegistryAddress, hasIdentityRegistry } from "../lib/chains";

// Subscribe to IdentityScoreUpdated to refresh the profile snapshot the
// moment any contract pushes a new score for the connected wallet.
// Best-effort: if the RPC doesn't support filters it silently no-ops.
function tryWatchIdentityScoreUpdated(
  wallet: Address | undefined,
  onUpdate: () => void,
): () => void {
  if (!wallet) return () => {};
  if (identityRegistryAddress === zeroAddress) return () => {};
  try {
    const unwatch = publicClient.watchContractEvent({
      address: identityRegistryAddress,
      abi: identityRegistryAbi,
      eventName: "IdentityScoreUpdated",
      args: { wallet },
      onLogs: () => onUpdate(),
    });
    if (typeof unwatch === "function") return unwatch;
    return () => {};
  } catch {
    return () => {};
  }
}

// RANK_LABELS lives in src/lib/identityRanks.ts and is the single source
// of truth (mirrors the on-chain identity ranks).

type Snapshot = {
  trainingScore: bigint;
  achievementScore: bigint;
  arenaScore: bigint;
  collectionScore: bigint;
  totalScore: bigint;
  rank: number;
  trainingLevel: bigint;
  totalXp: bigint;
  currentPower: number;
  currentRarity: number;
  version: number;
  updatedAt: bigint;
};

/**
 * Canonical IdentityRegistry snapshot.
 *
 * IdentityRegistry IS THE SINGLE SOURCE OF TRUTH for Identity Score, Rank,
 * Training Level, XP, and Card Power/Rarity snapshot. The hook polls the
 * registry on a 30s interval AND exposes a manual `refetch()` plus a
 * `reloadTrigger` prop that callers can bump after any state-changing
 * action (forge, train, arena settlement, achievement unlock) so
 * the profile and the leaderboard display the same value for the same
 * wallet.
 *
 * No fallback ranking. No client-side score calculation. When the registry
 * has not yet recorded the wallet (updatedAt == 0), the hook returns the
 * caller-supplied fallback with `canonical: false` — UI should display
 * "Sync Pending" in that case rather than guessing.
 */
export function useIdentityRegistry(
  address: Address | undefined,
  fallback: IdentityView,
  reloadTrigger: number = 0,
): IdentityView & { refetch: () => void; isStale: boolean } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [internalTick, setInternalTick] = useState(0);
  const [lastFetchedAt, setLastFetchedAt] = useState(0);

  const refetch = useCallback(() => setInternalTick((t) => t + 1), []);

  // Poll every 30s, but pause when the tab is hidden. The visibility
  // listener also triggers an immediate re-fetch when the user returns,
  // so a freshly focused tab always shows fresh data.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => setInternalTick((t) => t + 1), 30_000);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    if (typeof document !== "undefined") {
      if (document.visibilityState === "visible") start();
      const onVis = () => {
        if (document.visibilityState === "visible") { start(); setInternalTick((t) => t + 1); }
        else stop();
      };
      document.addEventListener("visibilitychange", onVis);
      return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
    }
    start();
    return () => stop();
  }, []);

  // Event-driven refresh: when IdentityRegistry pushes a new score for
  // the connected wallet, refetch the snapshot immediately. Best-effort
  // — silently no-ops on RPCs that don't support filters.
  useEffect(() => {
    const unwatch = tryWatchIdentityScoreUpdated(address, () =>
      setInternalTick((t) => t + 1),
    );
    return () => { try { (unwatch as () => void)(); } catch { /* noop */ } };
  }, [address]);

  // Also listen to client-side event bus for same-tab invalidation
  // (training, mint, etc. emit this from the same React tree).
  useEffect(() => {
    return on("identity-changed", () => setInternalTick((t) => t + 1));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!address || !hasIdentityRegistry) {
      setSnapshot(null);
      return;
    }

    publicClient
      .readContract({
        address: identityRegistryAddress,
        abi: identityRegistryAbi,
        functionName: "getIdentity",
        args: [address],
      })
      .then((value) => {
        if (cancelled) return;
        setSnapshot(value as Snapshot);
        setLastFetchedAt(Date.now());
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null);
      });

    return () => {
      cancelled = true;
    };
  }, [address, internalTick, reloadTrigger]);

  return useMemo(() => {
    const refetchHandle = { refetch };
    if (!snapshot || snapshot.updatedAt === 0n) {
      return { ...fallback, ...refetchHandle, isStale: true };
    }

    const score = Number(snapshot.totalScore);
    // Rank comes from the registry directly (uint8). Fall back to UNKNOWN
    // if the contract ever returns an out-of-range value (e.g. a new tier
    // added). The shared `rankLabelFromUint` enforces this and warns.
    const rank = rankLabelFromUint(snapshot.rank);
    const progress = identityProgress(score);

    // The 4 component scores from the registry's getIdentity() snapshot.
    // These are the SAME values the leaderboard reads. sum(components)
    // is always equal to `score` (the registry's totalScore) — this
    // invariant is enforced by the identity score update on-chain.
    // We surface them here so the UI (Profile / Breakdown) reads from
    // the same source as the leaderboard.
    const components = {
      training: Number(snapshot.trainingScore),
      arena: Number(snapshot.arenaScore),
      achievement: Number(snapshot.achievementScore),
      collection: Number(snapshot.collectionScore),
    };

    return {
      ...fallback,
      score,
      rank,
      level: Number(snapshot.trainingLevel),
      totalXp: Number(snapshot.totalXp),
      nextRank: progress.nextRank,
      nextRankAt: progress.nextRankAt,
      progressPct: progress.progressPct,
      canonical: true,
      registryUpdatedAt: Number(snapshot.updatedAt),
      registryVersion: Number(snapshot.version),
      // Surface the registry power/rarity to the UI as canonical card state.
      // (Profile window consumes these so the "Power" / "Grade" stats stay
      //  in sync with the leaderboard, both reading from getIdentity().)
      currentPower: Number(snapshot.currentPower),
      currentRarity: Number(snapshot.currentRarity),
      // Canonical component scores — same source as the leaderboard.
      components,
      sources: fallback.sources.map((source) =>
        source.label === "Card Progression" || source.label === "Achievements"
          ? { ...source, trust: "on-chain" as const, detail: `${source.detail} Canonical registry synced.` }
          : source,
      ),
      ...refetchHandle,
      isStale: false,
    };
  }, [fallback, snapshot, refetch]);
}
