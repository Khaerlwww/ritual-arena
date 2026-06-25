// src/lib/identityRanks.ts
// Single source of truth for Identity Rank tiers + label mapping.
// Mirrors IdentityRegistry.sol exactly:
//   rankScore = identityScore (already 0..1000, no scaling)
//   0..99     -> INITIATE
//   100..249  -> ASCENDANT
//   250..449  -> BITTY
//   450..699  -> RITTY
//   700..899  -> RITUALIST
//   900..1000 -> RADIANT RITUALIST
//
// Used by:
//   - src/lib/identityEngine.ts (Profile + progress math)
//   - src/hooks/useIdentityLeaderboard.ts (leaderboard display)
//   - api/_lib.js (server metadata)
//   - src/components/StatusHUD.tsx (Identity Score display)
//
// Unknown rank uint8 (e.g. 6, 7, …) returns "UNKNOWN" — never silently
// downgraded to INITIATE.

export const RANK_LABELS = [
  "INITIATE",            // 0
  "ASCENDANT",           // 1
  "BITTY",               // 2
  "RITTY",               // 3
  "RITUALIST",           // 4
  "RADIANT RITUALIST",   // 5
] as const;

export type RankLabel = (typeof RANK_LABELS)[number];
export const RANK_UNKNOWN: "UNKNOWN" = "UNKNOWN" as const;
export type RankLabelOrUnknown = RankLabel | typeof RANK_UNKNOWN;

export const RANK_THRESHOLDS = [
  { min: 0,   max: 99,  label: "INITIATE" as RankLabel },
  { min: 100, max: 249, label: "ASCENDANT" as RankLabel },
  { min: 250, max: 449, label: "BITTY" as RankLabel },
  { min: 450, max: 699, label: "RITTY" as RankLabel },
  { min: 700, max: 899, label: "RITUALIST" as RankLabel },
  { min: 900, max: 1000, label: "RADIANT RITUALIST" as RankLabel },
] as const;

export const MAX_RANK_SCORE = 1000;
export const MAX_IDENTITY_SCORE = 1000;

/** Convert a uint8 from registry.getRank() to a label. */
export function rankLabelFromUint(rank: number | bigint | undefined | null): RankLabelOrUnknown {
  if (rank === undefined || rank === null) return RANK_UNKNOWN;
  const idx = Number(rank);
  if (!Number.isInteger(idx) || idx < 0 || idx >= RANK_LABELS.length) {
    if (typeof console !== "undefined") {
      console.warn(`[identityRanks] unknown rank uint8: ${rank}`);
    }
    return RANK_UNKNOWN;
  }
  return RANK_LABELS[idx];
}

/** Compute the rank score (0..1000) the contract uses for tier lookup. */
export function rankScoreFromIdentityScore(totalScore: number): number {
  if (!Number.isFinite(totalScore) || totalScore <= 0) return 0;
  return Math.floor((totalScore * MAX_RANK_SCORE) / MAX_IDENTITY_SCORE);
}

/** Compute the rank label directly from totalScore. */
export function rankFromScore(totalScore: number): RankLabelOrUnknown {
  const rs = rankScoreFromIdentityScore(totalScore);
  for (const t of RANK_THRESHOLDS) {
    if (rs <= t.max) return t.label;
  }
  return RANK_UNKNOWN;
}

/** Compute the rank uint8 (same algorithm as IdentityRegistry.rankForScore). */
export function rankUintFromScore(totalScore: number): number {
  const rs = rankScoreFromIdentityScore(totalScore);
  for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
    if (rs <= RANK_THRESHOLDS[i].max) return i;
  }
  return -1; // signal unknown
}

export interface RankProgress {
  rank: RankLabelOrUnknown;
  nextRank: RankLabelOrUnknown;
  nextRankAt: number; // identity score at which next rank unlocks
  progressPct: number;
}

export const NO_PROGRESS: RankProgress = {
  rank: RANK_UNKNOWN,
  nextRank: RANK_UNKNOWN,
  nextRankAt: 0,
  progressPct: 0,
};

/**
 * Progress within the rank tier, matching contract thresholds.
 *  - rank: the tier the user is currently in
 *  - nextRank: the next tier (RANK_UNKNOWN if already at top)
 *  - nextRankAt: the identity score threshold at which nextRank unlocks
 *  - progressPct: 0..100 of how far through the current tier
 *
 * Note: thresholds here are identity scores (0..1000). `nextRankAt`
 * can be rendered directly by the Profile, e.g. "Reach 450 to unlock RITTY".
 */
export function rankProgressFromScore(totalScore: number): RankProgress {
  const rs = rankScoreFromIdentityScore(totalScore);
  if (rs < 0) return NO_PROGRESS;

  // Locate current tier (rs <= tier.max)
  let tierIdx = -1;
  for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
    if (rs <= RANK_THRESHOLDS[i].max) { tierIdx = i; break; }
  }
  if (tierIdx === -1) return NO_PROGRESS;

  const tier = RANK_THRESHOLDS[tierIdx];
  const next = tierIdx + 1 < RANK_THRESHOLDS.length ? RANK_THRESHOLDS[tierIdx + 1] : null;

  const tierMinRankScore = tier.min;
  const tierMaxRankScore = tier.max;
  const tierWidth = tierMaxRankScore - tierMinRankScore; // 0 for top tier? no: top is 1000-900=100
  const intoTier = Math.max(0, rs - tierMinRankScore);
  const progressPct = tierWidth > 0
    ? Math.min(100, Math.round((intoTier / tierWidth) * 100))
    : 100;

  if (!next) {
    // top tier
    return {
      rank: tier.label,
      nextRank: RANK_UNKNOWN,
      nextRankAt: MAX_IDENTITY_SCORE,
      progressPct: 100,
    };
  }

  // nextRankAt is the identity score at the *upper* edge of the next tier's
  // rank-score range, which equals the rank score that triggers the next
  // tier. Convert rank score to identity score via the inverse formula
  // (round up so we don't under-report the threshold).
  const nextRankAt = Math.ceil((next.min * MAX_IDENTITY_SCORE) / MAX_RANK_SCORE);

  return {
    rank: tier.label,
    nextRank: next.label,
    nextRankAt,
    progressPct,
  };
}
