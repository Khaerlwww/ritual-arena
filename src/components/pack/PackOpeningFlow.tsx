// src/components/pack/PackOpeningFlow.tsx
//
// Single continuous pack opening experience.
//
// Replaces the previous two-component flow (PackOpeningAnimation cinematic
// + PackResultOverlay) with ONE component that handles the entire sequence:
//   1. Pack charges at center (~1.4s) — glow, pulse, ritual mark
//   2. Pack bursts (~0.4s) — flash, pack scales out
//   3. Cards fly out (~1.2s) — main card grows from center, secondary cards
//      animate from center to their row positions
//   4. Revealed (~0.4s) — stats + action buttons fade in
// Total: ~3.4s. After revealed, the overlay stays until the user explicitly
// chooses View Collection or Open Another Pack.
//
// No inter-component transition. Single timeline, single z-index. Smooth.

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, RotateCw, Sparkles, Zap } from "lucide-react";
import type { PackResultCard } from "../../types/packCard";
import {
  internalToVisualRarity,
  type InternalRarity,
} from "../../lib/rarity";
import { renderAnthemCardDataUrl } from "../../lib/cardImage";
import { packResultToAnthem, PACK_CARD_FALLBACK_GRADIENTS, PACK_CARD_ACCENT_BY_VISUAL } from "../../lib/packCardToAnthem";
import { RitualMark } from "../Logo";

type VisualRarity = "INITIATE" | "BITTY" | "RITTY" | "RITUALIST" | "RADIANT" | "GENESIS";

const VISUAL_COLORS: Record<VisualRarity, { text: string; glow: string; ring: string; hex: string }> = {
  INITIATE:    { text: "text-iceaccent/70", glow: "#9ca3af", ring: "#9ca3af40", hex: "#9ca3af" },
  BITTY:      { text: "text-[#7dd3fc]",    glow: "#7dd3fc", ring: "#7dd3fc40", hex: "#7dd3fc" },
  RITTY:      { text: "text-aqua",         glow: "#22d3ee", ring: "#22d3ee40", hex: "#22d3ee" },
  RITUALIST: { text: "text-[#ffd76a]",    glow: "#fbbf24", ring: "#fbbf2440", hex: "#fbbf24" },
  RADIANT:    { text: "text-[#c9b8ff]",    glow: "#c084fc", ring: "#c084fc40", hex: "#c084fc" },
  GENESIS:   { text: "text-[#f472b6]",    glow: "#f472b6", ring: "#f472b640", hex: "#f472b6" },
};

const VISUAL_RANK: Record<VisualRarity, number> = {
  INITIATE: 0, BITTY: 1, RITTY: 2, RITUALIST: 3, RADIANT: 4, GENESIS: 5,
};

type Phase = "charging" | "burst" | "fly" | "revealed";

interface PackOpeningFlowProps {
  cards: PackResultCard[];
  packType: "initiate" | "ritual";
  txHash?: string;
  /** Called when user clicks "View Collection" — parent navigates + closes. */
  onViewCollection: () => void;
  /** Called when user clicks "Open Another Pack" — parent just closes. */
  onOpenAnother: () => void;
}

function rarityRank(c: PackResultCard): number {
  const visual = internalToVisualRarity(c.rarity as InternalRarity);
  return VISUAL_RANK[visual] ?? 0;
}

/**
 * Pack body (visible during charging + burst). The seal that breaks open.
 */
function PackBody({
  packType,
  mainCard,
  phase,
}: {
  packType: "initiate" | "ritual";
  mainCard: PackResultCard;
  phase: Phase;
}) {
  const reduceMotion = useReducedMotion();
  const visual = internalToVisualRarity(mainCard.rarity as InternalRarity) as VisualRarity;
  const palette = VISUAL_COLORS[visual] ?? VISUAL_COLORS.INITIATE;
  const isRitual = packType === "ritual";

  return (
    <motion.div
      className="relative"
      initial={{ scale: 0.7, opacity: 0 }}
      animate={
        phase === "burst"
          ? { scale: 1.6, opacity: 0, transition: { duration: 0.4, ease: "easeOut" } }
          : { scale: phase === "charging" ? 1 : 1.05, opacity: 1 }
      }
      exit={{ opacity: 0 }}
      transition={
        phase === "charging"
          ? { duration: 0.6, ease: "easeOut" }
          : { duration: 0.3 }
      }
    >
      
      <motion.div
        className="absolute inset-0 -m-16 rounded-sm pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${palette.glow}50 0%, transparent 70%)`,
        }}
        animate={
          reduceMotion || phase !== "charging"
            ? {}
            : { scale: [1, 1.3, 1], opacity: [0.4, 0.9, 0.4] }
        }
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      />

      
      <motion.div
        className="relative grid h-64 w-48 place-items-center overflow-hidden rounded-sm border"
        style={{
          background: isRitual
            ? "linear-gradient(160deg, #050505 0%, #1b1207 42%, #050505 72%, #2a1609 100%)"
            : "linear-gradient(160deg, #03110f 0%, #0b2d28 42%, #050706 72%, #0b3b35 100%)",
          borderColor: isRitual ? "rgba(255,215,106,0.55)" : "rgba(127,227,210,0.45)",
          boxShadow:
            phase === "charging"
              ? `0 0 90px ${palette.glow}70, 0 0 170px ${palette.glow}28, inset 0 0 42px rgba(255,255,255,0.06)`
              : "0 4px 30px rgba(0,0,0,0.6)",
        }}
        animate={
          reduceMotion || phase !== "charging"
            ? {}
            : { rotateY: [0, 3, -3, 0], scale: [1, 1.04, 1] }
        }
        transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="absolute inset-x-0 top-0 z-10 border-b border-white/10 bg-black/35 px-3 py-2 text-center">
          <p className="font-display text-[10px] font-black uppercase tracking-[0.32em] text-ice">RITUAL ARENA</p>
          <p className="mt-0.5 font-mono text-[7px] uppercase tracking-[0.22em] text-iceaccent/45">seal integrity active</p>
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-black/40 px-3 py-2 text-center">
          <p className="font-display text-[13px] font-black uppercase tracking-[0.22em]" style={{ color: palette.glow }}>
            {isRitual ? "RITUAL PACK" : "INITIATE PACK"}
          </p>
          <p className="mt-0.5 font-mono text-[7px] uppercase tracking-[0.18em] text-iceaccent/45">unsealing on Ritual Chain</p>
        </div>
        <div className="absolute inset-0 opacity-[0.11]" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 12px, rgba(255,255,255,0.10) 12px, rgba(255,255,255,0.10) 13px)" }} />
        <div className="absolute left-1/2 top-1/2 z-[1] h-[1px] w-[82%] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
        <motion.div
          className="absolute left-1/2 top-1/2 z-[2] grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 rotate-45 place-items-center border bg-black/45"
          style={{ borderColor: palette.glow }}
          animate={phase === "burst" ? { scale: [1, 1.35, 0.2], opacity: [1, 1, 0], rotate: [45, 45, 70] } : { scale: 1, opacity: 1 }}
          transition={{ duration: 0.38, ease: "easeOut" }}
        >
          <span className="-rotate-45 font-display text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: palette.glow }}>Seal</span>
        </motion.div>
        {phase === "burst" && (
          <div className="absolute left-1/2 top-1/2 z-[3] h-[90px] w-[2px] -translate-x-1/2 -translate-y-1/2 rotate-[22deg] bg-white shadow-[0_0_18px_white]" />
        )}
                {phase === "charging" && (
          <>
            <motion.div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
              style={{
                width: 140,
                height: 140,
                borderColor: palette.glow,
                opacity: 0.4,
              }}
              animate={reduceMotion ? {} : { scale: [1, 1.5, 1], opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
              style={{
                width: 180,
                height: 180,
                borderColor: palette.glow,
                opacity: 0.2,
              }}
              animate={reduceMotion ? {} : { scale: [1, 1.3, 1], opacity: [0.2, 0.5, 0.2] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
            />
          </>
        )}

        
        <RitualMark
          size={isRitual ? 80 : 64}
          spin={phase === "charging"}
          glow={phase === "charging"}
          shine={phase === "charging"}
        />

        
        {phase === "charging" &&
          Array.from({ length: 6 }).map((_, i) => {
            const angle = (360 / 6) * i;
            const len = 24 + (i * 7) % 20;
            return (
              <motion.div
                key={i}
                className="absolute w-px bg-white/60"
                style={{
                  height: len,
                  left: "50%",
                  top: "50%",
                  transformOrigin: "top center",
                  transform: `translateX(-50%) rotate(${angle}deg) translateY(-${len}px)`,
                }}
                animate={reduceMotion ? {} : { opacity: [0, 0.9, 0] }}
                transition={{
                  duration: 0.25 + (i * 0.07) % 0.15,
                  repeat: Infinity,
                  delay: i * 0.08,
                }}
              />
            );
          })}

        
        <div className="absolute bottom-3 left-0 right-0 text-center">
          <span
            className={`font-display text-[10px] font-bold tracking-[0.3em] uppercase ${palette.text}`}
            style={{ textShadow: `0 0 10px ${palette.glow}` }}
          >
            {visual}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Card face — used for main card (large) and secondary cards (smaller).
 */
/**
 * CardFace — renders a pack-result card via the SAME canvas template used by
 * CollectionCard.tsx (the gallery). The pack-open reveal and the collection
 * gallery now share a single visual identity — what you see flying out of
 * the pack is exactly what you'll see in your collection afterwards.
 *
 * Canvas → dataURL → <img> (with a fallback gradient placeholder until the
 * canvas finishes drawing). No raw HTML/CSS card chrome — that's the whole
 * point of using the existing template.
 */
function CardFace({
  card,
  size,
  showStats,
}: {
  card: PackResultCard;
  size: "main" | "secondary";
  showStats: boolean;
}) {
  const visual = internalToVisualRarity(card.rarity as InternalRarity) as VisualRarity;
  const palette = PACK_CARD_ACCENT_BY_VISUAL[visual] ?? PACK_CARD_ACCENT_BY_VISUAL.BITTY;
  const grad = PACK_CARD_FALLBACK_GRADIENTS[visual] ?? PACK_CARD_FALLBACK_GRADIENTS.BITTY;
  const isMain = size === "main";
  const rank = VISUAL_RANK[visual];

  const [url, setUrl] = useState<string>();
  const [errored, setErrored] = useState(false);
  const renderIdRef = useRef(0);

  // Render via canvas template. Re-runs only if the underlying card data
  // changes (different cardId / rarity / power / etc.).
  const anthem = useMemo(() => packResultToAnthem(card), [card]);
  useEffect(() => {
    const myId = ++renderIdRef.current;
    let cancelled = false;
    setErrored(false);
    renderAnthemCardDataUrl(anthem, { tokenId: card.cardId })
      .then((u) => { if (!cancelled && myId === renderIdRef.current) setUrl(u); })
      .catch(() => { if (!cancelled && myId === renderIdRef.current) setErrored(true); });
    return () => { cancelled = true; };
  }, [anthem, card.cardId]);

  // The canvas template renders a 1:1 (1000x1000) image — wrapper must match
  // that ratio or object-cover crops the top/bottom of the artwork. Using
  // aspect-square + object-contain keeps the whole canvas visible and crisp.
  const containerCls = isMain
    ? "w-[280px] sm:w-[340px] md:w-[380px]"
    : "w-[170px] sm:w-[200px]";
  const aspectCls = "aspect-square";

  return (
    <motion.div
      className={`relative ${containerCls} ${aspectCls}`}
      whileHover={{ y: -3 }}
    >
      
      {rank >= 3 && (
        <div
          className="pointer-events-none absolute -inset-3 rounded-md blur-2xl"
          style={{ background: `radial-gradient(circle, ${palette}66 0%, transparent 70%)` }}
        />
      )}
      <div
        className="relative h-full w-full overflow-hidden rounded-md border shadow-[0_8px_30px_rgba(0,0,0,0.6)]"
        style={{
          borderColor: `${palette}66`,
          background: errored
            ? `linear-gradient(135deg, ${grad[0]}, ${grad[1]} 60%, ${grad[2]})`
            : "#071512",
        }}
      >
        {url ? (
          // Canvas-rendered card — same template as the gallery.
          // object-contain preserves the 1:1 canvas geometry without cropping
          // the artwork; browser handles 2x DPI for crisp text/foil.
          <img
            src={url}
            alt={card.username ? `@${card.username}` : `card #${card.cardId}`}
            className="block h-full w-full object-contain select-none"
            draggable={false}
          />
        ) : (
          // Fallback gradient while canvas renders (or if canvas fails).
          <div
            className="grid h-full w-full place-items-center p-3 text-center font-display font-bold text-white/85"
            style={{
              background: `linear-gradient(135deg, ${grad[0]}, ${grad[1]} 60%, ${grad[2]})`,
              textShadow: `0 0 12px ${palette}`,
            }}
          >
            <div className="space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">{visual}</div>
              <div className="font-display text-3xl">
                {card.username ? `@${card.username}` : `Card #${card.cardId}`}
              </div>
              <div className="font-mono text-[10px] opacity-80">PWR {card.power}</div>
            </div>
          </div>
        )}
      </div>
      
      {showStats && (
        <div className="mt-2 flex items-center justify-between px-1 font-mono text-[10px]">
          <span className="font-bold uppercase tracking-[0.18em]" style={{ color: palette }}>
            {visual}
          </span>
          <span className="text-iceaccent/70">
            #{card.cardId} · S{card.serial || `${card.serialNumber}/${card.serialNumber}`}
          </span>
        </div>
      )}
    </motion.div>
  );
}

export function PackOpeningFlow({
  cards,
  packType,
  txHash,
  onViewCollection,
  onOpenAnother,
}: PackOpeningFlowProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("charging");

  // Sort: highest rarity first.
  const sorted = useMemo(
    () =>
      [...cards].sort((a, b) => {
        const dr = rarityRank(b) - rarityRank(a);
        if (dr !== 0) return dr;
        return a.cardId - b.cardId;
      }),
    [cards],
  );
  const main = sorted[0];
  const secondary = sorted.slice(1);
  const mainVisual = main
    ? (internalToVisualRarity(main.rarity as InternalRarity) as VisualRarity)
    : "INITIATE";
  const mainPalette = VISUAL_COLORS[mainVisual] ?? VISUAL_COLORS.INITIATE;

  // Phase timing — keep tight so the flow feels snappy.
  useEffect(() => {
    if (reduceMotion) {
      // Compressed timeline for reduced motion: charging 0.3s → fly → revealed.
      const t1 = setTimeout(() => setPhase("burst"), 300);
      const t2 = setTimeout(() => setPhase("fly"), 600);
      const t3 = setTimeout(() => setPhase("revealed"), 1600);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
    const t1 = setTimeout(() => setPhase("burst"), 1400);
    const t2 = setTimeout(() => setPhase("fly"), 1800);
    const t3 = setTimeout(() => setPhase("revealed"), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [reduceMotion]);

  // Lock body scroll while overlay is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc closes (= "open another").
  useEffect(() => {
    if (phase !== "revealed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenAnother();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onOpenAnother]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pack opening result"
      className="fixed inset-0 z-[110] flex flex-col items-center justify-center overflow-y-auto bg-black/85 backdrop-blur-sm select-none"
      data-testid="pack-result-overlay"
    >
      
      <motion.div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at center, ${mainPalette.glow}25 0%, rgba(0,0,0,0.85) 70%)`,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.5 } }}
      />

      
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.08) 1px, rgba(255,255,255,0.08) 2px)",
        }}
        animate={{ opacity: [0.03, 0.06, 0.03] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{
          opacity: phase === "revealed" ? 1 : phase === "fly" ? 0.4 : 0,
          y: 0,
        }}
        transition={{ duration: 0.5 }}
        className="relative z-10 mb-4 flex flex-col items-center gap-1"
      >
        <span
          className="bevel-out-thin px-3 py-1 font-display text-[11px] font-black uppercase tracking-[0.28em]"
          style={{ color: mainPalette.glow, textShadow: `0 0 12px ${mainPalette.glow}80` }}
        >
          {mainVisual}
        </span>
        <p className="font-display text-3xl font-black uppercase tracking-[0.18em] text-ice">
          PACK OPENED
        </p>
        <p className="font-mono text-[11px] text-iceaccent/65">
          {cards.length} card{cards.length === 1 ? "" : "s"} received
        </p>
        {txHash && phase === "revealed" && (
          <a
            href={`https://explorer.ritualfoundation.org/tx/${txHash}`}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[9px] text-iceaccent/50 hover:text-aqua"
          >
            tx {txHash.slice(0, 6)}…{txHash.slice(-4)} ↗
          </a>
        )}
      </motion.div>

      
      <AnimatePresence>
        {(phase === "charging" || phase === "burst") && main && (
          <motion.div
            key="pack-body"
            className="relative z-10"
            exit={{ opacity: 0 }}
          >
            <PackBody packType={packType} mainCard={main} phase={phase} />
          </motion.div>
        )}
      </AnimatePresence>

      
      <AnimatePresence>
        {phase === "burst" && (
          <motion.div
            key="burst-flash"
            className="absolute inset-0 z-20 bg-white pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.95, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      
      <AnimatePresence>
        {(phase === "fly" || phase === "revealed") && main && (
          <motion.div
            key="cards"
            className="relative z-10 flex flex-col items-center gap-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
          >
            
            <motion.div
              initial={{ scale: 0.3, opacity: 0, y: 0 }}
              animate={
                phase === "fly"
                  ? { scale: 1, opacity: 1, y: -20, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } }
                  : { scale: 1, opacity: 1, y: 0 }
              }
            >
              <CardFace card={main} size="main" showStats={phase === "revealed"} />
            </motion.div>

            <div className="bevel-in-thin bg-[#061512]/90 px-3 py-2 text-center font-mono text-[10px] text-iceaccent/65">
              <span className="font-bold uppercase tracking-[0.18em]" style={{ color: mainPalette.glow }}>
                Main pull · {mainVisual} · Power {main.power}
              </span>
            </div>

            {secondary.length > 0 && (
              <motion.div
                className="flex flex-wrap justify-center gap-3"
                style={{ maxWidth: "min(820px, 92vw)" }}
              >
                {secondary.map((c, i) => (
                  <motion.div
                    key={c.instanceId}
                    initial={{ scale: 0.2, opacity: 0, x: 0, y: 0 }}
                    animate={
                      phase === "fly"
                        ? {
                            scale: 1,
                            opacity: 1,
                            x: 0,
                            y: 0,
                            transition: {
                              duration: 0.7,
                              delay: 0.1 + i * 0.12,
                              ease: [0.16, 1, 0.3, 1],
                            },
                          }
                        : { scale: 1, opacity: 1 }
                    }
                  >
                    <CardFace card={c} size="secondary" showStats={phase === "revealed"} />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      
      <AnimatePresence>
        {phase === "revealed" && (
          <motion.div
            key="actions"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.4, delay: 0.3 } }}
            exit={{ opacity: 0 }}
            className="relative z-10 mt-6 flex flex-wrap items-center justify-center gap-3"
          >
            <motion.button
              onClick={onViewCollection}
              className="win-btn win-btn-emerald flex items-center gap-2 px-5 py-2 font-display text-[12px] font-black uppercase tracking-[0.16em]"
              data-testid="pack-result-view-collection"
            >
              <LayoutGrid size={14} />
              View Collection
            </motion.button>
            <motion.button
              onClick={onOpenAnother}
              className="win-btn flex items-center gap-2 px-5 py-2 font-display text-[12px] font-black uppercase tracking-[0.16em]"
              data-testid="pack-result-open-another"
            >
              <RotateCw size={14} />
              Open Another
            </motion.button>
            <span className="font-mono text-[9px] text-iceaccent/40">
              (Esc to dismiss)
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      
      <AnimatePresence>
        {phase === "fly" && (
          <motion.div
            key="sparkles"
            className="absolute inset-0 pointer-events-none z-10"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0, transition: { duration: 0.8, delay: 0.6 } }}
            exit={{ opacity: 0 }}
          >
            {Array.from({ length: 16 }).map((_, i) => {
              const angle = (360 / 16) * i;
              const distance = 200 + (i % 4) * 30;
              return (
                <motion.div
                  key={i}
                  className="absolute left-1/2 top-1/2"
                  style={{ width: 4, height: 4 }}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{
                    x: Math.cos((angle * Math.PI) / 180) * distance,
                    y: Math.sin((angle * Math.PI) / 180) * distance,
                    opacity: 0,
                    scale: 0.3,
                  }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                >
                  <div
                    className="w-full h-full rounded-full"
                    style={{
                      background: mainPalette.glow,
                      boxShadow: `0 0 8px ${mainPalette.glow}`,
                    }}
                  />
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
