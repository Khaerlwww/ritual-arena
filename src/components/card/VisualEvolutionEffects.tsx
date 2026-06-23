import { Crown } from "lucide-react";
import {
  getVisualEvolutionUnlocks,
  type VisualEvolutionUnlocks,
} from "../../lib/visualEvolution";

export interface VisualEvolutionEffectsProps {
  /** Source of truth — card training level. Missing/0 = no effects. */
  trainingLevel?: number | null;
  /** Renders a smaller, less noisy variant for compact card previews. */
  compact?: boolean;
  /** Renders effects that pair with static SVG metadata images. */
  metadataMode?: boolean;
  /** Extra classes added to the wrapper. */
  className?: string;
}

/**
 * Wraps an Identity Card render and applies the visual evolution effects
 * that correspond to the card's trainingLevel. Pure CSS, respects
 * prefers-reduced-motion, no heavy animation libraries.
 */
export function VisualEvolutionEffects({
  trainingLevel,
  compact = false,
  metadataMode = false,
  className = "",
  children,
}: VisualEvolutionEffectsProps & { children: React.ReactNode }) {
  const unlocks = getVisualEvolutionUnlocks(trainingLevel);

  if (!hasAnyUnlock(unlocks)) {
    return <div className={`relative ${className}`}>{children}</div>;
  }

  const classes = buildWrapperClasses(unlocks, compact, className);

  return (
    <div className={classes}>
      {unlocks.animatedBackground && !metadataMode ? (
        <div className="ve-animated-bg" aria-hidden />
      ) : null}

      {unlocks.holographicLayer ? (
        <div className="ve-holographic" aria-hidden />
      ) : null}

      <div className="relative z-[1] h-full w-full">{children}</div>

      {unlocks.ritualOgBadge ? (
        <div
          className="ve-og-badge pointer-events-none absolute right-2 top-2 z-[4] flex items-center gap-1 rounded-full border border-[#ffd76a]/40 bg-black/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#ffd76a] backdrop-blur-sm"
          aria-label="Ritual OG"
        >
          <Crown size={9} className="ve-og-shine" aria-hidden />
          <span className="ve-og-shine">OG</span>
        </div>
      ) : null}
    </div>
  );
}

function hasAnyUnlock(u: VisualEvolutionUnlocks) {
  return (
    u.iceFrame ||
    u.animatedBackground ||
    u.holographicLayer ||
    u.rareBorder ||
    u.ritualOgBadge ||
    u.prismAura
  );
}

function buildWrapperClasses(
  u: VisualEvolutionUnlocks,
  compact: boolean,
  extra: string,
) {
  const cls: string[] = ["relative", "isolate", extra];
  if (u.iceFrame) cls.push("ve-ice-frame");
  if (u.rareBorder) cls.push("ve-rare-border");
  if (u.prismAura) cls.push("ve-prism-aura");
  // Compact = slightly reduce aura blur (already handled in metadataMode)
  void compact;
  return cls.filter(Boolean).join(" ");
}

/** Standalone hook for callers that just need the unlock flags. */
export function useVisualEvolutionUnlocks(trainingLevel?: number | null) {
  return getVisualEvolutionUnlocks(trainingLevel);
}
