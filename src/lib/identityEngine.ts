// identityEngine.ts
// Composite Identity Score view for Ritual Arena leaderboard.
// No AP, staking, or marketplace contributions.
//
// Rank/score math now lives in src/lib/identityRanks.ts (single source
// of truth, mirrors IdentityRegistry.sol). This file is the React
// IdentityView shape + the fallback passed to useIdentityRegistry.

import type { Address } from "viem";
import {
  RANK_LABELS,
  RANK_UNKNOWN,
  rankProgressFromScore,
  rankLabelFromUint,
  type RankLabel,
  type RankLabelOrUnknown,
} from "./identityRanks";

// Re-export for callers that imported these from identityEngine.
export { RANK_LABELS, RANK_UNKNOWN, rankLabelFromUint, rankProgressFromScore };
export type { RankLabel, RankLabelOrUnknown };

export interface IdentityView {
  score: number;
  rank: RankLabelOrUnknown;
  level: number;
  totalXp: number;
  nextRank: RankLabelOrUnknown;
  nextRankAt: number;
  progressPct: number;
  canonical: boolean;
  registryUpdatedAt: number;
  registryVersion: number;
  sources: { label: string; detail: string; trust: string }[];
  /** Canonical currentPower from IdentityRegistry (0 if not yet recorded). */
  currentPower?: number;
  /** Canonical currentRarity from IdentityRegistry (-1 if not yet recorded). */
  currentRarity?: number;
  /**
   * Canonical component scores from `IdentityRegistry.getIdentity(wallet)`:
   * the SAME values that the leaderboard reads. `sum(components)`
   * is always equal to `score` (the registry's `totalScore`). When
   * `canonical` is false (registry has not yet recorded the wallet),
   * these fields are undefined and consumers must show "Sync Pending"
   * — never a locally-calculated value.
   */
  components?: {
    training: number;
    arena: number;
    achievement: number;
    collection: number;
  };
}

// Tier color map — UI styling only. Rank semantics live in identityRanks.ts.
export const IDENTITY_TIERS = [
  { name: "INITIATE",          minRank: 0,   maxRank: 99,  color: "text-iceaccent/70" },
  { name: "ASCENDANT",         minRank: 100, maxRank: 249, color: "text-aqua" },
  { name: "BITTY",             minRank: 250, maxRank: 449, color: "text-[#7dd3fc]" },
  { name: "RITTY",             minRank: 450, maxRank: 699, color: "text-[#c9b8ff]" },
  { name: "RITUALIST",         minRank: 700, maxRank: 899, color: "text-[#ffd76a]" },
  { name: "RADIANT RITUALIST", minRank: 900, maxRank: 1000, color: "text-[#ff6a6a]" },
] as const;

export type IdentityTier = (typeof IDENTITY_TIERS)[number]["name"];

export function getTierColor(tier: IdentityTier | RankLabelOrUnknown): string {
  const known = IDENTITY_TIERS.find((t) => t.name === tier);
  if (known) return known.color;
  return "text-iceaccent/70";
}

// ─── BACKWARD COMPATIBLE WRAPPERS ────────────────────────────────────────────
// These wrap the new identityRanks.ts for existing code that calls
// identityProgress or expects a string return.

/**
 * @deprecated Use `rankProgressFromScore` from `./identityRanks` directly.
 * This wrapper is kept for back-compat with the previous `identityEngine`
 * public API and computes identical values.
 */
export function identityProgress(score: number): {
  rank: RankLabelOrUnknown;
  nextRank: RankLabelOrUnknown;
  nextRankAt: number;
  progressPct: number;
} {
  return rankProgressFromScore(score);
}
