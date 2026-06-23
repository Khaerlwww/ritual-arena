// src/lib/packCardToAnthem.ts
// Shared translator: PackResultCard (pack-open event) → Anthem (canvas renderer).
// Used by CollectionCard (gallery) and PackOpeningFlow (reveal overlay).
// Keeps both visuals identical — pack-open reveal uses the same canvas template
// as the collection gallery, so what users see in the cinematic is exactly
// what they'll see in their collection afterwards.

import type { Anthem } from "./anthem";
import type { PackResultCard } from "../types/packCard";

const FALLBACK_GRADIENTS: Record<string, [string, string, string]> = {
  INITIATE:   ["#aab3b8", "#3a7d74", "#063a33"],
  BITTY:      ["#7dd3fc", "#48a89a", "#063a33"],
  RITTY:      ["#22d3ee", "#3a9d8e", "#072928"],
  RITUALIST:  ["#ffd76a", "#f5c542", "#1a1300"],
  RADIANT:    ["#c084fc", "#7a5cff", "#0d0822"],
  GENESIS:    ["#f472b6", "#9b8cff", "#100b1a"],
};

const ACCENT_BY_VISUAL: Record<string, string> = {
  INITIATE:   "#dfe6e9",
  BITTY:      "#7dd3fc",
  RITTY:      "#22d3ee",
  RITUALIST:  "#ffd76a",
  RADIANT:    "#c9b8ff",
  GENESIS:    "#f472b6",
};

/**
 * Translate a PackResultCard into the Anthem shape consumed by the
 * shared canvas renderer (cardImage.ts). Only the seven "inject" fields
 * are meaningful; other Anthem fields get deterministic placeholders.
 */
export function packResultToAnthem(card: PackResultCard): Anthem {
  const visualKey = String(card.visualRarity ?? "BITTY");
  const seed = (Number(card.cardId || 0) * 2654435761) ^ (Number(card.serialNumber || 0) * 1597334677);
  const grad = FALLBACK_GRADIENTS[visualKey] ?? FALLBACK_GRADIENTS.BITTY;
  return {
    score: Number(card.power || 0),
    mood: card.visualRarity as Anthem["mood"],
    genre: "ritual chain archive",
    archetype: card.rarity as Anthem["archetype"],
    colorWord: "archived",
    lyrics: "",
    prompt: "",
    bpm: 0,
    musicKey: "",
    audioURI: "",
    gradient: grad,
    accent: ACCENT_BY_VISUAL[visualKey] ?? "#9ff0e0",
    xHandle: card.username,
    seed,
    rarity: card.visualRarity as Anthem["rarity"],
    cardArchetype: card.rarity as Anthem["cardArchetype"],
    cardTraits: card.traits,
    mintId: `RA-${String(card.generation || 1).padStart(2, "0")}-${String(card.serialNumber || 0).padStart(4, "0")}`,
    portraitUrl: card.avatarUrl,
  };
}

export const PACK_CARD_FALLBACK_GRADIENTS = FALLBACK_GRADIENTS;
export const PACK_CARD_ACCENT_BY_VISUAL = ACCENT_BY_VISUAL;
