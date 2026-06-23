// api/card-image.js
// Dynamic NFT image route for Vercel serverless routing.
// Supports /api/card-image?tokenId=2 and /api/card-image/2 via vercel.json rewrite.

import { ethers } from "ethers";

// IdentityCard fallback: fresh deployment 2026-06-18.
const CANONICAL_IDENTITY_CARD = "0x6Ed1F2141419FDdBb7B19CCaca7d87aa02717A56";
const ANTHEM_ADDRESS = process.env.VITE_RITUAL_IDENTITY_CARD_ADDRESS || process.env.VITE_RITUAL_ANTHEM_ADDRESS || process.env.ANTHEM_ADDRESS || process.env.VITE_ANTHEM_ADDRESS || CANONICAL_IDENTITY_CARD;
const RPC_URL = process.env.RITUAL_RPC_URL || process.env.VITE_RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";

const ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getAnthem(address wallet) view returns (tuple(uint256 tokenId,address walletAddr,string xHandle,string mood,string lyrics,string musicPrompt,string audioURI,string metadataURI,uint256 createdAt))",
  "function getCardSnapshot(address wallet) view returns (tuple(uint256 tokenId,uint16 initialPower,uint16 currentPower,uint8 initialRarity,uint8 currentRarity,bytes32 initialSourceHash,bytes32 currentSourceHash,uint64 forgedAt,uint64 lastRefreshed,uint8 snapshotVersion))",
  "function isGenesisToken(uint256 tokenId) pure returns (bool)",
];

// Training contract — used to read the card's training level for the
// Visual Evolution Roadmap. Level is the single source of truth.
const TRAINING_ABI = [
  // V5-canon Training contract — verified on-chain.
  "function getCardProgress(uint256 tokenId) view returns (uint256 totalXp,uint256 level,uint256 currentLevelXp,uint256 xpToNextLevel,uint256 apEarned,uint256 trainCount,uint256 lastTrainedAt)",
  "function trainingHistoryCount(uint256 tokenId) view returns (uint256)",
  "function XP_PER_TRAIN() view returns (uint256)",
  "function AP_PER_TRAIN() view returns (uint256)",
  "function LEVEL_SIZE() view returns (uint256)",
  "function TRAINING_COOLDOWN_S() view returns (uint256)",
];

// IdentityRegistry — canonical source of truth for Identity Score.
// P0-2 fix: the card image and metadata MUST use the registry's getTotalScore
// instead of a locally invented formula. The registry is the only authoritative
// source per docs/IDENTITY.md and deployments/ritual-1979-current.json.
const REGISTRY_ABI = [
  "function getTotalScore(address wallet) view returns (uint256)",
];

// Visual Evolution Roadmap thresholds — mirror of src/lib/visualEvolution.ts.
const VE_THRESHOLDS = { iceFrame: 2, animatedBackground: 4, holographicLayer: 6, rareBorder: 8, ritualOgBadge: 12, prismAura: 16 };
function getVisualEvolutionUnlocks(level) {
  const lvl = Number(level);
  if (!Number.isFinite(lvl) || lvl <= 0) return { iceFrame: false, animatedBackground: false, holographicLayer: false, rareBorder: false, ritualOgBadge: false, prismAura: false };
  return {
    iceFrame: lvl >= VE_THRESHOLDS.iceFrame,
    animatedBackground: lvl >= VE_THRESHOLDS.animatedBackground,
    holographicLayer: lvl >= VE_THRESHOLDS.holographicLayer,
    rareBorder: lvl >= VE_THRESHOLDS.rareBorder,
    ritualOgBadge: lvl >= VE_THRESHOLDS.ritualOgBadge,
    prismAura: lvl >= VE_THRESHOLDS.prismAura,
  };
}

const RARITY_LABELS = ["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"];

function resolveTokenId(req) {
  const queryToken = req.query?.tokenId;
  if (Array.isArray(queryToken)) return queryToken[0];
  if (queryToken) return queryToken;

  const url = req.url || "";
  const match = url.match(/\/api\/card-image\/(\d+)/);
  return match?.[1];
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function shortWallet(wallet) {
  return wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "0x0000...0000";
}

function gradeColor(grade) {
  if (grade === "MYTHIC") return "#f7d774";
  if (grade === "LEGENDARY") return "#ff9f43";
  if (grade === "EPIC") return "#bd7cff";
  if (grade === "RARE") return "#63d2ff";
  return "#d8d8c8";
}

function buildSvg({ tokenId, handle, wallet, power, grade, identityScore, isGenesis, trainingLevel = 0 }) {
  const safeHandle = escapeXml(handle ? `@${handle}` : `Ritual #${tokenId}`);
  const safeWallet = escapeXml(shortWallet(wallet));
  const safeGrade = escapeXml(grade);
  const accent = gradeColor(grade);
  const genesisText = isGenesis ? "GENESIS IDENTITY" : "IDENTITY CARD";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" role="img" aria-label="Ritual Arena Identity Card">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&amp;display=swap');
      .handle { font-family: 'Open Sans', Helvetica, Arial, sans-serif; font-weight: 700; letter-spacing: 1px; }
      .heading { font-family: 'Open Sans', Helvetica, Arial, sans-serif; font-weight: 700; letter-spacing: 8px; }
      .body { font-family: 'Open Sans', Helvetica, Arial, sans-serif; font-weight: 400; }
      .body-bold { font-family: 'Open Sans', Helvetica, Arial, sans-serif; font-weight: 700; }
    </style>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#141414"/>
      <stop offset="0.45" stop-color="#272015"/>
      <stop offset="1" stop-color="#050505"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="36%" r="44%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.42"/>
      <stop offset="0.6" stop-color="${accent}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="1200" height="1200" fill="url(#bg)"/>
  <rect width="1200" height="1200" fill="url(#halo)"/>
  <rect x="64" y="64" width="1072" height="1072" rx="46" fill="none" stroke="${accent}" stroke-width="8"/>
  <rect x="100" y="100" width="1000" height="1000" rx="34" fill="rgba(0,0,0,0.28)" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>

  <g filter="url(#glow)">
    <circle cx="600" cy="400" r="196" fill="none" stroke="${accent}" stroke-width="10"/>
    <circle cx="600" cy="400" r="122" fill="none" stroke="rgba(255,255,255,0.34)" stroke-width="4"/>
    <path d="M600 178 L676 400 L600 622 L524 400 Z" fill="${accent}" opacity="0.72"/>
    <path d="M388 400 H812 M600 188 V612" stroke="#f4f0df" stroke-width="6" opacity="0.55"/>
  </g>

  <text x="600" y="158" text-anchor="middle" fill="#f7f0d8" class="heading" font-size="42">RITUAL ARENA</text>
  <text x="600" y="700" text-anchor="middle" fill="#ffffff" class="handle" font-size="72">${safeHandle}</text>
  <text x="600" y="760" text-anchor="middle" fill="${accent}" class="body-bold" font-size="32" letter-spacing="4">${genesisText}</text>

  <g class="body-bold">
    <rect x="180" y="835" width="240" height="120" rx="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.24)"/>
    <text x="300" y="880" text-anchor="middle" fill="#bfb8a4" font-size="24">POWER</text>
    <text x="300" y="930" text-anchor="middle" fill="#fff" font-size="48">${power}</text>

    <rect x="480" y="835" width="240" height="120" rx="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.24)"/>
    <text x="600" y="880" text-anchor="middle" fill="#bfb8a4" font-size="24">GRADE</text>
    <text x="600" y="930" text-anchor="middle" fill="${accent}" font-size="38">${safeGrade}</text>

    <rect x="780" y="835" width="240" height="120" rx="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.24)"/>
    <text x="900" y="880" text-anchor="middle" fill="#bfb8a4" font-size="24">IDENTITY</text>
    <text x="900" y="930" text-anchor="middle" fill="#fff" font-size="48">${identityScore}</text>
  </g>

  <text x="600" y="1035" text-anchor="middle" fill="#a69f8a" class="body" font-size="30">${safeWallet}</text>
  <text x="600" y="1084" text-anchor="middle" fill="#6f6a5b" class="body" font-size="24">TOKEN #${escapeXml(tokenId)}</text>
${renderVisualEvolutionSvg(getVisualEvolutionUnlocks(trainingLevel))}
</svg>`;
}

/**
 * Static SVG layers for the Visual Evolution Roadmap.
 * Mirrors the live UI + canvas renderer so the metadata image reflects
 * the same unlocked state at any training level.
 */
function renderVisualEvolutionSvg(u) {
  if (!u || (!u.iceFrame && !u.animatedBackground && !u.holographicLayer && !u.rareBorder && !u.ritualOgBadge && !u.prismAura)) {
    return "";
  }
  const layers = [];

  // Level 4 — Animated Background
  if (u.animatedBackground) {
    layers.push(`  <defs>
    <radialGradient id="ve-bg-a" cx="20%" cy="30%" r="60%">
      <stop offset="0" stop-color="#7dd3fc" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#7dd3fc" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ve-bg-b" cx="80%" cy="70%" r="55%">
      <stop offset="0" stop-color="#c9b8ff" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#c9b8ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="100" y="100" width="1000" height="1000" fill="url(#ve-bg-a)"/>
  <rect x="100" y="100" width="1000" height="1000" fill="url(#ve-bg-b)"/>`);
  }

  // Level 6 — Holographic Layer
  if (u.holographicLayer) {
    layers.push(`  <defs>
    <linearGradient id="ve-holo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.4" stop-color="#bae6fd" stop-opacity="0.45"/>
      <stop offset="0.55" stop-color="#ffd76a" stop-opacity="0.40"/>
      <stop offset="0.7" stop-color="#c9b8ff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="1000" height="1000" fill="url(#ve-holo)" style="mix-blend-mode:screen"/>`);
  }

  // Level 2 — Ice Profile Frame + Level 8 — Rare Border
  if (u.iceFrame || u.rareBorder) {
    const color = u.rareBorder ? "#c9b8ff" : "#bae6fd";
    const inset = u.rareBorder ? 110 : 105;
    const width = u.rareBorder ? 3 : 2;
    const filter = u.rareBorder ? ` filter="url(#glow)"` : "";
    layers.push(`  <rect x="${inset}" y="${inset}" width="${1200 - inset * 2}" height="${1200 - inset * 2}" rx="28" fill="none" stroke="${color}" stroke-width="${width}" opacity="0.85"${filter}/>`);
  }

  // Level 16 — Prism Aura
  if (u.prismAura) {
    layers.push(`  <defs>
    <radialGradient id="ve-aura" cx="50%" cy="50%" r="55%">
      <stop offset="0" stop-color="#7fe3d2" stop-opacity="0"/>
      <stop offset="0.6" stop-color="#7fe3d2" stop-opacity="0.20"/>
      <stop offset="0.8" stop-color="#c9b8ff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#7fe3d2" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="20" y="20" width="1160" height="1160" rx="60" fill="url(#ve-aura)"/>`);
  }

  // Level 12 — Ritual OG Badge
  if (u.ritualOgBadge) {
    layers.push(`  <g>
    <rect x="900" y="100" width="220" height="64" rx="32" fill="rgba(2,8,7,0.78)" stroke="#ffd76a" stroke-width="2"/>
    <text x="940" y="142" fill="#ffd76a" class="body-bold" font-size="32" letter-spacing="2">RITUAL OG</text>
  </g>`);
  }

  return layers.join("\n");
}

export default async function handler(req, res) {
  const tokenId = resolveTokenId(req);

  if (!tokenId || !/^\d+$/.test(String(tokenId))) {
    res.setHeader("Content-Type", "application/json");
    return res.status(400).json({ error: "Invalid tokenId" });
  }

  const tokenIdBig = BigInt(tokenId);
  if (tokenIdBig <= 0n || tokenIdBig > 1000000n) {
    res.setHeader("Content-Type", "application/json");
    return res.status(400).json({ error: "tokenId out of range" });
  }

  if (!ANTHEM_ADDRESS || !RPC_URL) {
    res.setHeader("Content-Type", "application/json");
    return res.status(503).json({ error: "Card image service not configured" });
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(ANTHEM_ADDRESS, ABI, provider);

    let owner;
    try {
      owner = await contract.ownerOf(tokenIdBig);
    } catch {
      res.setHeader("Content-Type", "application/json");
      return res.status(404).json({ error: "Token does not exist" });
    }

    const [anthem, snap, isGenesis] = await Promise.all([
      contract.getAnthem(owner),
      contract.getCardSnapshot(owner),
      contract.isGenesisToken(tokenIdBig),
    ]);

    const power = Number(snap.currentPower);
    const grade = RARITY_LABELS[Number(snap.currentRarity)] || "COMMON";

    // P0-2 fix: read the canonical Identity Score from the registry.
    // Never invent a score locally — the registry is the only source of
    // truth per docs/IDENTITY.md. If the registry is unreachable, the
    // image falls back to 0 and the SVG is still renderable.
    const REGISTRY_ADDRESS = process.env.VITE_RITUAL_IDENTITY_REGISTRY_ADDRESS || process.env.IDENTITY_REGISTRY_ADDRESS || process.env.VITE_IDENTITY_REGISTRY_ADDRESS;
    let identityScore = 0;
    if (REGISTRY_ADDRESS) {
      try {
        const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
        identityScore = Number(await registry.getTotalScore(owner));
      } catch (err) {
        console.warn("[card-image] registry getTotalScore failed for", owner, "— using 0:", err.shortMessage || err.message);
        identityScore = 0;
      }
    }

    // Read training level (Visual Evolution source of truth).
    const TRAINING_ADDRESS = process.env.VITE_RITUAL_TRAINING_ADDRESS || process.env.TRAINING_ADDRESS || process.env.VITE_TRAINING_ADDRESS;
    let trainingLevel = 0;
    if (TRAINING_ADDRESS) {
      try {
        const trainingContract = new ethers.Contract(TRAINING_ADDRESS, TRAINING_ABI, provider);
        // V5-canon: getCardProgress(tokenId) returns CardProgress struct.
        const progress = await trainingContract.getCardProgress(tokenIdBig);
        trainingLevel = Number(progress.level);
      } catch {
        trainingLevel = 0;
      }
    }

    const svg = buildSvg({
      tokenId,
      handle: anthem.xHandle,
      wallet: owner,
      power,
      grade,
      identityScore,
      isGenesis,
      trainingLevel,
    });

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=300");
    return res.status(200).send(svg);
  } catch (err) {
    console.error("[card-image] Error:", err.message);
    res.setHeader("Content-Type", "application/json");
    return res.status(500).json({ error: "Failed to render card image" });
  }
};
