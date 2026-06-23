// ---------------------------------------------------------------------------
// PackResultCard — display shape for a single opened pack card.
//
// Minimal type extracted from the deleted V4 packEngine.ts. This file is the
// ONLY source of truth for the display shape used by the gallery, market,
// pack window, and card renderer.
//
// In V5+ the source of truth for ownership is the on-chain RitualPackNFT
// (read via useOwnedPackNFTs). Each component constructs a PackResultCard
// from the on-chain OwnedPackCard + a presentation pool lookup. No client
// code mints or scores cards — pack opening is contract-driven.
//
// V4 engine concerns (RNG, drop tables, guarantee counter, localStorage
// ledger, off-chain open functions) are intentionally NOT re-exported here.
// ---------------------------------------------------------------------------

import type { InternalRarity, Rarity } from "../lib/rarity";

export interface PackResultCard {
  cardId: number;
  userId: string;
  username: string;
  avatarUrl: string;
  rarity: InternalRarity;
  visualRarity: Rarity;
  power: number;
  /** Role from on-chain cardData (e.g. "INITIATE", "RITUAL"). Empty string for legacy. */
  role: string;
  traits: string[];
  generation: number; // season
  /** Per-rarity serial in "current / maxSupply" form, e.g. "11 / 100". */
  serial: string;
  /** Zero-based serial number within the rarity (1-indexed for display). */
  serialNumber: number;
  /** Mirror of PoolCard.mintedSupply AT TIME OF MINT. */
  mintedSerial: number;
  /**
   * Owning wallet address (lowercased). "guest" if minted without a
   * connected wallet. Permanent on the card instance — never reassigned.
   */
  owner: string;
  /** Unix epoch milliseconds at the moment the card was awarded. */
  acquiredAt: number;
  /** UUID-style instance id (used as React key + stable sort tiebreaker). */
  instanceId: string;
}
