// src/components/progress/PackWindow.tsx
// Collection Pack System v5 — UI for opening community-card packs.
//
// On-chain flow (V5+):
//   1. User clicks "Open Pack" → usePacks.openInitiatePack()
//   2. useOpenPack drives a phase state machine:
//      checking → approving → opening → confirming → done | error
//   3. The step indicator at the top shows the current phase + tx link
//   4. AP pre-flight is atomic (balance + allowance read in parallel)
//   5. Double-click is blocked at hook level (inFlightRef) AND UI level
//      (disabled prop on all buttons while phase ∈ {checking, approving,
//      opening, confirming})
//   6. Errors re-throw to the hook and surface inline (no silent swallow)

import { useCallback, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePacks, type PackOpenedEvent } from "../../hooks/usePacks";
import { useOwnedPackNFTs } from "../../hooks/useOwnedPackNFTs";
import { phaseStep, type PackPhase } from "../../hooks/useOpenPack";
import { PackCard } from "../pack/PackCard";
import { CollectionCard } from "../pack/CollectionCard";
import { PackOpeningFlow } from "../pack/PackOpeningFlow";
import { RitualMark } from "../Logo";
import type { Address } from "viem";
import type { PackResultCard } from "../../types/packCard";
import type { CollectionPool } from "../../lib/packPool";
import {
  internalToVisualRarity,
  INTERNAL_RARITIES,
  RARITY_TIER_CONFIG,
  type Rarity,
  type InternalRarity,
} from "../../lib/rarity";
import { useAPBalance } from "../../hooks/useAPBalance";

const VISUAL_LABELS = ["INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT", "GENESIS"] as const;
const VISUAL_COLORS_CSS: Record<string, string> = {
  INITIATE: "text-iceaccent/60",
  BITTY: "text-[#7dd3fc]",
  RITTY: "text-aqua",
  RITUALIST: "text-[#ffd76a]",
  RADIANT: "text-[#c9b8ff]",
  GENESIS: "text-[#f472b6]",
};

interface OpeningResult {
  type: "initiate" | "ritualist";
  cards: PackResultCard[];
  soldOut: boolean;
  reason?: string;
}

// ─── Pack Result Display ─────────────────────────────────────────────
function PackResultDisplay({ cards }: { cards: PackResultCard[] }) {
  if (cards.length === 0) {
    return (
      <div className="font-mono text-[10px] text-iceaccent/40 text-center p-4">
        no cards in pack
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <AnimatePresence mode="popLayout">
        {cards.map((card, i) => (
          <motion.div
            key={`${card.cardId}-${card.serialNumber}`}
            initial={{ opacity: 0, y: 24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.12, duration: 0.4, ease: "easeOut" }}
          >
            <CollectionCard card={card} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Pool Overview Panel (display only) ──────────────────────────────
// IMPORTANT: This panel reads the static pool JSON (config snapshot). It
// does NOT read remaining supply from the chain. Card ownership is on
// chain (RitualPackNFT); minted-supply tracking is on chain
// (PackManager). The numbers shown here describe the configured
// max per card type, not the live remaining supply.
function PoolOverview({ pool }: { pool: CollectionPool }) {
  const total = pool.total;
  return (
    <div className="bevel-out bg-wgray p-[2px]">
      <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
        Pool Metadata
      </div>
      <div className="bevel-in bg-coal p-2 font-mono text-[9px] text-iceaccent/60">
        <p>
          <span className="text-aqua">{total}</span> community card types configured
          {pool.invalid > 0 && (
            <span className="text-[#ff8a8a]"> · {pool.invalid} invalid skipped</span>
          )}
        </p>
        <p className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 sm:grid-cols-3">
          {INTERNAL_RARITIES.map((r) => {
            const cfg = RARITY_TIER_CONFIG[r];
            const visual = cfg.visual;
            const color = VISUAL_COLORS_CSS[visual] ?? "text-iceaccent/40";
            const count = pool.counts[r] ?? 0;
            const maxPerCard = cfg.maxSupply === "custom" ? "custom" : cfg.maxSupply;
            return (
              <span key={r}>
                <span className={color}>{r}</span>
                <span className="text-iceaccent/30">
                  : {count} types · max {String(maxPerCard)}/card
                </span>
              </span>
            );
          })}
        </p>
        <p className="mt-1 text-iceaccent/30">
          Pool metadata only. Live supply updates on chain.
        </p>
      </div>
    </div>
  );
}

// ─── Step Indicator (shows phase + tx link) ───────────────────────────
function StepIndicator({
  phase,
  stepLabel,
  txHash,
  error,
  onDismissError,
}: {
  phase: PackPhase;
  stepLabel: string | undefined;
  txHash: `0x${string}` | undefined;
  error: string | undefined;
  onDismissError: () => void;
}) {
  if (phase === "idle" || phase === "done") return null;

  const isError = phase === "error";
  const step = phaseStep(phase);

  return (
    <div
      className={`bevel-in-thin p-1.5 font-mono text-[10px] flex items-center justify-between gap-2 max-h-7 overflow-hidden ${
        isError
          ? "bg-[#1f0a0a] border border-[#ff8a8a]/40 text-[#ff8a8a]"
          : "bg-[#06231d] border border-aqua/40 text-aqua"
      }`}
    >
      <span className="flex items-center gap-2 min-w-0 flex-1">
        {!isError && (
          <span className="inline-block w-2 h-2 rounded-full bg-aqua animate-pulse shrink-0" />
        )}
        {isError ? (
          <span className="truncate" title={error}>⚠ {error}</span>
        ) : (
          <span className="truncate">{stepLabel ?? "Working…"}</span>
        )}
        {txHash && !isError && (
          <a
            href={`https://explorer.ritualfoundation.org/tx/${txHash}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-iceaccent/60 hover:text-aqua underline shrink-0"
          >
            view tx ↗
          </a>
        )}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {!isError && step > 0 && (
          <span className="text-iceaccent/40 text-[9px]">step {step}/4</span>
        )}
        {isError && (
          <button
            onClick={onDismissError}
            aria-label="Dismiss error"
            className="text-[#ff8a8a]/60 hover:text-[#ff8a8a] text-[9px] underline"
          >
            dismiss
          </button>
        )}
      </span>
    </div>
  );
}

// ─── AP Gate (pre-flight check) ───────────────────────────────────────
function APGate({
  apBalance,
  apReady,
  cost,
  packLabel,
}: {
  apBalance: number;
  apReady: boolean;
  cost: number;
  packLabel: string;
}) {
  if (!apReady) {
    return (
      <div className="bevel-in-thin bg-[#1a0f0f] p-2 font-mono text-[10px] text-[#ff8a8a]">
        AP is unavailable right now — packs are disabled.
      </div>
    );
  }
  if (cost === 0) {
    return (
      <div className="bevel-in-thin bg-[#06231d] p-2 font-mono text-[10px] text-aqua">
        {packLabel} is free — just sign the mint tx.
      </div>
    );
  }
  if (apBalance < cost) {
    return (
      <div className="bevel-in-thin bg-[#1f1305] p-2 font-mono text-[10px] text-[#E0C15A]">
        Need {cost} AP to open {packLabel}. Train cards to earn more.
      </div>
    );
  }
  return null;
}

// ─── Adapter: on-chain PackOpenedEvent → display shape (PackResultCard). ────
// The visual components (CollectionCard, PackOpeningAnimation) were
// designed around the PackResultCard shape. We adapt the on-chain
// event + the pool JSON to that shape so the visuals are unchanged.
// The pool JSON is display-only metadata; ownership and AP stay
// on-chain. This adapter never mutates state and never persists.
function buildResultCard(
  ev: PackOpenedEvent,
  pool: CollectionPool | null,
  ownerKey: string,
): PackResultCard {
  const poolCard = pool?.byId?.[Number(ev.cardId)];
  // ev.rarity from on-chain is a uint8 (0..5). The rarity field in this
  // adapter is the InternalRarity enum string. Normalize: numeric → string.
  // (RARITY_TIER_CONFIG is keyed by string, NOT number — `RARITY_TIER_CONFIG[0]`
  // is undefined and would throw "Cannot read properties of undefined
  // (reading 'visual')" inside the reveal overlay render.)
  const rawRarity = ev.rarity;
  const internalRarity: InternalRarity =
    typeof rawRarity === "number" && rawRarity >= 0 && rawRarity <= 5
      ? (["INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT RITUALIST", "GENESIS"][rawRarity] as InternalRarity)
      : (rawRarity as unknown as InternalRarity) || "BITTY";
  const visual = internalToVisualRarity(internalRarity);
  return {
    cardId: Number(ev.cardId),
    userId: poolCard?.userId ?? `chain-${ev.cardId.toString()}`,
    username: poolCard?.username ?? "anonymous",
    avatarUrl: poolCard?.avatarUrl ?? "",
    rarity: internalRarity,
    visualRarity: visual,
    power: ev.power,
    role: ev.role,
    traits: [],
    generation: 1,
    // Serial badge per user spec: "serialNumber/maxSupply", e.g. "1/50".
    // Freshly opened cards now carry real values via post-mint cardData
    // reads in useOpenPack (the chain is the source of truth).
    serial: `${Number(ev.serialNumber)}/${Number(ev.maxSupply)}`,
    serialNumber: Number(ev.serialNumber),
    mintedSerial: Number(ev.serialNumber),
    owner: ownerKey,
    acquiredAt: Math.floor(Date.now() / 1000),
    instanceId: `nft-${ev.tokenId.toString()}`,
  };
}

// ─── Main PackWindow ─────────────────────────────────────────────────
export function PackWindow({
  address,
  onViewCollection,
}: {
  address?: Address;
  /** Called when user clicks "View Collection" in the post-open overlay.
   *  Parent (RitualAnthemApp) should navigate to the gallery and close
   *  the overlay so the user lands on freshly-refreshed card state. */
  onViewCollection?: () => void;
}) {
  const packs = usePacks(address);
  const {
    ready,
    loading,
    error,
    pool,
    total,
    counts,
    initiateCost,
    ritualistCost,
    openInitiatePack,
    openRitualistPack,
    packPhase,
    pendingTxHash,
    pendingStepLabel,
    refetch,
    resetPackError,
  } = packs;

  // AP balance — read separately so the gate can show "need X AP" without
  // tying the gate to the wider loading state.
  const ap = useAPBalance(address);
  const apBalance = ap.state?.balance ?? 0;
  const apReady = ap.state?.source === "onchain";

  // PackCard V2: derived data for preview/stats/shimmer props.
  // 1) TRUE drop probabilities from PackConfig (basis points 0..10000,
  // keyed by InternalRarity 0..4). Source of truth is the contract — supply
  // distribution would be misleading because cards can be depleted.
  const {
    initiateDropBps,
    ritualDropBps,
  } = packs;

  // 2) 3 sample preview cards from the pool, biased toward common rarities
  // so the preview is realistic (you usually pull BITTY/RITTY, not RITUALIST).
  const samplePreviewCards = useMemo(() => {
    if (!pool) return undefined;
    const order = (pool.byRarity as Record<number, Array<{ cardId: number; rarity: number; role?: string }>>);
    const candidates = [
      ...(order[1] ?? []),
      ...(order[2] ?? []),
      ...(order[0] ?? []),
      ...(order[3] ?? []),
    ];
    return candidates.slice(0, 3).map((c) => ({
      cardId: c.cardId,
      rarity: c.rarity,
      role: c.role,
    }));
  }, [pool]);

  // INITIATE pack yields INITIATE/RITTY/BITTY/RITUALIST/RADIANT;
  // RITUAL pack skips INITIATE (yields BITTY/RITTY/RITUALIST/RADIANT + rare GENESIS admin).
  // We pass the same preview set to both — the drop-rate labels already
  // communicate the per-pack rarity window.
  const initiatePreviewCards = samplePreviewCards;
  const ritualPreviewCards = samplePreviewCards;

  // 3) User's owned PackNFTs grouped by rarity.
  const { cards: ownedPackCards } = useOwnedPackNFTs(address);
  const userOwnedByRarity = useMemo(() => {
    if (!ownedPackCards || ownedPackCards.length === 0) return undefined;
    const out: Record<number, number> = {};
    for (const c of ownedPackCards) {
      const r = c.rarity;
      if (typeof r === "number") out[r] = (out[r] ?? 0) + 1;
    }
    return out;
  }, [ownedPackCards]);

  // Split drop BPS into initiate / ritual windows. INITIATE can yield
  // rarities 0..4 (skip GENESIS = 5, admin only). RITUAL skips 0 (INITIATE).
  // usePacks() already returns these split correctly.

  const [openingFlow, setOpeningFlow] = useState<{
    type: "initiate" | "ritual";
    cards: PackResultCard[];
    txHash?: string;
  } | null>(null);
  const [openingPackResult, setOpeningPackResult] = useState<{
    type: "INITIATE" | "RITUALIST";
    cards: PackResultCard[];
    txHash?: string;
  } | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | undefined>();
  const ownerKey = address?.toLowerCase();

  // Re-entry guard at the component level (in addition to the hook-level ref).
  const inFlightRef = useRef(false);

  // The pack buttons + batch button should all disable on the same condition.
  const isTxActive =
    packPhase === "checking" ||
    packPhase === "approving" ||
    packPhase === "opening" ||
    packPhase === "confirming";

  const handleOpen = useCallback(
    async (type: "initiate" | "ritualist") => {
      if (inFlightRef.current) return;
      if (!address) {
        // Caller (PackCard disabled) should prevent this, but guard anyway.
        return;
      }
      inFlightRef.current = true;
      // Clear stale flow state from a prior successful open
      setOpeningFlow(null);
      try {
        const fn = type === "initiate" ? openInitiatePack : openRitualistPack;
        const evs: PackOpenedEvent[] = await fn(); // throws on error now (v7: 3 cards)
        const txHash = evs[0]?.txHash;
        setLastTxHash(txHash);
        // Build cards defensively — if a single adapter throws (e.g. bad
        // rarity), fall back to a minimal placeholder so the overlay still
        // shows all 3 cards instead of silently bailing.
        const cards: PackResultCard[] = evs.map((ev) => {
          try {
            return buildResultCard(ev, pool, ownerKey ?? "guest");
          } catch (e) {
            if (import.meta.env.DEV) console.warn("[PackWindow] buildResultCard failed for token", ev.tokenId?.toString(), e);
            return {
              cardId: Number(ev.cardId),
              userId: `chain-${ev.cardId?.toString() ?? "0"}`,
              username: "anonymous",
              avatarUrl: "",
              rarity: "BITTY" as InternalRarity,
              visualRarity: "BITTY" as Rarity,
              power: ev.power,
              role: ev.role || "—",
              traits: [],
              generation: 1,
              serial: `${Number(ev.serialNumber)}/${Number(ev.maxSupply)}`,
              serialNumber: Number(ev.serialNumber),
              mintedSerial: Number(ev.serialNumber),
              owner: ownerKey ?? "guest",
              acquiredAt: Math.floor(Date.now() / 1000),
              instanceId: `nft-${ev.tokenId?.toString() ?? "0"}`,
            };
          }
        });
        setOpeningPackResult({
          type: type === "initiate" ? "INITIATE" : "RITUALIST",
          cards,
          txHash,
        });
        // Single continuous flow handles cinematic + reveal + buttons in one component.
        setOpeningFlow({ type: type === "ritualist" ? "ritual" : "initiate", cards, txHash });
      } catch (e) {
        if (import.meta.env.DEV) console.error("[PackWindow] open failed:", e);
      } finally {
        inFlightRef.current = false;
      }
    },
    [openInitiatePack, openRitualistPack, pool, ownerKey, address],
  );

  const handleFlowViewCollection = useCallback(() => {
    setOpeningFlow(null);
    setOpeningPackResult(null);
    onViewCollection?.();
  }, [onViewCollection]);

  const handleFlowOpenAnother = useCallback(() => {
    setOpeningFlow(null);
  }, []);

  // Single continuous pack opening flow: pack charges → bursts → cards fly → buttons appear.
  // One component, one timeline, no inter-component transition.
  // CRITICAL: check openingFlow BEFORE the loading gate — otherwise a post-open
  // refetch (nft-changed event fires owned.refetch) flips loading=true and
  // the spinner covers the reveal overlay. The overlay must take priority.
  if (openingFlow && openingFlow.cards.length > 0) {
    return (
      <PackOpeningFlow
        cards={openingFlow.cards}
        packType={openingFlow.type}
        txHash={openingFlow.txHash}
        onViewCollection={handleFlowViewCollection}
        onOpenAnother={handleFlowOpenAnother}
      />
    );
  }

  // Loading state (pool / owned still loading). If the pool failed to load,
  // do not keep the user on the spinner forever — show a retryable error.
  if (loading && !error) {
    return (
      <div className="grid place-items-center p-8 font-mono text-[11px] text-iceaccent/60">
        <RitualMark size={42} spin={false} glow shine />
        <p className="mt-3 text-aqua">loading community pack pool…</p>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="grid gap-3 p-3 font-mono text-[11px] text-iceaccent/70">
        <div className="bevel-in-thin bg-[#140f0f] p-3 text-[#ff8a8a]">
          Collection pack pool is unavailable right now.
          {error ? <span className="block pt-1 text-[10px] text-[#ffb3b3]/75">{error}</span> : null}
        </div>
        <button
          onClick={refetch}
          className="bevel-out-thin w-max bg-wgray px-2 py-1 font-mono text-[10px] text-aqua"
        >
          retry
        </button>
      </div>
    );
  }

  // Pool empty
  if (pool.total === 0) {
    return (
      <div className="grid gap-3 p-2">
        <div className="bevel-in bg-[#0a0a0a] p-3 font-mono text-[10px] text-[#E0C15A]">
          Pool pack pool is empty — community members must be imported before packs can open
        </div>
        {error && (
          <div className="bevel-in-thin bg-[#1a0f0f] p-2 font-mono text-[10px] text-[#ff8a8a]">
            {error}
          </div>
        )}
        <button
          onClick={refetch}
          className="bevel-out-thin bg-wgray px-2 py-1 font-mono text-[10px] text-aqua self-start"
        >
          retry
        </button>
      </div>
    );
  }

  // Default view
  const showInitiateGate = initiateCost > 0;
  const showRitualGate = ritualistCost > 0;

  return (
    <div className="grid gap-3 p-2">
      
      <PoolOverview pool={pool} />

      
      <div className="grid grid-cols-2 gap-2">
        <SummaryCard label="Pool" value={total} />
        <SummaryCard label="Imported" value={INTERNAL_RARITIES.reduce((s, r) => s + (counts[r] ?? 0), 0)} />
      </div>

      
      <StepIndicator
        phase={packPhase}
        stepLabel={pendingStepLabel}
        txHash={pendingTxHash}
        error={error}
        onDismissError={resetPackError}
      />

      
      {(showInitiateGate || showRitualGate) && apReady && (
        <div className="bevel-in-thin bg-[#080808] p-2 font-mono text-[10px] text-iceaccent/60">
          Each pack costs {initiateCost} AP · Opening takes 2 wallet prompts (approval + mint).
        </div>
      )}

      
      <div className="grid gap-3 sm:grid-cols-2">
        <PackCard
          type="initiate"
          cost={initiateCost}
          disabled={
            !ready ||
            !address ||
            isTxActive ||
            (showInitiateGate && (!apReady || apBalance < initiateCost))
          }
          disabledReason={
            !address ? undefined
              : isTxActive ? "Transaction in progress"
              : showInitiateGate && !apReady ? "AP is not ready"
              : showInitiateGate && apBalance < initiateCost
                ? "Insufficient AP"
              : undefined
          }
          onOpen={() => handleOpen("initiate")}
          dropBpsByRarity={initiateDropBps}
          previewCards={initiatePreviewCards}
          poolTotal={pool?.total}
        />
        <PackCard
          type="ritual"
          cost={ritualistCost}
          disabled={
            !ready ||
            !address ||
            isTxActive ||
            (showRitualGate && (!apReady || apBalance < ritualistCost))
          }
          disabledReason={
            !address ? undefined
              : isTxActive ? "Transaction in progress"
              : showRitualGate && !apReady ? "AP is not ready"
              : showRitualGate && apBalance < ritualistCost
                ? "Insufficient AP"
              : undefined
          }
          onOpen={() => handleOpen("ritualist")}
          dropBpsByRarity={ritualDropBps}
          previewCards={ritualPreviewCards}
          poolTotal={pool?.total}
        />
      </div>

      
      {address && (showInitiateGate || showRitualGate) && (
        <div className="grid gap-2">
          {showInitiateGate && (
            <APGate
              apBalance={apBalance}
              apReady={apReady}
              cost={initiateCost}
              packLabel="Initiate Pack"
            />
          )}
          {showRitualGate && (
            <APGate
              apBalance={apBalance}
              apReady={apReady}
              cost={ritualistCost}
              packLabel="Ritual Pack"
            />
          )}
        </div>
      )}

      
      {ready && address && (
        <BatchOpenBar
          disabled={isTxActive}
          onOpen={async (n) => {
            for (let i = 0; i < n; i++) {
              await handleOpen("initiate");
              // Wait for the user to dismiss the flow overlay (or 30s timeout).
              const start = Date.now();
              while (Date.now() - start < 30_000) {
                await new Promise((r) => setTimeout(r, 250));
                if (i >= n - 1) break;
                break;
              }
            }
          }}
        />
      )}

      
      {openingPackResult && openingPackResult.cards.length > 0 && !openingFlow && (
        <div className="bevel-out bg-wgray p-[2px]">
          <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
            Last Result
          </div>
          <div className="bevel-in bg-coal p-3">
            <PackResultDisplay cards={openingPackResult.cards} />
            <p className="mt-2 font-mono text-[9px] text-iceaccent/40">
              minted on-chain as RitualPackNFT — visible in your Collection Gallery
              {lastTxHash && (
                <>
                  {" · "}tx{" "}
                  <a
                    href={`https://explorer.ritualfoundation.org/tx/${lastTxHash}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-aqua hover:underline"
                  >
                    {lastTxHash.slice(0, 6)}…{lastTxHash.slice(-4)} ↗
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="bevel-in-thin bg-[#080808] p-2 text-center">
      <p className="text-[8px] uppercase tracking-[0.15em] text-iceaccent/40">
        {label} {hint && <span className="text-iceaccent/20">({hint})</span>}
      </p>
      <p className="mt-0.5 font-display text-lg font-bold text-aqua">{value}</p>
    </div>
  );
}

function BatchOpenBar({ onOpen, disabled }: { onOpen: (n: number) => Promise<void>; disabled: boolean }) {
  const [n, setN] = useState(1);
  return (
    <div className="bevel-in bg-[#080808] p-2 flex items-center gap-2">
      <span className="font-mono text-[9px] text-iceaccent/40">Batch:</span>
      {[1, 3, 5, 10].map((opt) => (
        <button
          key={opt}
          onClick={() => setN(opt)}
          className={`bevel-in-thin px-1.5 py-0.5 text-[9px] ${
            n === opt ? "bg-[#06231d] text-aqua" : "bg-[#0b0b0b] text-iceaccent/50"
          }`}
        >
          {opt}
        </button>
      ))}
      <button
        onClick={() => void onOpen(n)}
        disabled={disabled}
        className="bevel-in-thin bg-[#06231d] px-2 py-0.5 text-[9px] text-[#1CC744] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Open {n}
      </button>
    </div>
  );
}

function visualRarityToNumber(v: string): number {
  const i = VISUAL_LABELS.indexOf(v as any);
  return i >= 0 ? i : 0;
}
