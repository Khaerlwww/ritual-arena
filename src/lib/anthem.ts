import type { Address } from "viem";
import {
  mintId as makeMintId,
  pickArchetype,
  pickTraits,
  rarityFromScore,
  type Rarity,
} from "./rarity";
import { calcEvolutionPower, type EvolutionInput, type XData } from "./powerEngine";

export type MoodProfile = {
  mood: string;
  genre: string;
  archetype: string;
  bpmRange: [number, number];
  colorWord: string;
  gradient: [string, string, string];
  accent: string;
};

// Every mood stays within the emerald / teal / silver identity — distinguishable
// shades, never a rainbow. Gradients read as Teal Glow → mid teal → Deep Emerald.
export const moodProfiles: MoodProfile[] = [
  { mood: "TRIUMPHANT", genre: "epic orchestral / cinematic", archetype: "Victory Minter", bpmRange: [92, 116], colorWord: "luminous", gradient: ["#7fe3d2", "#48a89a", "#063a33"], accent: "#9ff0e0" },
  { mood: "MELANCHOLIC", genre: "lo-fi piano / sad beats", archetype: "Scarred Survivor", bpmRange: [68, 88], colorWord: "rain-soaked", gradient: ["#3a7d74", "#0a3b35", "#04201f"], accent: "#7fb8ae" },
  { mood: "CHAOTIC", genre: "phonk / aggressive", archetype: "Volatility Rider", bpmRange: [130, 158], colorWord: "fractured", gradient: ["#48a89a", "#063a33", "#0b0b0b"], accent: "#5fd0bd" },
  { mood: "RESILIENT", genre: "motivational hip hop", archetype: "Bridge Walker", bpmRange: [88, 104], colorWord: "iron", gradient: ["#6fb6aa", "#2f7d72", "#053931"], accent: "#9fd6cc" },
  { mood: "GIGABRAIN", genre: "jazzy / smooth", archetype: "Protocol Savant", bpmRange: [76, 96], colorWord: "velvet", gradient: ["#8af0df", "#3a9d8e", "#072928"], accent: "#a6f0e2" },
  { mood: "DEGEN", genre: "dark trap", archetype: "Night Market Degen", bpmRange: [122, 148], colorWord: "midnight", gradient: ["#48a89a", "#0a4f47", "#050505"], accent: "#5fd0bd" },
  { mood: "RITTY", genre: "old school boom bap", archetype: "Arena Veteran", bpmRange: [82, 98], colorWord: "silvered", gradient: ["#a0a8a6", "#3a7d74", "#063a33"], accent: "#c7d2cf" },
  { mood: "NORMIE", genre: "chill pop", archetype: "Fresh Wallet", bpmRange: [90, 112], colorWord: "soft", gradient: ["#9fd6cc", "#5aa99b", "#0a3b35"], accent: "#c2ece4" },
];

export type Anthem = {
  score: number;
  mood: string;
  genre: string;
  archetype: string;
  colorWord: string;
  lyrics: string;
  prompt: string;
  bpm: number;
  musicKey: string;
  audioURI: string;
  gradient: [string, string, string];
  accent: string;
  xHandle: string;
  // --- Rarity / collectible layer (deterministic, derived from the seed) ---
  seed: number;
  rarity: Rarity;
  cardArchetype: string; // DREAMER, ARCHITECT, … (collectible archetype)
  cardTraits: string[]; // up to 3 collectible traits
  mintId: string; // RA-YY-NNNN
  /**
   * Optional override for the portrait area. When set, the canvas renderer
   * loads this URL instead of the unavatar.io lookup. Used by Collection Pack
   * v5 cards to display Discord CDN avatars sourced from the pack pool JSON.
   * Falls back to the gradient + RitualMark if the image fails to load.
   */
  portraitUrl?: string;
};

const musicalKeys = ["A minor", "C# minor", "F lydian", "D dorian", "G minor", "Bb major", "E phrygian", "G mixolydian"];

export function hashWallet(wallet: string) {
  return wallet
    .toLowerCase()
    .split("")
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
}

/** Strip leading @ and keep only handle-safe characters. Tolerant
 * of undefined / null / non-string (treats them as empty). */
export function sanitizeHandle(raw: string | undefined | null) {
  return (raw ?? "").trim().replace(/^@+/, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15);
}

export function generateAnthem(wallet: string, xHandleRaw: string | undefined | null, opts?: { genesis?: boolean; onchainData?: EvolutionInput; xData?: XData }): Anthem {
  const xHandle = sanitizeHandle(xHandleRaw ?? "");
  const rawSeed = hashWallet(wallet + "|" + xHandle.toLowerCase());
  const seed = rawSeed || 7;
  const profile = moodProfiles[seed % moodProfiles.length];
  const [minBpm, maxBpm] = profile.bpmRange;
  const bpm = minBpm + (seed % (maxBpm - minBpm + 1));
  // Power score uses ONLY pre-mint on-chain activity.
  // No seed/hash/randomness for Power or Rarity.
  // If onchainData is not available, score is 0 (will be set at forge time).
  const score = opts?.onchainData ? calcEvolutionPower(opts.onchainData) : 0;
  const musicKey = musicalKeys[Math.floor(seed / 13) % musicalKeys.length];
  const chorus = score >= 80 ? "my signal rises through the Arena" : "every ritual strengthens my identity";
  const signer = xHandle ? `@${xHandle}` : wallet.slice(0, 6);

  const lyrics = `Identity Signal
${signer} forged an identity card on Ritual Chain.
Class ${profile.mood}. Role ${profile.archetype}. Power ${score}.
Training builds XP. Arena activity builds AP and rank.
Training and Arena activity shape progression.
${chorus}.`;

  const prompt = `Ritual Arena identity card for ${signer}; ${profile.mood} class; ${profile.archetype} role; ${profile.colorWord} cyber-terminal visual; ${profile.genre} audio identity; ${bpm} BPM; ${musicKey}`;

  return {
    score,
    mood: profile.mood,
    genre: profile.genre,
    archetype: profile.archetype,
    colorWord: profile.colorWord,
    lyrics,
    prompt,
    bpm,
    musicKey,
    audioURI: `ipfs://anthem-audio/${wallet.slice(2, 10)}-${profile.mood.toLowerCase()}.wav`,
    gradient: profile.gradient,
    accent: profile.accent,
    xHandle,
    seed,
    rarity: rarityFromScore(score, opts?.genesis ?? false),
    cardArchetype: pickArchetype(seed),
    cardTraits: pickTraits(seed, 3),
    mintId: makeMintId(seed),
  };
}

function utf8ToBase64(str: string) {
  if (typeof window === "undefined" || !window.btoa) return "";
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return window.btoa(bin);
}

/**
 * Resolve an X (Twitter) profile picture from a handle without an API key,
 * via the public unavatar resolver. Returns "" when no handle is given.
 */
export function avatarUrl(handleRaw: string) {
  const h = sanitizeHandle(handleRaw);
  return h ? `https://unavatar.io/x/${h}` : "";
}

function xmlEscape(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

/**
 * Self-contained gradient "mood card" SVG used as the NFT image when no X
 * handle is provided (kept small so it is cheap to store on-chain).
 */
export function moodCardSvgDataUri(anthem: Anthem) {
  const [a, b, c] = anthem.gradient;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
<rect width="600" height="600" fill="#050505"/><rect width="600" height="600" fill="url(#g)" opacity="0.20"/>
<circle cx="300" cy="250" r="120" fill="none" stroke="${anthem.accent}" stroke-width="8"/>
<text x="300" y="270" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="${anthem.accent}">${xmlEscape(anthem.mood.slice(0, 2))}</text>
<text x="300" y="430" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" font-weight="bold" fill="#ffffff">${xmlEscape(anthem.mood)}</text>
<text x="300" y="475" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#cbd5e1">${xmlEscape(anthem.archetype)}</text>
<text x="300" y="540" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="${anthem.accent}">${anthem.bpm} BPM · ${xmlEscape(anthem.musicKey)} · RITUAL ANTHEM</text>
</svg>`;
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}

export type AnthemMetadata = {
  name: string;
  description: string;
  image: string;
  external_url: string;
  animation_url: string;
  attributes: { trait_type: string; value: string | number }[];
};

/**
 * Build the ERC-721 metadata object.
 * @param image  Override the image (e.g. an ipfs:// URI). Defaults to the X
 *               profile picture, or a self-contained mood-card SVG.
 * @param audio  Override the animation_url (e.g. an ipfs:// audio URI).
 */
export function buildMetadata(
  anthem: Anthem,
  wallet: Address,
  image?: string,
  audio?: string,
  forgePower?: number,
  forgeRarity?: string,
): AnthemMetadata {
  const resolvedImage = image ?? (anthem.xHandle ? avatarUrl(anthem.xHandle) : moodCardSvgDataUri(anthem));
  const power = forgePower ?? anthem.score;
  const rarity = forgeRarity ?? anthem.rarity;
  return {
    name: `Ritual Arena Identity Card${anthem.xHandle ? ` - @${anthem.xHandle}` : ""}`,
    description: `${anthem.xHandle ? `@${anthem.xHandle}'s` : "A"} Ritual Arena Identity Card. Class: ${anthem.mood}. Role: ${anthem.archetype}. Grade: ${rarity}. Power: ${power}. Complete Training, earn Achievements, participate in Arena activity, and build an Identity Score.`,
    image: resolvedImage,
    external_url: anthem.xHandle ? `https://x.com/${anthem.xHandle}` : "",
    animation_url: audio ?? anthem.audioURI,
    attributes: [
      { trait_type: "Grade", value: rarity },
      { trait_type: "Class", value: anthem.mood },
      { trait_type: "Role", value: anthem.archetype },
      { trait_type: "Archetype", value: anthem.cardArchetype },
      { trait_type: "Class Ability", value: classAbility(anthem.mood).name },
      { trait_type: "Power", value: power },
      ...anthem.cardTraits.map((t, i) => ({ trait_type: `Trait ${i + 1}`, value: t })),
      { trait_type: "Forge ID", value: anthem.mintId },
      { trait_type: "Forge Power", value: power },
      { trait_type: "Forge Rarity", value: rarity },
      ...(anthem.xHandle ? [{ trait_type: "X", value: `@${anthem.xHandle}` }] : []),
    ],
  };
}

/** Inline data-URI metadata (fallback when IPFS pinning is not configured). */
export function buildMetadataUri(
  anthem: Anthem,
  wallet: Address,
  forgePower?: number,
  forgeRarity?: string,
) {
  return `data:application/json;base64,${utf8ToBase64(JSON.stringify(buildMetadata(anthem, wallet, undefined, undefined, forgePower, forgeRarity)))}`;
}

export type ShareCardData = {
  /** Finalized tokenId from the on-chain AnthemMinted event. */
  tokenId?: number;
  /** Finalized xHandle (e.g. "sharxlr"). Empty/missing → falls back to "my wallet". */
  xHandle?: string;
  /** Finalized power from the on-chain CardSnapshot (post-forge). */
  power: number;
  /** Rarity name — e.g. "INITIATE" | "BITTY" | "RITTY" | "RITUALIST" | "RADIANT". Lowercased in the output. */
  grade: string;
  /** Identity rank tier — e.g. "INITIATE" | "ASCENDANT" | ... Lowercased in
   *  the output. When null/undefined, the share text omits the rank line
   *  entirely (no fake "initiate" fallback). */
  identityRank: string | null;
  /** Finalized Identity Score from the registry snapshot. When null/
   *  undefined (registry has not yet recorded the wallet), the share
   *  text omits the score line — no fake "0" fallback. */
  identityScore?: number | null;
  /** Wallet address — included for downstream callers that want to extend the text. */
  wallet?: string;
  /** App URL — appended as the call to action. */
  appUrl: string;
};

/**
 * Build the "Share on X" text for a finalized forged card.
 *
 * Use ONLY finalized data (forgeSuccess, mintedItem, onchainAnthem, registry
 * snapshot) — never the pre-forge preview Anthem. Calling this with
 * undefined/missing fields renders explicit fallbacks rather than crashing.
 *
 * Output is intentionally short and natural. No corporate buzzwords, no
 * class ability text, no "Built through on-chain activity" boilerplate.
 *
 * Template:
 *   just forged my identity card on ritual arena
 *
 *   @{handle}        (or "my wallet" if no handle)
 *   power {power}
 *   grade {grade}
 *   rank {identityRank}
 *
 *   enter the arena
 *   {appUrl}
 */
export function buildShareText(data: ShareCardData): string {
  const handleLine = data.xHandle?.trim() ? `@${data.xHandle.trim()}` : "my wallet";
  const lines = [
    "just forged my identity card on ritual arena",
    "",
    handleLine,
    `power ${Math.max(1, data.power | 0)}`,
    `grade ${(data.grade || "common").toLowerCase()}`,
  ];
  // Only emit rank/score lines when the registry has provided a canonical
  // value. Null/undefined means the post-forge push hasn't landed yet —
  // we omit the line entirely rather than fake a "0 / initiate".
  if (data.identityRank != null) {
    lines.push(`rank ${(data.identityRank as string).toLowerCase()}`);
  }
  if (data.identityScore != null && data.identityScore > 0) {
    lines.push(`score ${data.identityScore}`);
  }
  lines.push("", "enter the arena", data.appUrl);
  return lines.join("\n");
}


// ---------------------------------------------------------------------------
// Ritual Arena — TCG layer (rebrand of the Anthem identity into a card)
// ---------------------------------------------------------------------------
// The on-chain data model is unchanged; this is the presentation/game framing:
//   Class = mood · Power = score · Grade = rarity · Role = archetype ·
//   Abilities = traits. Each Class also has one passive Duel ability.

/** Current Ritual Arena season (collectible footer). */
export const SEASON = 1;

export type ClassAbility = { name: string; desc: string };

/** Passive duel ability granted by a card's Class (mood). Keyed UPPERCASE. */
export const CLASS_ABILITIES: Record<string, ClassAbility> = {
  TRIUMPHANT: { name: "Rally", desc: "Support momentum compounds while this card is ahead in a duel." },
  MELANCHOLIC: { name: "Requiem", desc: "A lost duel returns part of its support as power next duel." },
  CHAOTIC: { name: "Wildcard", desc: "Each duel round applies a random support swing." },
  RESILIENT: { name: "Last Stand", desc: "Resists defeat once when power runs low." },
  GIGABRAIN: { name: "Efficiency", desc: "Spends fewer Arena Points per unit of support." },
  DEGEN: { name: "All-In", desc: "Doubles support impact — but with no fallback if it loses." },
  RITTY: { name: "Steadfast", desc: "Immune to support swings in the opening of a duel." },
  NORMIE: { name: "Underdog", desc: "Gains bonus power when dueling a higher-grade card." },
};

/** Resolve the passive duel ability for a Class (mood). Always returns a value. */
export function classAbility(className: string): ClassAbility {
  return CLASS_ABILITIES[(className || "").toUpperCase()] ?? { name: "Adapt", desc: "No passive duel bonus." };
}
