// src/components/progress/CollectionGalleryWindow.tsx
// Collection Gallery System — permanent display of every RitualPackNFT
// token owned by the connected wallet. The **chain is the source of
// truth**: we read `tokensOfOwner(address)` from RitualPackNFT via
// the useOwnedPackNFTs hook, then resolve each tokenId's on-chain
// `cardData`. localStorage is never used for ownership.
//
// Filters:  ALL · INITIATE · BITTY · RITTY · RITUALIST · RADIANT RITUALIST · GENESIS
// Sort:     Newest · Oldest · Highest Power · Lowest Power ·
//           Lowest Serial · Highest Serial · Rarity
// Stats:    Total · By Rarity · Highest Power · Total Power
// Detail:   click a card → full canvas renderer (CollectionCard)

import { useEffect, useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Filter, ImageIcon, Search, Star, X } from "lucide-react";
import type { Address } from "viem";
import { CollectionCard } from "../pack/CollectionCard";
import { RitualMark } from "../Logo";
import { useOwnedPackNFTs, type OwnedPackCard } from "../../hooks/useOwnedPackNFTs";
import { type CollectionPool, loadCollectionPool } from "../../lib/packPool";
import { type PackResultCard } from "../../types/packCard";
import {
  INTERNAL_RARITIES,
  INTERNAL_RANK,
  RARITY_TIER_CONFIG,
  internalToVisualRarity,
  roleToInternalRarity,
  type InternalRarity,
} from "../../lib/rarity";

// Reverse rarity → role (the on-chain contract stores role as a
// human string; this map is used for display fallback when the pool
// JSON has no record of the underlying cardId).
const ROLE_BY_RARITY: Record<number, string> = {
  0: "INITIATE",
  1: "BITTY",
  2: "RITTY",
  3: "RITUALIST",
  4: "RADIANT RITUALIST",
  5: "GENESIS",
};

const RARITY_FILTERS: (InternalRarity | "ALL")[] = ["ALL", ...INTERNAL_RARITIES];

type SortKey =
  | "newest"
  | "oldest"
  | "powerDesc"
  | "powerAsc"
  | "serialAsc"
  | "serialDesc"
  | "rarityDesc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "powerDesc", label: "Highest Power" },
  { value: "powerAsc", label: "Lowest Power" },
  { value: "serialAsc", label: "Lowest Serial" },
  { value: "serialDesc", label: "Highest Serial" },
  { value: "rarityDesc", label: "Rarity" },
];

// INTERNAL_RANK is in rarity.ts; we import it for the rarity sort.
const RANK_LOOKUP = (r: InternalRarity): number => INTERNAL_RANK[r] ?? 0;

function sortCards(cards: PackResultCard[], key: SortKey): PackResultCard[] {
  const out = [...cards];
  switch (key) {
    case "newest":
      out.sort((a, b) => b.acquiredAt - a.acquiredAt);
      break;
    case "oldest":
      out.sort((a, b) => a.acquiredAt - b.acquiredAt);
      break;
    case "powerDesc":
      out.sort((a, b) => b.power - a.power);
      break;
    case "powerAsc":
      out.sort((a, b) => a.power - b.power);
      break;
    case "serialAsc":
      out.sort((a, b) => a.serialNumber - b.serialNumber);
      break;
    case "serialDesc":
      out.sort((a, b) => b.serialNumber - a.serialNumber);
      break;
    case "rarityDesc":
      out.sort((a, b) => RANK_LOOKUP(b.rarity) - RANK_LOOKUP(a.rarity));
      break;
  }
  // Stable secondary sort by cardId so equal-rank cards are deterministic.
  out.sort((a, b) => {
    const primary =
      key === "newest" || key === "oldest"
        ? b.acquiredAt - a.acquiredAt
        : key === "powerDesc"
          ? b.power - a.power
          : key === "powerAsc"
            ? a.power - b.power
            : key === "serialAsc"
              ? a.serialNumber - b.serialNumber
              : key === "serialDesc"
                ? b.serialNumber - a.serialNumber
                : RANK_LOOKUP(b.rarity) - RANK_LOOKUP(a.rarity);
    return primary !== 0 ? primary : a.cardId - b.cardId;
  });
  return out;
}

// ─── Statistics Panel ────────────────────────────────────────────────
interface OnChainCollectionStats {
  total: number;
  totalPower: number;
  collectionScore: number;
  genesisCount: number;
  byRarity: Partial<Record<InternalRarity, number>>;
  highestPower?: { username: string; power: number };
  lowestSerial?: { username: string; serial: string };
}

function computeOnChainStats(cards: PackResultCard[]): OnChainCollectionStats {
  const byRarity: Partial<Record<InternalRarity, number>> = {};
  let totalPower = 0;
  let collectionScore = 0;
  let genesisCount = 0;
  let highestPower: { username: string; power: number } | undefined;
  let lowestSerial: { username: string; serial: string } | undefined;
  for (const c of cards) {
    byRarity[c.rarity] = (byRarity[c.rarity] ?? 0) + 1;
    totalPower += c.power;
    collectionScore += c.power + INTERNAL_RANK[c.rarity] * 10;
    if (c.rarity === "GENESIS") genesisCount++;
    if (!highestPower || c.power > highestPower.power) {
      highestPower = { username: c.username, power: c.power };
    }
    if (!lowestSerial || c.serialNumber < (lowestSerial as any).__serial) {
      lowestSerial = { username: c.username, serial: c.serial };
      (lowestSerial as any).__serial = c.serialNumber;
    }
  }
  return {
    total: cards.length,
    totalPower,
    collectionScore,
    genesisCount,
    byRarity,
    highestPower,
    lowestSerial,
  };
}

function StatsPanel({ stats, owner }: { stats: OnChainCollectionStats; owner?: string }) {
  const rows: { label: string; value: React.ReactNode; tone?: "aqua" | "amber" }[] = [
    { label: "Total Cards", value: stats.total, tone: "aqua" },
    { label: "Total Power", value: stats.totalPower.toLocaleString(), tone: "aqua" },
    { label: "Collection Score", value: stats.collectionScore.toLocaleString(), tone: "aqua" },
    { label: "Genesis Count", value: stats.genesisCount, tone: stats.genesisCount > 0 ? "amber" : "aqua" },
  ];
  return (
    <div className="bevel-out bg-wgray p-[2px]">
      <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
        Statistics
      </div>
      <div className="bevel-in bg-coal p-2 font-mono text-[10px] text-iceaccent/70">
        <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-4">
          {rows.map((r) => (
            <div key={r.label} className="bevel-in-thin bg-[#080808] p-2 text-center">
              <p className="text-[8px] uppercase tracking-[0.15em] text-iceaccent/40">{r.label}</p>
              <p
                className={`mt-0.5 font-display text-base font-bold ${
                  r.tone === "amber" ? "text-[#ffd76a]" : "text-aqua"
                }`}
              >
                {r.value}
              </p>
            </div>
          ))}
        </div>

        
        <div className="mt-2">
          <p className="text-[8px] uppercase tracking-[0.15em] text-iceaccent/40 mb-1">
            Cards By Rarity
          </p>
          <div className="grid gap-0.5">
            {INTERNAL_RARITIES.map((r) => {
              const cfg = RARITY_TIER_CONFIG[r];
              const n = stats.byRarity[r] ?? 0;
              const max = stats.total || 1;
              const pct = Math.round((n / max) * 100);
              return (
                <div key={r} className="flex items-center gap-2 text-[9px]">
                  <span className="w-32 text-iceaccent/70">{r}</span>
                  <span className="w-10 text-right text-aqua">{n}</span>
                  <div className="bevel-in-thin bg-[#060606] h-2 flex-1">
                    <div
                      className="h-full bg-gradient-to-r from-[#053931] to-aqua transition-all duration-300"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-iceaccent/40">{pct}%</span>
                  <span className="w-16 text-right text-iceaccent/30">pow {cfg.powerMin}-{cfg.powerMax}</span>
                </div>
              );
            })}
          </div>
        </div>

        
        <div className="mt-2 grid gap-1 grid-cols-1 sm:grid-cols-2">
          {stats.highestPower && (
            <p className="text-[9px]">
              <Star size={9} className="inline -mt-0.5 mr-1 text-[#ffd76a]" />
              <span className="text-iceaccent/40">Highest Power · </span>
              <span className="text-aqua">@{stats.highestPower.username}</span>
              <span className="text-iceaccent/40"> · </span>
              <span className="text-[#ffd76a]">Power {stats.highestPower.power}</span>
            </p>
          )}
          {stats.lowestSerial && (
            <p className="text-[9px]">
              <ArrowDownAZ size={9} className="inline -mt-0.5 mr-1 text-aqua" />
              <span className="text-iceaccent/40">Lowest Serial · </span>
              <span className="text-aqua">@{stats.lowestSerial.username}</span>
              <span className="text-iceaccent/40"> · </span>
              <span className="text-aqua">{stats.lowestSerial.serial}</span>
            </p>
          )}
          {owner && (
            <p className="text-[9px] sm:col-span-2">
              <span className="text-iceaccent/40">Owner · </span>
              <span className="text-aqua font-mono">
                {owner === "guest" ? "guest (no wallet)" : `${owner.slice(0, 6)}…${owner.slice(-4)}`}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Card Detail Modal ───────────────────────────────────────────────
function CardDetailModal({ card, onClose }: { card: PackResultCard; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-[1px]">
      <div className="win-open bevel-out bg-wgray p-[2px] w-full max-w-md mx-4">
        <div className="title-grad px-2 py-[3px] flex items-center justify-between">
          <span className="font-ui text-[11px] font-bold text-ice">
            Gallery Detail
          </span>
          <button onClick={onClose} className="win-ctrl" aria-label="Close">
            <span className="text-[10px] font-bold leading-none">✕</span>
          </button>
        </div>
        <div className="bevel-in bg-coal p-4">
          <CollectionCard card={card} versionBadge="V10" />
          <pre className="mt-3 font-mono text-[10px] text-iceaccent/70 whitespace-pre-wrap leading-relaxed">
{[
  card.rarity,
  card.serial,
  `Power ${card.power}`,
  `Traits ${card.traits.length}`,
  `Generation S${card.generation}`,
  "",
  `Card ID: ${card.cardId}`,
  `Owner: ${card.owner === "guest" ? "guest" : `${card.owner.slice(0, 6)}…${card.owner.slice(-4)}`}`,
  `Acquired: ${new Date(card.acquiredAt).toISOString()}`,
  "",
  `Traits: ${card.traits.join(", ")}`,
].join("\n")}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ─── Gallery Grid ────────────────────────────────────────────────────
function GalleryGrid({
  cards,
  onSelect,
}: {
  cards: PackResultCard[];
  onSelect: (c: PackResultCard) => void;
}) {
  if (cards.length === 0) {
    return (
      <div className="bevel-in bg-[#0a0a0a] p-6 text-center font-mono text-[11px] text-iceaccent/40">
        no cards match the current filter
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <button
          key={c.instanceId}
          onClick={() => onSelect(c)}
          className="text-left transition-transform hover:scale-[1.02]"
        >
          <CollectionCard card={c} versionBadge="V10" />
        </button>
      ))}
    </div>
  );
}

// ─── Adapter: OwnedPackCard + pool → PackResultCard ──────────────────
function toPackResultCard(c: OwnedPackCard, pool: CollectionPool | null, ownerKey: string): PackResultCard {
  const poolCard = pool?.byId?.[Number(c.cardId)];
  // c.rarity from contract is a uint8 (0..5). INTERNAL_RARITIES is the
  // canonical index→name map, so we look up the string instead of casting
  // a number to InternalRarity (which would crash RARITY_TIER_CONFIG[number]).
  const internalRarity: InternalRarity =
    (INTERNAL_RARITIES as readonly string[])[c.rarity] as InternalRarity | undefined ??
    roleToInternalRarity(c.role) ??
    "BITTY";
  const visual = internalToVisualRarity(internalRarity);
  // Serial badge per user spec: "serialNumber/maxSupply", e.g. "1/50".
  // The chain is the source of truth — never derive from cardId.
  const serialNumber = Number(c.serialNumber);
  const maxSupply = Number(c.maxSupply);
  // Username is ONLY sourced from the off-chain pool JSON. We never
  // fall back to the contract role or any derived handle, because:
  //   1. The contract role (BITTY, RITUALIST, ...) is internal lore,
  //      not a community member handle.
  //   2. Cards in the on-chain pool that aren't in the pool JSON
  //      don't have a real Discord identity behind them (added via
  //      pool reseed without backing members), so showing any
  //      handle would be misleading.
  // The CollectionCard component handles a null/empty username by
  // hiding the @handle line entirely.
  return {
    cardId: Number(c.cardId),
    userId: poolCard?.userId ?? "",
    username: poolCard?.username ?? "",
    avatarUrl: poolCard?.avatarUrl ?? "",
    rarity: internalRarity,
    visualRarity: visual,
    power: c.power,
    role: c.role,
    traits: [],
    generation: 1,
    serial: `${serialNumber}/${maxSupply}`,
    serialNumber,
    mintedSerial: serialNumber,
    owner: ownerKey,
    acquiredAt: c.mintedAt,
    instanceId: `nft-${c.tokenId.toString()}`,
  };
}

// ─── Main Window ─────────────────────────────────────────────────────
export function CollectionGalleryWindow({ address }: { address?: Address }) {
  const ownerKey = address ? address.toLowerCase() : null;
  const owned = useOwnedPackNFTs(address);
  const [pool, setPool] = useState<CollectionPool | null>(null);
  const [chainId, setChainId] = useState<number | undefined>();

  // The pool JSON is only used to enrich the on-chain card with
  // username/avatarUrl. If it fails to load we still display cards
  // using the on-chain role as the username.
  useEffect(() => {
    void loadCollectionPool().then(setPool).catch(() => setPool(null));
  }, []);

  // Detect current chain for diagnostics — wrong chain = wrong data.
  useEffect(() => {
    if (typeof window === "undefined" || !(window as any).ethereum) return;
    const w = window as any;
    w.ethereum
      .request({ method: "eth_chainId" })
      .then((hex: string) => setChainId(parseInt(hex, 16)))
      .catch(() => {});
  }, []);

  const cards = useMemo(
    () => owned.cards.map((c) => toPackResultCard(c, pool, ownerKey ?? "guest")),
    [owned.cards, pool, ownerKey],
  );

  const [rarityFilter, setRarityFilter] = useState<InternalRarity | "ALL">("ALL");
  const [sort, setSort] = useState<SortKey>("newest");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PackResultCard | null>(null);

  // Clear selection when wallet changes.
  useEffect(() => {
    setSelected(null);
  }, [ownerKey]);

  const filtered = useMemo(() => {
    const byRarity = rarityFilter === "ALL"
      ? cards
      : cards.filter((c) => c.rarity === rarityFilter);
    const bySearch = search.trim()
      ? byRarity.filter((c) =>
          c.username.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : byRarity;
    return sortCards(bySearch, sort);
  }, [cards, rarityFilter, sort, search]);

  const stats = useMemo(() => computeOnChainStats(cards), [cards]);

  // No wallet connected — show the empty / connect state.
  if (!ownerKey) {
    return (
      <div className="grid gap-3 p-2">
        <div className="bevel-out bg-wgray p-[2px]">
          <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
            Gallery
          </div>
          <div className="bevel-in bg-coal p-6 text-center font-mono text-[11px] text-iceaccent/60">
            <RitualMark size={42} spin={false} glow shine />
            <p className="mt-3 text-aqua">connect a wallet to view your collection</p>
            <p className="mt-1 text-iceaccent/40 text-[10px]">
              cards pulled from packs are saved to the connected account
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 p-2">
      
      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          Gallery
        </div>
        <div className="bevel-in bg-coal p-2 font-mono text-[9px] text-iceaccent/60">
          <p>collection gallery · permanent card instances owned by this account</p>
          <p>cards pulled from packs are saved here and never disappear</p>
        </div>
      </div>

      
      <StatsPanel stats={stats} owner={ownerKey} />

      
      {owned.error && (
        <div className="bevel-in bg-[#1a0606] border border-[#5a1a1a] p-2 font-mono text-[10px] text-[#ff8a8a]">
          <p className="font-bold mb-1">hook error</p>
          <p className="text-[#ffaaaa]/80 break-all">{owned.error.message}</p>
        </div>
      )}
      {owned.loading && (
        <p className="font-mono text-[9px] text-iceaccent/40">
          loading collection from chain…
        </p>
      )}
      {owned.cards.length === 0 && !owned.loading && !owned.error && chainId !== undefined && chainId !== 1979 && (
        <div className="bevel-in bg-[#1a1a06] border border-[#5a5a1a] p-2 font-mono text-[10px] text-[#ffd76a]">
          ⚠ wrong network · chain {chainId} detected (need 1979)
        </div>
      )}

      
      <div className="bevel-in bg-[#080808] p-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-[9px] text-iceaccent/40 inline-flex items-center gap-1">
              <Filter size={9} /> Filter
            </span>
            {RARITY_FILTERS.map((r) => {
              const active = r === rarityFilter;
              const count =
                r === "ALL" ? cards.length : cards.filter((c) => c.rarity === r).length;
              return (
                <button
                  key={r}
                  onClick={() => setRarityFilter(r)}
                  className={`bevel-in-thin px-1.5 py-0.5 text-[9px] ${
                    active
                      ? "bg-[#06231d] text-aqua"
                      : "bg-[#0b0b0b] text-iceaccent/50 hover:text-iceaccent/80"
                  }`}
                >
                  {r}
                  <span className="ml-1 text-iceaccent/30">({count})</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bevel-in-thin bg-[#0b0b0b] px-1.5 py-0.5 flex-1 sm:flex-none">
              <Search size={10} className="text-iceaccent/40" />
              <input
                type="text"
                placeholder="username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent font-mono text-[9px] text-ice outline-none placeholder:text-iceaccent/30 w-32"
              />
            </div>
            <div className="flex items-center gap-1">
              <ArrowUpAZ size={10} className="text-iceaccent/40" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="bevel-in-thin bg-[#0b0b0b] px-1.5 py-0.5 text-[9px] text-ice outline-none"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <p className="mt-2 font-mono text-[9px] text-iceaccent/40">
          showing {filtered.length} of {cards.length} cards
          {rarityFilter !== "ALL" && ` · filtered by ${rarityFilter}`}
          {search.trim() && ` · matching "${search.trim()}"`}
        </p>
      </div>

      
      {cards.length === 0 ? (
        <div className="bevel-in bg-[#0a0a0a] p-6 text-center font-mono text-[11px] text-iceaccent/50">
          <ImageIcon size={32} className="mx-auto text-iceaccent/30" />
          <p className="mt-3 text-aqua">your collection is empty</p>
          <p className="mt-1 text-iceaccent/40 text-[10px]">
            open a pack from the Collection Packs window to start collecting
          </p>
        </div>
      ) : (
        <GalleryGrid cards={filtered} onSelect={setSelected} />
      )}

      
      <p className="font-mono text-[8px] text-iceaccent/25 text-center">
        Gallery {stats.total} cards · {stats.collectionScore} collection score
        · click a card for full render
      </p>

      
      {selected && <CardDetailModal card={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
