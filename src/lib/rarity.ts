// ---------------------------------------------------------------------------
// Ritual Anthem — Rarity Engine
// ---------------------------------------------------------------------------
// Single source of truth for card rarity. The renderer READS these values; it
// never invents or randomly assigns visual effects. Every tier has fixed,
// measurable attributes so the collection reads as a real CCG with meaningful
// rarity progression. Rarity is decided by SCORE only (see rarityFromScore).
//
// Thresholds tuned for 14-day campaign — active user = ~90 power = RADIANT.
//
//   0         = invalid / no snapshot
//   INITIATE    1–19
//   BITTY     20–39
//   RITTY     40–65
//   RITUALIST 66–79
//   RADIANT   80–100
//
// Mirrors rarityFromPower() in powerModel.ts and _rarityFromPower() in RitualAnthem.sol.
//
// What changes per rarity: Frame, Background, Foil, Particles, Glow.
// What stays constant for every card: the layout/template.
// ---------------------------------------------------------------------------

export type Rarity = "INITIATE" | "BITTY" | "RITTY" | "RITUALIST" | "RADIANT" | "GENESIS";

import { rarityFromPower } from "./powerEngine";

export type BorderType =
  | "silver"
  | "rainbow"
  | "holographic"
  | "gold-chrome"
  | "prism"
  | "black-chrome-prism";

export type EffectPreset =
  | "matte-minimal"
  | "holo-light"
  | "holo-full"
  | "gold-energy"
  | "cosmic-prism"
  | "genesis-omega";

export type RarityPreset = {
  rarity: Rarity;
  borderType: BorderType;
  foilCoverage: number; // 0-100
  glowIntensity: number; // 0-100
  particleDensity: number; // 0-100
  frameComplexity: number; // 1-6
  backgroundIntensity: number; // 0-100
  effectPreset: EffectPreset;
};

/** Fixed, measurable presets. Values match the locked rarity spec exactly. */
export const RARITY_PRESETS: Record<Rarity, RarityPreset> = {
  INITIATE: {
    rarity: "INITIATE",
    borderType: "silver",
    foilCoverage: 10,
    glowIntensity: 5,
    particleDensity: 0,
    frameComplexity: 1,
    backgroundIntensity: 10,
    effectPreset: "matte-minimal",
  },
  BITTY: {
    rarity: "BITTY",
    borderType: "rainbow",
    foilCoverage: 30,
    glowIntensity: 20,
    particleDensity: 10,
    frameComplexity: 2,
    backgroundIntensity: 30,
    effectPreset: "holo-light",
  },
  RITTY: {
    rarity: "RITTY",
    borderType: "holographic",
    foilCoverage: 60,
    glowIntensity: 40,
    particleDensity: 25,
    frameComplexity: 3,
    backgroundIntensity: 50,
    effectPreset: "holo-full",
  },
  RITUALIST: {
    rarity: "RITUALIST",
    borderType: "gold-chrome",
    foilCoverage: 80,
    glowIntensity: 60,
    particleDensity: 40,
    frameComplexity: 4,
    backgroundIntensity: 70,
    effectPreset: "gold-energy",
  },
  RADIANT: {
    rarity: "RADIANT",
    borderType: "prism",
    foilCoverage: 90,
    glowIntensity: 80,
    particleDensity: 60,
    frameComplexity: 5,
    backgroundIntensity: 85,
    effectPreset: "cosmic-prism",
  },
  GENESIS: {
    rarity: "GENESIS",
    borderType: "black-chrome-prism",
    foilCoverage: 100,
    glowIntensity: 100,
    particleDensity: 100,
    frameComplexity: 6,
    backgroundIntensity: 100,
    effectPreset: "genesis-omega",
  },
};

export const RARITY_ORDER: Rarity[] = ["INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT", "GENESIS"];

/** Collector label + star rating shown top-right of the card (layout-constant slot). */
export const RARITY_BADGE: Record<Rarity, { label: Rarity; stars: number; tag: string }> = {
  INITIATE: { label: "INITIATE", stars: 1, tag: "INITIATE" },
  BITTY: { label: "BITTY", stars: 2, tag: "BITTY" },
  RITTY: { label: "RITTY", stars: 3, tag: "RITTY" },
  RITUALIST: { label: "RITUALIST", stars: 4, tag: "RITUALIST" },
  RADIANT: { label: "RADIANT", stars: 5, tag: "RADIANT" },
  GENESIS: { label: "GENESIS", stars: 6, tag: "GENESIS" },
};

/**
 * SCORE decides grade: no randomness and no mint-order override.
 *
 *   0         = invalid / no snapshot (not a valid stored power)
 *   INITIATE    1-39
 *   BITTY      40-59
 *   RITTY      60-74
 *   RITUALIST 75-89
 *   RADIANT    90-100
 *
 * Uses the shared rarityFromPower mapping to ensure frontend/backend consistency.
 */
export function rarityFromScore(score: number, _genesis = false): Rarity {
  const rank = rarityFromPower(score);
  return RARITY_NAMES[rank] ?? "INITIATE";
}

/**
 * Daily-streak rarity boost. Mirrors the on-chain `_rarityBoost` curve in
 * RitualAnthem.sol EXACTLY, so the off-chain card render always matches the
 * verifiable on-chain `rarityBoost(wallet)` value.
 */
export function streakScoreBoost(streak: number): number {
  if (streak >= 30) return 40;
  if (streak >= 14) return 25;
  if (streak >= 7) return 15;
  if (streak >= 3) return 8;
  return 0;
}

/** A streak can lift a card up to RITUALIST, but never auto-grant RADIANT. */
export const STREAK_RARITY_CAP = 94;

export type EffectiveRarity = {
  rarity: Rarity; // tier after applying the streak boost
  baseRarity: Rarity; // tier from the base score alone (no streak)
  baseScore: number;
  boost: number; // raw streak boost (matches on-chain rarityBoost)
  appliedBoost: number; // how much the boost actually moved the score (0 if base already >= cap)
  effectiveScore: number;
  upgraded: boolean; // true when the streak pushed the card into a higher tier
};

/**
 * Effective grade = base power score + daily-streak boost. The cap never
 * reduces a card below its base score (a base RADIANT stays RADIANT).
 */
export function effectiveRarity(baseScore: number, streak: number, _genesis = false): EffectiveRarity {
  const boost = streakScoreBoost(streak);
  const baseRarity = rarityFromScore(baseScore);
  const effectiveScore = Math.max(baseScore, Math.min(baseScore + boost, STREAK_RARITY_CAP));
  const rarity = rarityFromScore(effectiveScore);
  return {
    rarity,
    baseRarity,
    baseScore,
    boost,
    appliedBoost: effectiveScore - baseScore,
    effectiveScore,
    upgraded: RARITY_ORDER.indexOf(rarity) > RARITY_ORDER.indexOf(baseRarity),
  };
}

/** Genesis mint-order system is disabled. */
export function isGenesisToken(tokenId: number): boolean {
  return Number.isFinite(tokenId) && false;
}

/**
 * Ground-truth grade for an already-minted card. TokenId no longer upgrades
 * cards into Genesis; grade resolves from the provided CardSnapshot power score bands.
 */
export function resolvedRarity(tokenId: number, score: number): Rarity {
  return rarityFromScore(score);
}

export function getRarityPreset(rarity: Rarity): RarityPreset {
  return RARITY_PRESETS[rarity];
}

export function presetForScore(score: number, genesis = false): RarityPreset {
  return RARITY_PRESETS[rarityFromScore(score, genesis)];
}

// ----- Archetype system (deterministic from the wallet seed, never random) -----
// NOTE: VOID WALKER, BITTY SIGNAL, NIGHT CIRCUIT removed in v5 — collection cards
// are now sourced from real Discord community members, not named archetypes.
export const ARCHETYPES = [
  "DREAMER",
  "ARCHITECT",
  "ALCHEMIST",
  "EXPLORER",
  "ORACLE",
  "BUILDER",
  "VISIONARY",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export function pickArchetype(seed: number): Archetype {
  return ARCHETYPES[seed % ARCHETYPES.length];
}

// ----- Trait system (max 3, deterministic) -----
export const TRAIT_POOL = [
  "NIGHT VISION",
  "SILENT FOCUS",
  "INTUITION",
  "HIGH CONVICTION",
  "EARLY SIGNAL",
  "CHAOS RESISTANCE",
  "DEEP LIQUIDITY",
  "IRON HANDS",
  "PATTERN SENSE",
  "COLD BLOOD",
] as const;
export type Trait = (typeof TRAIT_POOL)[number];

/** Deterministically pick up to `max` distinct traits (1..max) from the seed. */
export function pickTraits(seed: number, max = 3): Trait[] {
  const out: Trait[] = [];
  const pool: Trait[] = [...TRAIT_POOL];
  const count = Math.min(max, 1 + (seed % max)); // 1..max
  let s = seed >>> 0;
  for (let i = 0; i < count && pool.length > 0; i++) {
    s = (s * 1103515245 + 12345) >>> 0; // LCG step — deterministic, no Math.random
    const idx = s % pool.length;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

// ----- Mint data (deterministic identifiers for the bottom of the card) -----
export function nftSerial(tokenId: number): string {
  return `RITUAL-${String(tokenId).padStart(7, "0")}`;
}

export function mintId(seed: number, year = new Date().getFullYear() % 100): string {
  const n = seed % 10000;
  return `RA-${String(year).padStart(2, "0")}-${String(n).padStart(4, "0")}`;
}

// ── Phase 2: rarity string <-> rank conversion ──────────────────────────────
// Rank enum: 0 = Common, 1 = Rare, 2 = Epic, 3 = Legendary, 4 = Mythic
// Power 0 = invalid/no-snapshot (not a valid stored power)
// Power 1-39 = Common, 40-59 = Rare, 60-74 = Epic, 75-89 = Legendary, 90-100 = Mythic

const RARITY_RANKS: Record<string, number> = {
  INITIATE: 0,
  BITTY: 1,
  RITTY: 2,
  RITUALIST: 3,
  RADIANT: 4,
};

export const RARITY_NAMES: Record<number, Rarity> = {
  0: "INITIATE",
  1: "BITTY",
  2: "RITTY",
  3: "RITUALIST",
  4: "RADIANT",
};

/** Convert rarity string (e.g. "RITUALIST") to rank number (e.g. 3). */
export function rarityToRank(rarity: string): number {
  return RARITY_RANKS[rarity.toUpperCase()] ?? 0;
}

/** Convert rank number (e.g. 3) to rarity string (e.g. "RITUALIST"). */
export function rankToRarity(rank: number): Rarity {
  return RARITY_NAMES[rank] ?? "INITIATE";
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection Pack System v5
// ─────────────────────────────────────────────────────────────────────────────
// Internal pack rarity (from Discord role) ↔ Visual card rarity (renderer).
// Two parallel names: pack logic uses INTERNAL, card rendering uses VISUAL.
// Genesis is admin-configurable; other tiers have fixed supply.

export type InternalRarity =
  | "INITIATE"
  | "BITTY"
  | "RITTY"
  | "RITUALIST"
  | "RADIANT RITUALIST"
  | "GENESIS";

export const INTERNAL_RARITIES: InternalRarity[] = [
  "INITIATE",
  "BITTY",
  "RITTY",
  "RITUALIST",
  "RADIANT RITUALIST",
  "GENESIS",
];

/** Per-tier config: max supply, power range (inclusive), trait count, and visual. */
export interface RarityTierConfig {
  internal: InternalRarity;
  visual: Rarity;
  maxSupply: number | "custom"; // GENESIS is admin-configurable
  powerMin: number;
  powerMax: number;
  traits: number;
}

// InternalRarity enum (matches contract InternalRarity in PackManagerV8.sol):
//   0 INITIATE            → visual INITIATE
//   1 BITTY               → visual BITTY
//   2 RITTY               → visual RITTY
//   3 RITUALIST           → visual RITUALIST
//   4 RADIANT RITUALIST   → visual RADIANT
//   5 GENESIS             → visual GENESIS (admin-only, not seeded)
export const RARITY_TIER_CONFIG: Record<InternalRarity, RarityTierConfig> = {
  INITIATE:            { internal: "INITIATE",            visual: "INITIATE",    maxSupply: 50,  powerMin: 1,  powerMax: 20,  traits: 1 },
  BITTY:               { internal: "BITTY",               visual: "BITTY",      maxSupply: 25,  powerMin: 21, powerMax: 40,  traits: 2 },
  RITTY:               { internal: "RITTY",               visual: "RITTY",      maxSupply: 10,  powerMin: 41, powerMax: 60,  traits: 3 },
  RITUALIST:           { internal: "RITUALIST",           visual: "RITUALIST", maxSupply: 5,   powerMin: 61, powerMax: 80,  traits: 4 },
  "RADIANT RITUALIST": { internal: "RADIANT RITUALIST",   visual: "RADIANT",    maxSupply: 1,   powerMin: 81, powerMax: 95,  traits: 5 },
  GENESIS:             { internal: "GENESIS",             visual: "GENESIS",   maxSupply: "custom", powerMin: 96, powerMax: 100, traits: 6 },
};

/** Discord role string (case-insensitive) → internal rarity. */
const ROLE_TO_INTERNAL: Record<string, InternalRarity> = {
  initiate: "INITIATE",
  bitty: "BITTY",
  ritty: "RITTY",
  ritualist: "RITUALIST",
  "radiant ritualist": "RADIANT RITUALIST",
  radiantritualist: "RADIANT RITUALIST",
  genesis: "GENESIS",
  custom: "GENESIS",
};

export function roleToInternalRarity(role: string | null | undefined): InternalRarity | null {
  if (!role) return null;
  return ROLE_TO_INTERNAL[role.trim().toLowerCase()] ?? null;
}

export function internalToVisualRarity(internal: InternalRarity): Rarity {
  return RARITY_TIER_CONFIG[internal].visual;
}

/** Numeric rank for sorting internal rarities (INITIATE=0 … GENESIS=5). */
export const INTERNAL_RANK: Record<InternalRarity, number> = {
  INITIATE: 0,
  BITTY: 1,
  RITTY: 2,
  RITUALIST: 3,
  "RADIANT RITUALIST": 4,
  GENESIS: 5,
};

/** Visual rarity name → internal rarity. Used when reading on-chain data. */
// Aligns with PackManagerV8.sol enum + RARITY_TIER_CONFIG (forward) above:
//   INITIATE    → INITIATE             (rarity 0)
//   BITTY      → BITTY                (rarity 1)
//   RITTY      → RITTY                (rarity 2)
//   RITUALIST → RITUALIST            (rarity 3)
//   RADIANT    → RADIANT RITUALIST    (rarity 4)
//   GENESIS   → GENESIS              (rarity 5, admin-only)
const VISUAL_TO_INTERNAL: Record<Rarity, InternalRarity> = {
  INITIATE:    "INITIATE",
  BITTY:      "BITTY",
  RITTY:      "RITTY",
  RITUALIST: "RITUALIST",
  RADIANT:    "RADIANT RITUALIST",
  GENESIS:   "GENESIS",
};

export function visualToInternalRarity(visual: Rarity): InternalRarity {
  return VISUAL_TO_INTERNAL[visual];
}

/**
 * Everything the renderer needs for a card's rarity layer, derived from the
 * same deterministic seed used by generateAnthem(). Pure data — no rendering,
 * no randomness.
 */
export function rarityProfile(seed: number, score: number, genesis = false) {
  const rarity = rarityFromScore(score, genesis);
  return {
    rarity,
    preset: RARITY_PRESETS[rarity],
    badge: RARITY_BADGE[rarity],
    archetype: pickArchetype(seed),
    traits: pickTraits(seed, 3),
    mintId: mintId(seed),
  };
}
