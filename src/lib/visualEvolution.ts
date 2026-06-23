// Visual Evolution Roadmap — single source of truth.
//
// trainingLevel is the only input. Every render target (live UI, Identity
// Card display, Identity Profile preview, static SVG metadata image) reads
// the unlock flags from this helper so the visual state is consistent
// across the entire product.

export type VisualEvolutionLevel =
  | 2  // Ice Profile Frame
  | 4  // Animated Background
  | 6  // Holographic Layer
  | 8  // Rare Border
  | 12 // Ritual OG Badge
  | 16 // Prism Aura
  ;

export interface VisualEvolutionUnlocks {
  iceFrame: boolean;
  animatedBackground: boolean;
  holographicLayer: boolean;
  rareBorder: boolean;
  ritualOgBadge: boolean;
  prismAura: boolean;
}

const ZERO: VisualEvolutionUnlocks = {
  iceFrame: false,
  animatedBackground: false,
  holographicLayer: false,
  rareBorder: false,
  ritualOgBadge: false,
  prismAura: false,
};

export const EVOLUTION_THRESHOLDS: { level: VisualEvolutionLevel; key: keyof VisualEvolutionUnlocks; name: string }[] = [
  { level: 2,  key: "iceFrame",           name: "Ice Profile Frame" },
  { level: 4,  key: "animatedBackground", name: "Animated Background" },
  { level: 6,  key: "holographicLayer",   name: "Holographic Layer" },
  { level: 8,  key: "rareBorder",         name: "Rare Border" },
  { level: 12, key: "ritualOgBadge",      name: "Ritual OG Badge" },
  { level: 16, key: "prismAura",          name: "Prism Aura" },
];

/**
 * Resolve the visual evolution unlocks for a given training level.
 * Returns all-false if `trainingLevel` is missing, zero, or non-finite.
 */
export function getVisualEvolutionUnlocks(trainingLevel?: number | null): VisualEvolutionUnlocks {
  const lvl = Number(trainingLevel);
  if (!Number.isFinite(lvl) || lvl <= 0) return { ...ZERO };

  const unlocks: VisualEvolutionUnlocks = { ...ZERO };
  for (const t of EVOLUTION_THRESHOLDS) {
    if (lvl >= t.level) unlocks[t.key] = true;
  }
  return unlocks;
}

/** Highest level threshold the card has reached (or 0). */
export function getReachedEvolutionLevel(trainingLevel?: number | null): VisualEvolutionLevel | 0 {
  const lvl = Number(trainingLevel);
  if (!Number.isFinite(lvl) || lvl <= 0) return 0;
  let reached: VisualEvolutionLevel | 0 = 0;
  for (const t of EVOLUTION_THRESHOLDS) {
    if (lvl >= t.level) reached = t.level;
  }
  return reached;
}

/** The next milestone to chase, or null when the card has reached the cap. */
export function getNextEvolutionMilestone(
  trainingLevel?: number | null,
): (typeof EVOLUTION_THRESHOLDS)[number] | null {
  const lvl = Number(trainingLevel);
  if (!Number.isFinite(lvl)) return EVOLUTION_THRESHOLDS[0];
  return EVOLUTION_THRESHOLDS.find((t) => lvl < t.level) ?? null;
}
