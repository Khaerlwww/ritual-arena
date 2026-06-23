// achievementEngine.ts
// Achievement definitions and scoring for Ritual Arena Identity Ranking.
// All achievements are one-time unlocks. Cannot be farmed.

import { keccak256, toUtf8Bytes } from "ethers";

function aid(name: string): `0x${string}` {
  return keccak256(toUtf8Bytes(name)) as `0x${string}`;
}

// ─── ACHIEVEMENT IDs (bytes32) ──────────────────────────────────────────────

export const ACHIEVEMENT_IDS = {
  FIRST_FORGE: aid("FIRST_FORGE"),
  FIRST_TRAINING: aid("FIRST_TRAINING"),
  LEVEL_10: aid("LEVEL_10"),
  LEVEL_25: aid("LEVEL_25"),
  LEVEL_50: aid("LEVEL_50"),
  FIRST_DUEL: aid("FIRST_DUEL"),
  FIRST_WIN: aid("FIRST_WIN"),
  BATTLES_5: aid("BATTLES_5"),
  BATTLES_14: aid("BATTLES_14"),
  BATTLES_30: aid("BATTLES_30"),
  WINS_5: aid("WINS_5"),
  WINS_10: aid("WINS_10"),
  WINS_20: aid("WINS_20"),
  STREAK_7: aid("STREAK_7"),
  STREAK_14: aid("STREAK_14"),
} as const;

// ─── ACHIEVEMENT SCORING ─────────────────────────────────────────────────────
// Total max = 2500

export const ACHIEVEMENT_POINTS: Record<string, number> = {
  [ACHIEVEMENT_IDS.FIRST_FORGE]: 100,
  [ACHIEVEMENT_IDS.FIRST_TRAINING]: 100,
  [ACHIEVEMENT_IDS.LEVEL_10]: 150,
  [ACHIEVEMENT_IDS.LEVEL_25]: 250,
  [ACHIEVEMENT_IDS.LEVEL_50]: 400,
  [ACHIEVEMENT_IDS.FIRST_DUEL]: 100,
  [ACHIEVEMENT_IDS.FIRST_WIN]: 150,
  [ACHIEVEMENT_IDS.BATTLES_5]: 100,
  [ACHIEVEMENT_IDS.BATTLES_14]: 150,
  [ACHIEVEMENT_IDS.BATTLES_30]: 250,
  [ACHIEVEMENT_IDS.WINS_5]: 150,
  [ACHIEVEMENT_IDS.WINS_10]: 250,
  [ACHIEVEMENT_IDS.WINS_20]: 400,
  [ACHIEVEMENT_IDS.STREAK_7]: 200,
  [ACHIEVEMENT_IDS.STREAK_14]: 300,
};

export const MAX_ACHIEVEMENT_SCORE = 2500;
export const TOTAL_ACHIEVEMENTS = 15;

export function getAchievementPoints(achievementId: string): number {
  return ACHIEVEMENT_POINTS[achievementId] ?? 0;
}

export function calcAchievementScore(unlockedIds: readonly string[]): number {
  let total = 0;
  for (const id of unlockedIds) {
    total += getAchievementPoints(id);
  }
  return Math.min(total, MAX_ACHIEVEMENT_SCORE);
}

// ─── ACHIEVEMENT DEFINITIONS ─────────────────────────────────────────────────
// Each achievement uses bytes32 id (ACHIEVEMENT_IDS), slug for display/key.

export interface Achievement {
  key: string;
  id: `0x${string}`; // bytes32
  slug: string;
  name: string;
  description: string;
  category: "progression" | "arena" | "consistency";
  points: number;
  check: (state: AchievementState) => boolean;
  unlocked?: boolean;
  progressPct?: number;
}

export interface AchievementState {
  hasForged: boolean;
  hasTrained: boolean;
  trainingLevel: number;
  battlesPlayed: number;
  wins: number;
  currentStreak: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  // Progression (5)
  {
    key: "FIRST_FORGE",
    id: ACHIEVEMENT_IDS.FIRST_FORGE,
    slug: "first_forge",
    name: "First Forge",
    description: "Forge your first Identity Card",
    category: "progression",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.FIRST_FORGE],
    check: (s) => s.hasForged,
  },
  {
    key: "FIRST_TRAINING",
    id: ACHIEVEMENT_IDS.FIRST_TRAINING,
    slug: "first_training",
    name: "First Training",
    description: "Complete your first training session",
    category: "progression",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.FIRST_TRAINING],
    check: (s) => s.hasTrained,
  },
  {
    key: "LEVEL_10",
    id: ACHIEVEMENT_IDS.LEVEL_10,
    slug: "level_10",
    name: "Level 10",
    description: "Reach training level 10",
    category: "progression",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.LEVEL_10],
    check: (s) => s.trainingLevel >= 10,
  },
  {
    key: "LEVEL_25",
    id: ACHIEVEMENT_IDS.LEVEL_25,
    slug: "level_25",
    name: "Level 25",
    description: "Reach training level 25",
    category: "progression",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.LEVEL_25],
    check: (s) => s.trainingLevel >= 25,
  },
  {
    key: "LEVEL_50",
    id: ACHIEVEMENT_IDS.LEVEL_50,
    slug: "level_50",
    name: "Level 50",
    description: "Reach training level 50",
    category: "progression",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.LEVEL_50],
    check: (s) => s.trainingLevel >= 50,
  },

  // Arena (8)
  {
    key: "FIRST_DUEL",
    id: ACHIEVEMENT_IDS.FIRST_DUEL,
    slug: "first_duel",
    name: "First Duel",
    description: "Participate in your first arena duel",
    category: "arena",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.FIRST_DUEL],
    check: (s) => s.battlesPlayed >= 1,
  },
  {
    key: "FIRST_WIN",
    id: ACHIEVEMENT_IDS.FIRST_WIN,
    slug: "first_win",
    name: "First Win",
    description: "Win your first arena duel",
    category: "arena",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.FIRST_WIN],
    check: (s) => s.wins >= 1,
  },
  {
    key: "BATTLES_5",
    id: ACHIEVEMENT_IDS.BATTLES_5,
    slug: "battles_5",
    name: "5 Battles",
    description: "Participate in 5 duels",
    category: "arena",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.BATTLES_5],
    check: (s) => s.battlesPlayed >= 5,
  },
  {
    key: "BATTLES_14",
    id: ACHIEVEMENT_IDS.BATTLES_14,
    slug: "battles_14",
    name: "14 Battles",
    description: "Participate in 14 duels",
    category: "arena",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.BATTLES_14],
    check: (s) => s.battlesPlayed >= 14,
  },
  {
    key: "BATTLES_30",
    id: ACHIEVEMENT_IDS.BATTLES_30,
    slug: "battles_30",
    name: "30 Battles",
    description: "Participate in 30 duels",
    category: "arena",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.BATTLES_30],
    check: (s) => s.battlesPlayed >= 30,
  },
  {
    key: "WINS_5",
    id: ACHIEVEMENT_IDS.WINS_5,
    slug: "wins_5",
    name: "5 Wins",
    description: "Win 5 duels",
    category: "arena",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.WINS_5],
    check: (s) => s.wins >= 5,
  },
  {
    key: "WINS_10",
    id: ACHIEVEMENT_IDS.WINS_10,
    slug: "wins_10",
    name: "10 Wins",
    description: "Win 10 duels",
    category: "arena",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.WINS_10],
    check: (s) => s.wins >= 10,
  },
  {
    key: "WINS_20",
    id: ACHIEVEMENT_IDS.WINS_20,
    slug: "wins_20",
    name: "20 Wins",
    description: "Win 20 duels",
    category: "arena",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.WINS_20],
    check: (s) => s.wins >= 20,
  },

  // Consistency (2)
  {
    key: "STREAK_7",
    id: ACHIEVEMENT_IDS.STREAK_7,
    slug: "streak_7",
    name: "7 Day Streak",
    description: "Maintain a 7-day training streak",
    category: "consistency",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.STREAK_7],
    check: (s) => s.currentStreak >= 7,
  },
  {
    key: "STREAK_14",
    id: ACHIEVEMENT_IDS.STREAK_14,
    slug: "streak_14",
    name: "14 Day Streak",
    description: "Maintain a 14-day training streak",
    category: "consistency",
    points: ACHIEVEMENT_POINTS[ACHIEVEMENT_IDS.STREAK_14],
    check: (s) => s.currentStreak >= 14,
  },
];

// ─── CHECK ACHIEVEMENTS — returns bytes32 IDs ────────────────────────────────

export function checkAchievements(state: AchievementState): `0x${string}`[] {
  return ACHIEVEMENTS.filter((a) => a.check(state)).map((a) => a.id);
}

export function getAchievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

export function getAchievementBySlug(slug: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.slug === slug);
}

export function getAchievementsByCategory(
  category: Achievement["category"]
): Achievement[] {
  return ACHIEVEMENTS.filter((a) => a.category === category);
}

// ─── BACKWARD COMPATIBLE WRAPPERS ────────────────────────────────────────────

export function computeAchievements(params: {
  cardsOwned: number;
  cardLevel: number;
  arenaWins: number;
  activeStakes: number;
  maxStakeDays: number;
  identityScore: number;
}): { unlocked: string[]; bonus: number; achievements: Achievement[] } {
  const state = {
    hasForged: params.cardsOwned > 0,
    hasTrained: params.cardLevel > 1,
    trainingLevel: params.cardLevel,
    battlesPlayed: params.arenaWins + Math.floor(params.arenaWins * 0.3),
    wins: params.arenaWins,
    currentStreak: Math.min(params.maxStakeDays, 14),
  };
  const unlockedIds = checkAchievements(state);
  const achievements = ACHIEVEMENTS.map((a) => ({
    ...a,
    unlocked: unlockedIds.includes(a.id),
  }));
  return { unlocked: unlockedIds, bonus: calcAchievementScore(unlockedIds), achievements };
}

export function achievementBonus(unlockedCount: number): number {
  return unlockedCount * 50;
}

export const activeProfileTitle = (achievements: any[], identity: any): string => {
  const tier = identity?.tier || identity?.rank || "INITIATE";
  const titles: Record<string, string> = {
    INITIATE: "Initiate",
    ASCENDANT: "Ascendant",
    BITTY: "Bitty",
    RITTY: "Ritty",
    RITUALIST: "Ritualist",
    "RADIANT RITUALIST": "Radiant Ritualist",
  };
  return titles[tier] || "Initiate";
};
