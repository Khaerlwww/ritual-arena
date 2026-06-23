// src/shared/powerModel.ts
// Shared power scoring model — single source of truth for frontend AND backend.
// Power is based on Training + Arena activity (NOT tx count).
// If you change scoring logic, increment POWER_MODEL_VERSION.

export const POWER_MODEL_VERSION = 2;

export type EvolutionInput = {
  totalXp: number;
  wins: number;
  longestStreak: number;
  currentPower?: number;
};

/**
 * Calculate evolved power from training + arena activity.
 * Formula tuned for 14-day campaign: fully active user reaches ~90 power.
 *
 *   xpScore     = min(totalXp * 10 / 35, 50)        → 140 XP in 14 days = 40 pts
 *   winScore    = min(wins * 4, 30)                   → 8 wins in 14 days  = 30 pts
 *   streakScore = min(longestStreak * 10 / 7, 20)    → streak 14         = 20 pts
 *
 * Never decreases — always >= currentPower.
 */
export function calcEvolutionPower(input: EvolutionInput): number {
  const xpScore = Math.min(input.totalXp * 10 / 35, 50);
  const winScore = Math.min(input.wins * 4, 30);
  const streakScore = Math.min(input.longestStreak * 10 / 7, 20);

  const candidate = Math.min(xpScore + winScore + streakScore, 100);
  return Math.max(candidate, input.currentPower ?? 1);
}

/**
 * Rarity thresholds — campaign-tuned for 14 days.
 * Matches _rarityFromPower() in RitualAnthem.sol EXACTLY.
 *
 *   INITIATE    1–19   (rank 0)
 *   BITTY     20–39   (rank 1)
 *   RITTY     40–65   (rank 2)
 *   RITUALIST 66–79  (rank 3)
 *   RADIANT   80–100  (rank 4)
 */
export function rarityFromPower(power: number): number {
  if (power >= 80) return 4; // RADIANT
  if (power >= 66) return 3; // RITUALIST
  if (power >= 40) return 2; // RITTY
  if (power >= 20) return 1; // BITTY
  return 0;                  // INITIATE
}

/** Rarity rank → human label */
export function rarityLabel(rank: number): string {
  return ["INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT"][rank] ?? "INITIATE";
}
