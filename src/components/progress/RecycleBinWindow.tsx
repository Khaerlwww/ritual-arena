// src/components/progress/RecycleBinWindow.tsx
//
// "Recycle Bin" — NFT deflation sink UI. Lists the user's owned
// RitualPackNFTs with per-card burn rate, multi-select for batch burn,
// and a status HUD line mirroring the cinematic pack open experience.
//
// Flow:
//   1. Component mounts, fetches owned cards + burn rates
//   2. User checks the cards they want to recycle
//   3. (one-time) User clicks "Approve Burner" → setApprovalForAll
//   4. User clicks "Recycle Selected" → batch recycle selected cards
//   5. AP lands in wallet, NFTs gone — UI updates via event bus
//
// A "Burn History" panel sits at the very top of the window, sourced from
// the on-chain CardBurnFinished events for this wallet (backfilled from
// localStorage for instant render). Each entry links to the tx on the
// explorer so the user can verify the burn happened.
//
// No sound effects per user spec. Visual feedback only.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Recycle, Trash2, Coins, AlertTriangle, ExternalLink, CheckCircle2, Loader2, Flame, Clock } from "lucide-react";
import type { Address } from "viem";
import { useOwnedPackNFTs, type OwnedPackCard } from "../../hooks/useOwnedPackNFTs";
import { useCardBurner } from "../../hooks/useCardBurner";
import { useBurnHistory } from "../../hooks/useBurnHistory";
import { internalToVisualRarity, rankToRarity, type InternalRarity } from "../../lib/rarity";
import { formatAp } from "../../lib/apFormat";
import { hasCardBurner, cardBurnerAddress, packNftAddress, explorerTxUrl } from "../../lib/chains";
import { publicClient } from "../../hooks/useAnthem";
import { loadCollectionPool, type CollectionPool } from "../../lib/packPool";
import { CollectionCard } from "../pack/CollectionCard";
import type { PackResultCard } from "../../types/packCard";

/** Human-readable relative time for the burn history list. */
function relativeTime(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / (86400 * 30))}mo ago`;
}

interface RecycleBinWindowProps {
  address?: Address;
}

// V9 InternalRarity names (single source of truth for display labels)
const VISUAL_LABELS: Record<number, string> = {
  0: "INITIATE",
  1: "BITTY",
  2: "RITTY",
  3: "RITUALIST",
  4: "RADIANT",
  5: "GENESIS", // non-burnable
};

const VISUAL_LABELS_LONG: Record<number, string> = {
  0: "Initiate",
  1: "Bitty",
  2: "Ritty",
  3: "Ritualist",
  4: "Radiant Ritualist",
  5: "Genesis",
};

const RARITY_COLORS: Record<number, string> = {
  0: "text-iceaccent/60",
  1: "text-[#7dd3fc]",
  2: "text-aqua",
  3: "text-[#ffd76a]",
  4: "text-[#c9b8ff]",
  5: "text-[#f472b6]",
};

const RARITY_FILTERS = ["ALL", "INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT RITUALIST", "GENESIS"] as const;
type RarityFilter = typeof RARITY_FILTERS[number];
type RaritySort = "low-high" | "high-low";

function rarityIndex(rarity: PackResultCard["rarity"] | RarityFilter): number {
  switch (rarity) {
    case "INITIATE": return 0;
    case "BITTY": return 1;
    case "RITTY": return 2;
    case "RITUALIST": return 3;
    case "RADIANT RITUALIST": return 4;
    case "GENESIS": return 5;
    default: return -1;
  }
}

function ownedCardToDisplayCard(
  c: OwnedPackCard,
  pool: CollectionPool,
  ownerKey: string,
): PackResultCard {
  // c.rarity is a number (0-5) read from the chain. Convert to the visual
  // rarity string ("INITIATE" | "BITTY" | "RITTY" | "RITUALIST" | "RADIANT"
  // | "GENESIS") before passing to internalToVisualRarity, which looks up
  // RARITY_TIER_CONFIG by string key.
  const visualRarity = rankToRarity(c.rarity);
  const internal: InternalRarity =
    c.rarity === 4 ? "RADIANT RITUALIST" : (visualRarity as InternalRarity);
  const visual = internalToVisualRarity(internal);
  const poolCard = pool.byId?.[Number(c.cardId)];
  // We don't have serial/maxSupply here for owned cards (would need a
  // multicall read of cardData); use safe defaults for the preview only.
  return {
    cardId: Number(c.cardId),
    userId: poolCard?.userId ?? "",
    username: poolCard?.username ?? "",
    avatarUrl: poolCard?.avatarUrl ?? "",
    rarity: internal,
    visualRarity: visual,
    power: c.power,
    role: c.role,
    traits: [],
    generation: 1,
    serial: `${c.serialNumber}/${c.maxSupply}`,
    serialNumber: Number(c.serialNumber),
    mintedSerial: Number(c.serialNumber),
    owner: ownerKey,
    acquiredAt: c.mintedAt,
    instanceId: `nft-${c.tokenId.toString()}`,
  };
}

function PhaseStatusLine({
  phase,
  stepLabel,
  txHash,
  error,
}: {
  phase: string;
  stepLabel?: string;
  txHash?: string;
  error?: string;
}) {
  if (phase === "idle") return null;
  const isError = phase === "error";
  const isDone = phase === "done";
  return (
    <div
      className={`bevel-in-thin p-2 font-mono text-[10px] flex items-center justify-between gap-2 ${
        isError
          ? "bg-[#1f0a0a] border border-[#ff8a8a]/40 text-[#ff8a8a]"
          : isDone
          ? "bg-[#06231d] border border-[#1CC744]/40 text-[#1CC744]"
          : "bg-[#06231d] border border-aqua/40 text-aqua"
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        {!isError && !isDone && <Loader2 size={11} className="animate-spin shrink-0" />}
        {isDone && <CheckCircle2 size={11} className="shrink-0" />}
        {isError && <AlertTriangle size={11} className="shrink-0" />}
        <span className="truncate">
          {isError ? error : isDone ? "Burn complete" : stepLabel ?? "Working…"}
        </span>
        {txHash && !isError && (
          <a
            href={explorerTxUrl(txHash)}
            target="_blank"
            rel="noreferrer noopener"
            className="text-iceaccent/60 hover:text-aqua underline shrink-0"
          >
            view tx ↗
          </a>
        )}
      </span>
    </div>
  );
}

export function RecycleBinWindow({ address }: RecycleBinWindowProps) {
  const owned = useOwnedPackNFTs(address);
  const burner = useCardBurner();
  const history = useBurnHistory(address);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [burnRates, setBurnRates] = useState<Record<number, bigint>>({});
  const [approved, setApproved] = useState<boolean | null>(null);
  const [approveError, setApproveError] = useState<string | undefined>();
  const [pool, setPool] = useState<CollectionPool | null>(null);
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("ALL");
  const [raritySort, setRaritySort] = useState<RaritySort>("low-high");

  // Auto-check approval status on mount + whenever wallet changes, so the
  // burn button reflects reality (don't make the user click Approve twice).
  useEffect(() => {
    if (!address || !hasCardBurner) {
      setApproved(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ok = (await publicClient.readContract({
          address: packNftAddress,
          abi: [
            {
              type: "function",
              name: "isApprovedForAll",
              inputs: [
                { name: "owner", type: "address" },
                { name: "operator", type: "address" },
              ],
              outputs: [{ type: "bool" }],
              stateMutability: "view",
            },
          ],
          functionName: "isApprovedForAll",
          args: [address, cardBurnerAddress],
        })) as boolean;
        if (!cancelled) setApproved(ok);
      } catch (e) {
        if (!cancelled) setApproved(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Load burn rates from contract on mount.
  useEffect(() => {
    if (!hasCardBurner) return;
    let cancelled = false;
    (async () => {
      try {
        const rates: Record<number, bigint> = {};
        for (let r = 0; r < 5; r++) {
          rates[r] = await burner.readBurnRate(r);
        }
        if (!cancelled) setBurnRates(rates);
      } catch (e) {
        if (import.meta.env.DEV) console.error("[RecycleBin] readBurnRate failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [burner]);

  // Load pack pool JSON (for username/avatar enrichment). Same loader
  // the rest of the app uses (loadCollectionPool → /data/ritual-pack-pool.json).
  useEffect(() => {
    let cancelled = false;
    loadCollectionPool()
      .then((p) => {
        if (!cancelled) setPool(p);
      })
      .catch(() => {
        if (!cancelled) setPool(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ownerKey = address?.toLowerCase() ?? "guest";

  const cards = useMemo(
    () => (pool ? owned.cards.map((c) => ownedCardToDisplayCard(c, pool, ownerKey)) : []),
    [owned.cards, pool, ownerKey],
  );

  const displayedCards = useMemo(() => {
    const filtered = rarityFilter === "ALL"
      ? cards
      : cards.filter((c) => c.rarity === rarityFilter);
    return [...filtered].sort((a, b) => {
      const delta = rarityIndex(a.rarity) - rarityIndex(b.rarity);
      return raritySort === "low-high" ? delta : -delta;
    });
  }, [cards, rarityFilter, raritySort]);

  const totalSelectedAp = useMemo(() => {
    let total = 0n;
    for (const c of cards) {
      if (selected.has(c.instanceId)) {
        const rate = burnRates[rarityIndex(c.rarity)] ?? 0n;
        total += rate;
      }
    }
    return total;
  }, [cards, selected, burnRates]);

  const toggleSelected = useCallback((instanceId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(displayedCards.filter((c) => c.rarity !== "GENESIS").map((c) => c.instanceId)));
  }, [displayedCards]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleApprove = useCallback(async () => {
    setApproveError(undefined);
    try {
      if (import.meta.env.DEV) console.log("[RecycleBin] approve: clicked, calling burner.approve()");
      await burner.approve();
      if (import.meta.env.DEV) console.log("[RecycleBin] approve: success");
      setApproved(true);
    } catch (e) {
      const msg = (e as Error).message || "Approval failed";
      if (import.meta.env.DEV) console.error("[RecycleBin] approve failed", e);
      setApproveError(msg);
    }
  }, [burner]);

  const handleBurn = useCallback(async () => {
    const ids = cards
      .filter((c) => selected.has(c.instanceId))
      .map((c) => BigInt(c.instanceId.replace(/^nft-/, "")));
    if (ids.length === 0) return;
    try {
      if (ids.length === 1) {
        await burner.burnCard(ids[0]);
      } else {
        await burner.burnCards(ids);
      }
      setSelected(new Set());
    } catch (e) {
      if (import.meta.env.DEV) console.error("[RecycleBin] burn failed", e);
    }
  }, [burner, cards, selected]);

  if (!hasCardBurner) {
    return (
      <div className="grid place-items-center p-6 font-mono text-[11px] text-iceaccent/60">
        <Recycle size={32} className="text-iceaccent/40" />
        <p className="mt-3">Recycle Bin is offline — CardBurner not deployed.</p>
      </div>
    );
  }

  if (owned.loading) {
    return (
      <div className="grid place-items-center p-6 font-mono text-[11px] text-iceaccent/60">
        <p className="text-aqua">loading your cards…</p>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="grid place-items-center p-6 font-mono text-[11px] text-iceaccent/60 gap-2">
        <Trash2 size={32} className="text-iceaccent/40" />
        <p className="mt-1">no cards to recycle.</p>
        <p className="text-iceaccent/40 text-[10px]">open a pack to forge cards first.</p>
      </div>
    );
  }

  const selectedCount = selected.size;

  return (
    <div className="grid gap-3 p-2">
      
      {address && history.entries.length > 0 && (
        <div className="bevel-out bg-wgray p-[2px]">
          <div className="title-grad flex items-center gap-2 px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
            <Flame size={12} />
            Burn History
            <span className="flex-1" />
            <span className="font-mono text-[10px] font-normal text-ice/80">
              {history.totalBurned} burned · {formatAp(history.totalApEarned)} AP earned
            </span>
          </div>
          <div className="bevel-in bg-coal p-2">
            <div className="grid gap-1 max-h-[140px] overflow-y-auto">
              {history.entries.slice(0, 8).map((e) => {
                const rarityNum = e.rarity;
                const rarityLabel = VISUAL_LABELS[rarityNum] ?? "UNKNOWN";
                const rarityColor = RARITY_COLORS[rarityNum] ?? "text-ice";
                const timeAgo = e.burnedAt
                  ? relativeTime(e.burnedAt)
                  : "on-chain";
                return (
                  <a
                    key={e.txHash}
                    href={explorerTxUrl(e.txHash)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="bevel-in-thin flex items-center justify-between gap-2 bg-[#061512] px-2 py-1 font-mono text-[10px] hover:bg-[#0a1f1c] transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={rarityColor}>{rarityLabel}</span>
                      <span className="text-iceaccent/70">
                        #{e.tokenId.toString()}
                      </span>
                      <span className="text-aqua">+{formatAp(e.apEarned)} AP</span>
                    </span>
                    <span className="flex items-center gap-1 text-iceaccent/50 shrink-0">
                      <Clock size={9} />
                      {timeAgo}
                      <ExternalLink size={9} />
                    </span>
                  </a>
                );
              })}
            </div>
            {history.entries.length > 8 && (
              <p className="mt-1 text-center font-mono text-[9px] text-iceaccent/40">
                + {history.entries.length - 8} more in local cache
              </p>
            )}
          </div>
        </div>
      )}

      
      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad flex items-center gap-2 px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          <Recycle size={12} />
          Recycle Bin
        </div>
        <div className="bevel-in bg-coal p-3 font-mono text-[10px] text-iceaccent/70">
          <p>
            <span className="text-aqua">Select unwanted cards, then recycle them into AP Energy.</span>
          </p>
          <p className="mt-1 grid grid-cols-5 gap-2">
            {Object.entries(VISUAL_LABELS).slice(0, 5).map(([r, label]) => {
              const rate = burnRates[Number(r)] ?? 0n;
              const rateStr = rate > 0n ? formatAp(rate) : "—";
              return (
                <span key={r}>
                  <span className={RARITY_COLORS[Number(r)]}>{label}</span>
                  <span className="text-iceaccent/40">: {rateStr} AP</span>
                </span>
              );
            })}
          </p>
          <p className="mt-1 text-iceaccent/40">
            Genesis (rarity 5) is locked — non-burnable to preserve scarcity.
          </p>
        </div>
      </div>

      
      <PhaseStatusLine
        phase={burner.phase}
        stepLabel={burner.pendingStepLabel}
        txHash={burner.pendingTxHash}
        error={burner.error}
      />

      
      <div className="bevel-in-thin bg-[#061512] p-2 flex items-center justify-between gap-2 font-mono text-[10px]">
        <span className="text-iceaccent/60">
          {selectedCount} of {cards.filter((c) => c.rarity !== "GENESIS").length} burnable selected
          <span className="text-iceaccent/35"> · showing {displayedCards.length}/{cards.length}</span>
        </span>
        <span className="flex items-center gap-2">
          <Coins size={11} className="text-aqua" />
          <span className="text-aqua font-bold">
            {totalSelectedAp > 0n ? formatAp(totalSelectedAp) : "0"} AP
          </span>
          <button
            onClick={selectAll}
            className="bevel-in-thin px-2 py-0.5 text-[9px] text-iceaccent/70 hover:text-ice"
          >
            select visible
          </button>
          <button
            onClick={selectNone}
            className="bevel-in-thin px-2 py-0.5 text-[9px] text-iceaccent/70 hover:text-ice"
          >
            clear
          </button>
        </span>
      </div>

      <div className="bevel-in-thin bg-[#050d0b] p-2 font-mono text-[10px]">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-iceaccent/45 uppercase tracking-[0.16em]">sort / filter by rarity</span>
          <button
            onClick={() => setRaritySort((v) => (v === "low-high" ? "high-low" : "low-high"))}
            className="bevel-in-thin px-2 py-0.5 text-[9px] text-aqua hover:text-ice"
          >
            {raritySort === "low-high" ? "low → high" : "high → low"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RARITY_FILTERS.map((filter) => {
            const idx = rarityIndex(filter);
            const active = rarityFilter === filter;
            const label = filter === "ALL" ? "ALL" : (VISUAL_LABELS[idx] ?? filter);
            return (
              <button
                key={filter}
                onClick={() => setRarityFilter(filter)}
                className={`bevel-in-thin px-2 py-0.5 text-[9px] transition-colors ${
                  active ? "bg-[#063226] text-aqua" : "bg-[#071512] text-iceaccent/55 hover:text-ice"
                }`}
              >
                <span className={idx >= 0 ? RARITY_COLORS[idx] : ""}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      
      {address && approved !== true && (
        <div className="space-y-1.5">
          <div className="bevel-in-thin bg-[#1a0f2e] border border-[#c9b8ff]/30 p-2 flex items-center justify-between gap-2 font-mono text-[10px]">
            <span className="text-[#c9b8ff]">
              {approved === null
                ? "Checking CardBurner approval…"
                : "One-time approval required before burning."}
            </span>
            <button
              onClick={handleApprove}
              disabled={burner.loading || approved === null}
              data-testid="recycle-approve-button"
              className="bevel-in-thin bg-[#1a0f2e] px-2 py-0.5 text-[9px] text-[#c9b8ff] hover:bg-[#2a174e] disabled:opacity-40"
            >
              {approved === null ? "Checking…" : burner.loading ? "Check wallet…" : "Approve Burner"}
            </button>
          </div>
          {approveError && (
            <div className="bevel-in-thin bg-[#1f0a0a] border border-[#ff8a8a]/40 p-2 font-mono text-[10px] text-[#ff8a8a] flex items-start gap-2">
              <AlertTriangle size={11} className="mt-[1px] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-bold">Approve failed</p>
                <p className="break-all">{approveError}</p>
                <p className="mt-1 text-[9px] text-iceaccent/60">
                  Check: (1) wallet is on Ritual Chain (chainId 1979), (2) wallet popup isn't hidden, (3) you have RITUAL for gas.
                </p>
              </div>
              <button
                onClick={() => setApproveError(undefined)}
                className="text-[#ff8a8a]/60 hover:text-[#ff8a8a] text-[10px] shrink-0"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[10px] text-iceaccent/40">
          Recycling permanently destroys the card. AP cannot be refunded.
        </div>
        <button
          onClick={handleBurn}
          disabled={selectedCount === 0 || burner.loading || approved !== true}
          className="win-btn win-btn-emerald inline-flex items-center gap-2 px-3 py-1.5 font-ui text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="recycle-burn-button"
        >
          <Trash2 size={12} />
          Recycle Selected ({selectedCount})
        </button>
      </div>

      
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {displayedCards.map((c) => {
          const rarityNum = rarityIndex(c.rarity);
          const isGenesis = rarityNum === 5;
          const rate = burnRates[rarityNum] ?? 0n;
          const isSelected = selected.has(c.instanceId);
          return (
            <div
              key={c.instanceId}
              className={`relative ${isGenesis ? "opacity-50" : ""}`}
            >
              <label
                className={`block cursor-pointer ${
                  isSelected ? "ring-2 ring-aqua rounded-sm" : ""
                } ${isGenesis ? "cursor-not-allowed" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => !isGenesis && toggleSelected(c.instanceId)}
                  disabled={isGenesis}
                  className="absolute top-2 left-2 z-10 w-4 h-4 accent-aqua"
                />
                <CollectionCard card={c} versionBadge="V10" />
              </label>
              <div className="bevel-in-thin bg-[#061512] mt-1 px-2 py-1 font-mono text-[10px] flex items-center justify-between">
                <span className={RARITY_COLORS[rarityNum] ?? "text-ice"}>
                  {VISUAL_LABELS[rarityNum] ?? "UNKNOWN"}
                </span>
                <span className="text-aqua">
                  {isGenesis ? (
                    <span className="text-iceaccent/40">locked</span>
                  ) : rate > 0n ? (
                    <>+{formatAp(rate)} AP</>
                  ) : (
                    <span className="text-iceaccent/40">—</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
