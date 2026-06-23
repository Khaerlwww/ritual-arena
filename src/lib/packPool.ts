// --------------------------------------------------------------------
// Collection Pack System v5 — Pool Registry
// --------------------------------------------------------------------
// Source of truth: public/data/ritual-pack-pool.json
// Each imported community member becomes a card type in the pool.
//
// Card data stored (per spec):
//   cardId, userId, username, avatarUrl, rarity, visualRarity,
//   mintedSupply, maxSupply
// Card data NOT stored:
//   displayName, role, discordId (renamed to userId), fromRole, toRole, at
//
// All Discord-specific fields are read during import and discarded after
// derivation. Rarity is derived from the `role` field via spec mapping
// (bitty→BITTY, ritty→RITTY, etc.), not from the JSON's `rarity` field
// (which uses a legacy visual bucketing scheme that is now overridden).

import {
  INTERNAL_RARITIES,
  RARITY_TIER_CONFIG,
  internalToVisualRarity,
  roleToInternalRarity,
  type InternalRarity,
} from "./rarity";
import type { Rarity } from "./rarity";

// --------------------------------------------------------------------
// Types
// --------------------------------------------------------------------

export interface PoolCard {
  cardId: number;
  userId: string; // Discord snowflake
  username: string;
  avatarUrl: string;
  rarity: InternalRarity; // pack-logic name
  visualRarity: Rarity; // renderer name
  mintedSupply: number;
  maxSupply: number;
}

export interface CollectionPool {
  /** All cards in the pool, indexed by cardId for O(1) lookup. */
  byId: Record<number, PoolCard>;
  /** Cards grouped by internal rarity. */
  byRarity: Record<InternalRarity, PoolCard[]>;
  /** Total card count in the pool. */
  total: number;
  /** Per-rarity count (initial supply, not remaining). */
  counts: Record<InternalRarity, number>;
  /** Source version (from JSON). */
  version: number;
  /** Source name (from JSON). */
  name: string;
  /** True if the loader encountered records that could not be imported. */
  invalid: number;
  /** Per-rarity cardIds available (not yet minted to maxSupply). */
  availableByRarity: Record<InternalRarity, number[]>;
}

interface RawRecord {
  id: number;
  discordId: string;
  username: string;
  displayName?: string;
  role?: string;
  rarity?: string; // legacy visual bucket key — ignored
  avatarUrl?: string;
  source?: { fromRole?: string; toRole?: string; at?: number };
}

interface RawPoolJson {
  version: number;
  name: string;
  total: number;
  rarities: Record<string, RawRecord[]>;
}

// --------------------------------------------------------------------
// Storage keys
// --------------------------------------------------------------------

const POOL_STORAGE_KEY = "ritual-arena:pack-pool:v1";

/** Genesis is admin-configurable; default matches RADIANT RITUALIST. */
function genesisMaxSupply(): number {
  // Allow env override at build time. Defaults to 3 — admins can change.
  const fromEnv =
    typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_GENESIS_MAX_SUPPLY;
  const parsed = fromEnv ? Number.parseInt(String(fromEnv), 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

// --------------------------------------------------------------------
// Pool loader
// --------------------------------------------------------------------

/**
 * Fetch and parse the pack pool JSON. Caches the parsed result in memory
 * and in localStorage so subsequent calls are instant.
 *
 * The pool JSON is display-only metadata — it is NEVER used for
 * ownership or AP. Source of truth for card ownership is the on-chain
 * RitualPackNFT; source of truth for AP is the on-chain RitualAP.
 *
 * Source of truth: /data/ritual-pack-pool.json (served from public/).
 */
let _cachedPool: CollectionPool | null = null;
let _inflight: Promise<CollectionPool> | null = null;

export async function loadCollectionPool(fetchImpl: typeof fetch = fetch): Promise<CollectionPool> {
  if (_cachedPool) return _cachedPool;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    let json: RawPoolJson;
    try {
      const res = await fetchImpl("/data/ritual-pack-pool.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = (await res.json()) as RawPoolJson;
    } catch (err) {
      // Offline / dev: try localStorage cache.
      const cached = readPoolFromStorage();
      if (cached) {
        _cachedPool = applyMintedSupplyOverlay(cached);
        return _cachedPool;
      }
      throw new Error(`Failed to load pack pool: ${(err as Error).message}`);
    }
    const pool = buildPoolFromJson(json);
    writePoolToStorage(json);
    _cachedPool = applyMintedSupplyOverlay(pool);
    return _cachedPool;
  })();
  return _inflight;
}

/** Reset the loader cache (mainly for tests). */
export function _resetPoolCache(): void {
  _cachedPool = null;
  _inflight = null;
}

function buildPoolFromJson(json: RawPoolJson): CollectionPool {
  const byId: Record<number, PoolCard> = {};
  const byRarity: Record<InternalRarity, PoolCard[]> = {
    INITIATE: [],
    BITTY: [],
    RITTY: [],
    RITUALIST: [],
    "RADIANT RITUALIST": [],
    GENESIS: [],
  };
  const counts: Record<InternalRarity, number> = {
    INITIATE: 0,
    BITTY: 0,
    RITTY: 0,
    RITUALIST: 0,
    "RADIANT RITUALIST": 0,
    GENESIS: 0,
  };
  let invalid = 0;
  let total = 0;
  const seenIds = new Set<number>();

  // Walk every record across every legacy visual bucket.
  for (const bucket of Object.values(json.rarities ?? {})) {
    if (!Array.isArray(bucket)) continue;
    for (const rec of bucket) {
      if (!rec || typeof rec !== "object") {
        invalid++;
        continue;
      }
      const username = (rec.username ?? "").toString().trim();
      const avatarUrl = (rec.avatarUrl ?? "").toString().trim();
      const userId = (rec.discordId ?? "").toString().trim();
      const cardId = Number(rec.id);
      const role = (rec.role ?? "").toString();

      if (!username || !avatarUrl || !userId || !Number.isFinite(cardId) || cardId <= 0) {
        invalid++;
        continue;
      }
      if (seenIds.has(cardId)) {
        // Duplicate cardId in source — keep first, skip rest.
        invalid++;
        continue;
      }
      const internal = roleToInternalRarity(role);
      if (!internal) {
        invalid++;
        continue;
      }
      seenIds.add(cardId);
      const config = RARITY_TIER_CONFIG[internal];
      const maxSupply = config.maxSupply === "custom" ? genesisMaxSupply() : config.maxSupply;
      const card: PoolCard = {
        cardId,
        userId,
        username,
        avatarUrl,
        rarity: internal,
        visualRarity: config.visual,
        mintedSupply: 0,
        maxSupply,
      };
      byId[cardId] = card;
      byRarity[internal].push(card);
      counts[internal]++;
      total++;
    }
  }

  // Stable ordering by cardId within each rarity.
  for (const r of INTERNAL_RARITIES) byRarity[r].sort((a, b) => a.cardId - b.cardId);

  const availableByRarity: Record<InternalRarity, number[]> = {
    INITIATE: [],
    BITTY: [],
    RITTY: [],
    RITUALIST: [],
    "RADIANT RITUALIST": [],
    GENESIS: [],
  };
  for (const r of INTERNAL_RARITIES) {
    availableByRarity[r] = byRarity[r].filter((c) => c.mintedSupply < c.maxSupply).map((c) => c.cardId);
  }

  return {
    byId,
    byRarity,
    total,
    counts,
    version: json.version ?? 1,
    name: json.name ?? "Ritual Community Pack Pool",
    invalid,
    availableByRarity,
  };
}

// --------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------

export function getCardById(pool: CollectionPool, cardId: number): PoolCard | undefined {
  return pool.byId[cardId];
}

export function getCardsByRarity(pool: CollectionPool, rarity: InternalRarity): PoolCard[] {
  return pool.byRarity[rarity] ?? [];
}

export function getAvailableCards(pool: CollectionPool, rarity: InternalRarity): PoolCard[] {
  const ids = pool.availableByRarity[rarity] ?? [];
  return ids.map((id) => pool.byId[id]).filter(Boolean);
}

/**
 * @deprecated V4 LEGACY. In V5 the chain (PackManager) is the source of
 * truth for live supply. This function reads a localStorage-backed
 * `mintedSupply` overlay and would lie to V5 consumers. Do NOT call from
 * new code. Kept only as a private helper for the V4 fallback path.
 */
export function getRemainingSupply(pool: CollectionPool, cardId: number): number {
  const c = pool.byId[cardId];
  if (!c) return 0;
  return Math.max(0, c.maxSupply - c.mintedSupply);
}

// --------------------------------------------------------------------
// Persistence (mintedSupply across reloads)
// --------------------------------------------------------------------

function readPoolFromStorage(): CollectionPool | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(POOL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RawPoolJson;
    return buildPoolFromJson(parsed);
  } catch {
    return null;
  }
}

function writePoolToStorage(json: RawPoolJson): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POOL_STORAGE_KEY, JSON.stringify(json));
  } catch {
    /* ignore quota */
  }
}

interface MintLedger {
  [cardId: number]: number; // mintedSupply per cardId
}
// MintLedger interface retained for type-compatibility with any future
// on-chain mirror. The localStorage write path was removed in V5.

/**
 * V5: chain is source of truth for minted supply. No localStorage ledger.
 * The on-chain PackManager is the only place that tracks actual supply.
 *
 * V4 legacy: was a localStorage-backed ledger overlay. Removed in V5.
 */
function applyMintedSupplyOverlay(pool: CollectionPool): CollectionPool {
  // V5: chain is source of truth. Reset all cards to mintedSupply=0
  // so the displayed `availableByRarity` reflects the FULL pool, not
  // a stale local ledger.
  for (const card of Object.values(pool.byId)) {
    card.mintedSupply = 0;
  }
  for (const r of INTERNAL_RARITIES) {
    pool.availableByRarity[r] = pool.byRarity[r]
      .filter((c) => c.mintedSupply < c.maxSupply)
      .map((c) => c.cardId);
  }
  return pool;
}

function isV5PackMode(): boolean {
  return true; // V8 supply is canonical, on-chain only
}

// V4 legacy functions (recordMint, _clearMintLedger, mergeMintedSuppliesLegacy)
// were removed in V5. In V5+ pack mints happen on-chain via
// PackManager.openXxxPack and the chain is the only source of truth.
export function recordMint(_pool: CollectionPool, _cardId: number): boolean {
  return false;
}
export function _clearMintLedger(): void { /* no-op in V5 */ }

// --------------------------------------------------------------------
// Validation helper (used by the validate script and tests)
// --------------------------------------------------------------------

export interface PoolValidation {
  ok: boolean;
  total: number;
  counts: Record<InternalRarity, number>;
  invalidRecords: number;
  missingAvatar: number;
  missingUsername: number;
  duplicateCardIds: string[];
  invalidRoles: string[];
  poolsNonEmpty: Record<InternalRarity, boolean>;
}

/**
 * Validate the pool JSON file (not the cached pool). Read-only — used by
 * scripts/validate-pack-pool.mjs and the runtime /diagnostic endpoint.
 */
export function validatePoolJson(json: unknown): PoolValidation {
  const counts: Record<InternalRarity, number> = {
    INITIATE: 0,
    BITTY: 0,
    RITTY: 0,
    RITUALIST: 0,
    "RADIANT RITUALIST": 0,
    GENESIS: 0,
  };
  const result: PoolValidation = {
    ok: true,
    total: 0,
    counts,
    invalidRecords: 0,
    missingAvatar: 0,
    missingUsername: 0,
    duplicateCardIds: [],
    invalidRoles: [],
    poolsNonEmpty: {
      INITIATE: false,
      BITTY: false,
      RITTY: false,
      RITUALIST: false,
      "RADIANT RITUALIST": false,
      GENESIS: false,
    },
  };

  if (!json || typeof json !== "object") {
    result.ok = false;
    return result;
  }
  const j = json as RawPoolJson;
  if (!j.rarities || typeof j.rarities !== "object") {
    result.ok = false;
    return result;
  }

  const seenIds = new Set<number>();
  for (const bucket of Object.values(j.rarities)) {
    if (!Array.isArray(bucket)) continue;
    for (const rec of bucket) {
      if (!rec || typeof rec !== "object") {
        result.invalidRecords++;
        continue;
      }
      const username = (rec.username ?? "").toString().trim();
      const avatarUrl = (rec.avatarUrl ?? "").toString().trim();
      const userId = (rec.discordId ?? "").toString().trim();
      const cardId = Number(rec.id);
      const role = (rec.role ?? "").toString();

      if (!username) {
        result.missingUsername++;
        result.invalidRecords++;
        continue;
      }
      if (!avatarUrl) {
        result.missingAvatar++;
        result.invalidRecords++;
        continue;
      }
      if (!userId || !Number.isFinite(cardId) || cardId <= 0) {
        result.invalidRecords++;
        continue;
      }
      if (seenIds.has(cardId)) {
        result.duplicateCardIds.push(`${cardId}:${username}`);
        result.invalidRecords++;
        continue;
      }
      const internal = roleToInternalRarity(role);
      if (!internal) {
        result.invalidRoles.push(`${role || "<empty>"}:${username}`);
        result.invalidRecords++;
        continue;
      }
      seenIds.add(cardId);
      result.counts[internal]++;
      result.total++;
      result.poolsNonEmpty[internal] = true;
    }
  }
  result.ok = result.invalidRecords === 0;
  return result;
}

// Re-export for convenience.
export { internalToVisualRarity };
