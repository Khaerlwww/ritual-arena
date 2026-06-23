// src/lib/xpEngine.ts
// Dead code (was used to derive XP from daily check-in, which has been
// removed from RitualArena in V5). XP is now driven exclusively by the
// IdentityRegistry training/arena/achievement/collection components.
// This file is kept as a no-op stub to avoid stale imports.

import { XP_REWARDS, type Reward } from "./rewardEngine";

export const LEVEL_SIZE = 500; // XP per level (legacy constant)

export type XpView = {
  totalXp: number;
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
  progressPct: number;
  nextUnlock?: Reward;
  unlocked: Reward[];
  locked: Reward[];
  breakdown: { label: string; xp: number }[];
  log: string[];
};

export const EMPTY_XP_VIEW: XpView = {
  totalXp: 0,
  level: 1,
  xpIntoLevel: 0,
  xpForLevel: LEVEL_SIZE,
  progressPct: 0,
  unlocked: [],
  locked: XP_REWARDS.map((r) => r.reward),
  breakdown: [],
  log: [],
};
