// src/components/pack/PackCard.tsx
// Premium collectible pack card — narrow vertical sealed archive pack.
// V2: preview cards fanned behind, personalized stats, shimmer, on-chain drop rates.
//
// Uses real RitualMark from Logo.tsx. Pure white symbol. No placeholder.

import { useState, useRef, useMemo, type MouseEvent } from "react";
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
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [showDisabledTip, setShowDisabledTip] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const isRitual = type === "ritual";

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (disabled || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    // Tone down tilt from 8° → 4° for less dramatic motion
    setTilt({ x: y * 4, y: -x * 4 });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
    setIsHovering(false);
  };

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
      ref={cardRef}
      className={`relative cursor-pointer select-none ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      style={{ perspective: 800, transformStyle: "preserve-3d" }}
      animate={{ rotateX: tilt.x, rotateY: tilt.y, scale: isHovering ? 1.03 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => { setIsHovering(true); if (disabled) setShowDisabledTip(true); }}
      onMouseLeave={() => { handleMouseLeave(); setShowDisabledTip(false); }}
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

      
      <div className="bevel-out bg-wgray p-[2px] relative z-10">
        <div className="bevel-in bg-[#0a0a0a] p-4 flex flex-col items-center gap-3">

          
          <div
            className="relative flex flex-col items-center justify-center overflow-hidden rounded-sm border pack-shimmer"
            style={{
              width: isRitual ? 150 : 140,
              height: isRitual ? 235 : 220,
              borderColor: isRitual ? "#3a3a3a" : "#2a2a2a",
              background: isRitual
                ? "linear-gradient(180deg, #141414 0%, #0a0a0a 50%, #141414 100%)"
                : "linear-gradient(180deg, #111 0%, #080808 50%, #111 100%)",
              boxShadow: isHovering
                ? `0 0 30px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)`
                : `0 2px 12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.02)`,
            }}
          >
            
            <div className={`absolute inset-0 rounded-sm border ${isRitual ? "border-[#444]" : "border-[#333]"}`} />

            
            <div
              className="absolute inset-0 opacity-20"
              style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 40%, rgba(255,255,255,0.02) 100%)",
              }}
            />

            
            {isRitual && (
              <div className="absolute inset-0 opacity-[0.03]">
                <div
                  className="w-full h-full"
                  style={{
                    backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.04) 8px, rgba(255,255,255,0.04) 9px)`,
                  }}
                />
              </div>
            )}

            
            <div className="relative z-10 mt-3 mb-auto">
              <span className={`font-display text-[10px] font-bold tracking-[0.2em] ${isRitual ? "text-[#888]" : "text-[#666]"}`}>
                {isRitual ? "RITUAL" : "INITIATE"}
              </span>
            </div>

            
            <div className="relative z-10 flex items-center justify-center">
              <RitualMark
                size={isRitual ? 64 : 52}
                spin={false}
                glow={isHovering}
                shine={false}
              />
              
              {isHovering && (
                <motion.div
                  className="absolute rounded-full"
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 0.08, scale: 1.8 }}
                  transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse" }}
                  style={{ width: isRitual ? 80 : 64, height: isRitual ? 80 : 64, background: "radial-gradient(circle, white 0%, transparent 70%)" }}
                />
              )}
            </div>

            
            <div className="relative z-10 mt-auto mb-3 flex flex-col items-center gap-1">
              <span className={`font-display text-sm font-bold ${isRitual ? "text-[#ccc]" : "text-[#aaa]"}`}>
                {cost} AP
              </span>
              <span className="font-mono text-[7px] text-iceaccent/30 tracking-wider">
                COLLECTION EDITION
              </span>
            </div>

            
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#333] to-transparent" />
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
              onClick={disabled ? undefined : onOpen}
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
