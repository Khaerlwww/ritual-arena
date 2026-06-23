// powerEngine.ts
// Re-export from shared/powerModel — single source of truth.
export {
  POWER_MODEL_VERSION,
  calcEvolutionPower,
  rarityFromPower,
  rarityLabel,
} from "../shared/powerModel";
export type { EvolutionInput } from "../shared/powerModel";

// X (Twitter) social multiplier — frontend-only, not part of the shared model
export type XData = {
  ritualTagCount: number;
  followers: number;
  following: number;
  tweetsPerWeek: number;
  avgEngagementRate: number;
};

export function calcXMultiplier(xData: XData): number {
  let bonus = 0;
  const tags = Math.max(0, xData.ritualTagCount);
  bonus += tags >= 6 ? 0.15 : tags >= 3 ? 0.1 : tags >= 1 ? 0.05 : 0;
  const ratio = Math.max(0, xData.followers) / Math.max(Math.max(0, xData.following), 1);
  bonus += ratio >= 2 ? 0.05 : ratio >= 1 ? 0.03 : 0;
  bonus += xData.tweetsPerWeek >= 4 ? 0.05 : xData.tweetsPerWeek >= 1 ? 0.02 : 0;
  const engagementRate = Math.max(0, xData.avgEngagementRate);
  bonus += engagementRate > 0.05 ? 0.05 : engagementRate > 0.03 ? 0.04 : engagementRate > 0.01 ? 0.02 : 0;
  return Math.min(1 + bonus, 1.3);
}
