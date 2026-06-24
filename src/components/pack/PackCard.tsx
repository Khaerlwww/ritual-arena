// src/components/pack/PackCard.tsx
// Premium collectible pack card — narrow vertical sealed archive pack.
// V2: preview cards fanned behind, personalized stats, shimmer, on-chain drop rates.
//
// Uses real RitualMark from Logo.tsx. Pure white symbol. No placeholder.

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RitualMark } from "../Logo";

/** Minimal preview card shape — what we render as the "card backs" peeking from behind the pack. */
export interface PreviewCard {
  cardId: number;
  rarity: number;       // 0..4 (InternalRarity enum)
  role?: string;        // e.g. "Void Explorer"
  power?: number;       // 1..100
}

interface PackCardProps {
  type: "initiate" | "ritual";
  cost: number;
  disabled?: boolean;
  disabledReason?: string;  // tooltip text when disabled
  onOpen?: () => void;
  /** Real drop probabilities in basis points (0-10000), keyed by InternalRarity. */
  dropBpsByRarity?: Record<number, number>;
  /** 3 preview cards sampled from the live pool (shown behind pack on hover). */
  previewCards?: PreviewCard[];
  /** Total cards in the pool (public supply snapshot). */
  poolTotal?: number;
}

export function PackCard({
  type,
  cost,
  disabled = false,
  disabledReason,
  onOpen,
  dropBpsByRarity,
  previewCards,
  poolTotal,
}: PackCardProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [showDisabledTip, setShowDisabledTip] = useState(false);

  const isRitual = type === "ritual";

  // Format drop BPS → "59%" / fallback to hardcoded fallback (defensive)
  const dropLabels = useMemo(() => {
    const fallback = isRitual
      ? [56, 30, 9, 5]  // BITTY / RITTY / RITUALIST / RADIANT (skip GENESIS — admin only)
      : [59, 25, 12, 3, 1]; // INITIATE / BITTY / RITTY / RITUALIST / RADIANT
    const bps = dropBpsByRarity;
    if (!bps) return fallback.map((p) => `${p}%`);
    const order = isRitual ? [1, 2, 3, 4] : [0, 1, 2, 3, 4]; // skip GENESIS(5) for ritual, INITIATE(0) for ritual
    const names = ["INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT", "GENESIS"];
    return order.map((r) => {
      const b = bps[r];
      if (b === undefined) return fallback.shift() + "%" || "?%";
      const pct = (b / 100).toFixed(b % 100 === 0 ? 0 : 1);
      return `${pct}% ${names[r]}`;
    });
  }, [dropBpsByRarity, isRitual]);

  // Personal stats removed 2026-06-21 per user privacy preference.
  // Public data only: drop rates, pool total, preview cards.

  // AP affordance — show generic tooltip only, no balance values exposed.
  const apReason = disabledReason;

  return (
    <motion.div
      className={`relative cursor-pointer select-none ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      onMouseEnter={() => { setIsHovering(true); if (disabled) setShowDisabledTip(true); }}
      onMouseLeave={() => { setIsHovering(false); setShowDisabledTip(false); }}
      onClick={disabled ? undefined : onOpen}
    >
      
      <AnimatePresence>
        {isHovering && previewCards && previewCards.length > 0 && !disabled && (
          <motion.div
            key="preview-cards"
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 z-0 flex items-end justify-center gap-1"
            style={{ bottom: -10, width: 220 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {previewCards.slice(0, 3).map((c, i) => (
              <PreviewCardBack
                key={`${c.cardId}-${i}`}
                card={c}
                // Fan: left card tilted left, right tilted right
                rotation={(i - 1) * 14}
                offsetX={(i - 1) * 28}
                offsetY={Math.abs(i - 1) * 6}
                delay={i * 0.05}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      
      <div className="bevel-out relative z-10 bg-wgray p-[2px]">
        <div className="bevel-in relative overflow-hidden bg-[#050706] p-4 flex flex-col items-center gap-3">
          <div
            className="absolute inset-0 pointer-events-none opacity-60"
            style={{
              background: isRitual
                ? "radial-gradient(circle at 50% 0%, rgba(255,215,106,0.16), transparent 42%), radial-gradient(circle at 0% 100%, rgba(201,184,255,0.12), transparent 38%)"
                : "radial-gradient(circle at 50% 0%, rgba(72,168,154,0.18), transparent 42%), radial-gradient(circle at 100% 100%, rgba(127,227,210,0.10), transparent 38%)",
            }}
          />

          <div
            className="relative flex flex-col items-center justify-center overflow-hidden rounded-sm border pack-shimmer"
            style={{
              width: isRitual ? 158 : 148,
              height: isRitual ? 244 : 228,
              borderColor: isRitual ? "rgba(255,215,106,0.42)" : "rgba(127,227,210,0.34)",
              background: isRitual
                ? "linear-gradient(160deg, #050505 0%, #151006 35%, #050505 66%, #21130a 100%)"
                : "linear-gradient(160deg, #04110f 0%, #0b2722 36%, #050706 66%, #0b3b35 100%)",
              boxShadow: isHovering
                ? isRitual
                  ? "0 0 34px rgba(255,215,106,0.20), inset 0 0 28px rgba(255,215,106,0.06)"
                  : "0 0 34px rgba(127,227,210,0.16), inset 0 0 28px rgba(127,227,210,0.05)"
                : "0 2px 14px rgba(0,0,0,0.72), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div className="absolute inset-x-0 top-0 h-8 border-b border-white/10 bg-black/30" />
            <div className="absolute inset-x-0 bottom-0 h-9 border-t border-white/10 bg-black/35" />
            <div className="absolute left-0 top-0 h-full w-[10px] bg-white/[0.04]" />
            <div className="absolute right-0 top-0 h-full w-[10px] bg-black/30" />
            <div
              className="absolute inset-0 opacity-[0.10]"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, transparent 0 46%, rgba(255,255,255,0.25) 49%, transparent 52%), repeating-linear-gradient(0deg, transparent, transparent 13px, rgba(255,255,255,0.08) 13px, rgba(255,255,255,0.08) 14px)",
              }}
            />
            <div className="absolute left-1/2 top-[42%] h-[1px] w-[78%] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent" />
            <div className="absolute left-1/2 top-[42%] h-11 w-11 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white/18 bg-black/35" />

            <div className="relative z-10 mt-3 mb-auto text-center">
              <span className={`font-display text-[10px] font-black tracking-[0.28em] ${isRitual ? "text-[#ffd76a]" : "text-aqua"}`}>
                RITUAL ARENA
              </span>
              <p className="mt-1 font-mono text-[7px] uppercase tracking-[0.2em] text-iceaccent/35">sealed booster</p>
            </div>

            <div className="relative z-10 grid place-items-center">
              <div
                className="absolute h-24 w-24 rounded-full blur-xl"
                style={{ background: isRitual ? "rgba(255,215,106,0.14)" : "rgba(127,227,210,0.12)" }}
              />
              <RitualMark
                size={isRitual ? 76 : 64}
                spin={false}
                glow={isHovering}
                shine={isHovering}
              />
            </div>

            <div className="relative z-10 mt-auto mb-3 flex flex-col items-center gap-1 text-center">
              <span className={`font-display text-[18px] font-black ${isRitual ? "text-[#ffd76a]" : "text-aqua"}`}>
                {isRitual ? "RITUAL" : "INITIATE"}
              </span>
              <span className="bevel-out-thin bg-wgray px-2 py-0.5 font-mono text-[9px] font-bold text-coal">
                {cost} AP
              </span>
              <span className="font-mono text-[7px] text-iceaccent/35 tracking-wider">
                RITUAL CHAIN // COLLECTION EDITION
              </span>
            </div>
          </div>

          
          <div className="flex flex-col items-center gap-1 mt-1">
            <h3 className={`font-display text-xs font-bold tracking-wider ${isRitual ? "text-[#ddd]" : "text-[#bbb]"}`}>
              {isRitual ? "RITUAL PACK" : "INITIATE PACK"}
            </h3>
            <p className={`font-mono text-[9px] text-center ${isRitual ? "text-[#9b8cff]/70" : "text-iceaccent/60"}`}>
              {dropLabels.slice(0, 4).join(" · ")}
            </p>
            {dropLabels.length > 4 && (
              <p className="font-mono text-[9px] text-iceaccent/40 text-center">
                {dropLabels.slice(4).join(" · ")}
              </p>
            )}

            

            
            {poolTotal !== undefined && (
              <p className="font-mono text-[9px] text-iceaccent/30 text-center">
                pool: {poolTotal} cards
              </p>
            )}
          </div>

          
          <div className="relative w-full">
            <button
              onClick={(event) => {
                event.stopPropagation();
                if (!disabled) onOpen?.();
              }}
              disabled={disabled}
              className={`win-btn w-full text-[10px] py-1.5 ${isRitual ? "win-btn-emerald" : ""} disabled:opacity-40`}
            >
              {`OPEN ${isRitual ? "RITUAL" : "INITIATE"}`}
            </button>

            
            <AnimatePresence>
              {showDisabledTip && disabled && apReason && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap rounded border border-red-400/40 bg-black/95 px-2 py-1 font-mono text-[9px] text-red-300/90 shadow-lg pointer-events-none z-20"
                >
                  {apReason}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Small card back rendered behind the pack on hover (peeking fan). */
function PreviewCardBack({
  card,
  rotation,
  offsetX,
  offsetY,
  delay,
}: {
  card: PreviewCard;
  rotation: number;
  offsetX: number;
  offsetY: number;
  delay: number;
}) {
  // Rarity color tint per InternalRarity enum (0..4 visible to users)
  const rarityColors: Record<number, { bg: string; border: string; text: string }> = {
    0: { bg: "#1a1a1a", border: "#333", text: "#888" }, // INITIATE — grey
    1: { bg: "#0e1f1a", border: "#1f4d3a", text: "#5fd49e" }, // BITTY — green
    2: { bg: "#1a1530", border: "#3a2e6b", text: "#9d8cf0" }, // RITTY — purple
    3: { bg: "#241608", border: "#5a3a1a", text: "#e89a55" }, // RITUALIST — orange
    4: { bg: "#1f0820", border: "#7a1a8c", text: "#f06ad6" }, // RADIANT — pink
  };
  const colors = rarityColors[card.rarity] ?? rarityColors[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 0, rotate: 0, x: 0 }}
      animate={{
        opacity: 1,
        y: -offsetY - 8,
        rotate: rotation,
        x: offsetX,
      }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className="absolute"
      style={{
        width: 50,
        height: 80,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 3,
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        transformOrigin: "center bottom",
      }}
    >
      <div className="flex flex-col items-center justify-center h-full px-1">
        <div className="font-mono text-[7px] uppercase tracking-wider" style={{ color: colors.text, opacity: 0.7 }}>
          {card.role?.slice(0, 8) ?? `c${card.cardId}`}
        </div>
        {card.power !== undefined && (
          <div className="font-display text-sm font-bold" style={{ color: colors.text }}>
            {card.power}
          </div>
        )}
      </div>
    </motion.div>
  );
}
