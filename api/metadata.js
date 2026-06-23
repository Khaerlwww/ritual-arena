// api/metadata.js
// Compatibility route for Vercel non-Next serverless routing.
// Supports /api/metadata?tokenId=2 and /api/metadata/2 via vercel.json rewrite.

import { ethers } from "ethers";
import { buildDescription, rankName } from "./_lib.js";

// Fallback chain (in priority order): canonical VITE_RITUAL_IDENTITY_CARD_ADDRESS
// → legacy anthem env vars → hardcoded fresh deployment (2026-06-18).
const CANONICAL_IDENTITY_CARD = "0x6Ed1F2141419FDdBb7B19CCaca7d87aa02717A56";
const ANTHEM_ADDRESS = process.env.VITE_RITUAL_IDENTITY_CARD_ADDRESS || process.env.VITE_RITUAL_ANTHEM_ADDRESS || process.env.ANTHEM_ADDRESS || process.env.VITE_ANTHEM_ADDRESS || CANONICAL_IDENTITY_CARD;
const RPC_URL = process.env.RITUAL_RPC_URL || process.env.VITE_RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://ritual-arenav0.vercel.app");

const ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getAnthem(address wallet) view returns (tuple(uint256 tokenId,address walletAddr,string xHandle,string mood,string lyrics,string musicPrompt,string audioURI,string metadataURI,uint256 createdAt))",
  "function getCardSnapshot(address wallet) view returns (tuple(uint256 tokenId,uint16 initialPower,uint16 currentPower,uint8 initialRarity,uint8 currentRarity,bytes32 initialSourceHash,bytes32 currentSourceHash,uint64 forgedAt,uint64 lastRefreshed,uint8 snapshotVersion))",
  "function isGenesisToken(uint256 tokenId) pure returns (bool)",
];

// P0-2 fix: Identity Score MUST come from the registry, not a local formula.
const REGISTRY_ABI = [
  "function getTotalScore(address wallet) view returns (uint256)",
  "function getRank(address wallet) view returns (uint8)",
];

const RARITY_LABELS = ["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"];

function rarityLabel(rank) {
  return RARITY_LABELS[rank] || "COMMON";
}

function formatTimeAgo(timestampMs) {
  if (!timestampMs || timestampMs === 0n) return "Never";
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestampMs)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function resolveTokenId(req) {
  const queryToken = req.query?.tokenId;
  if (Array.isArray(queryToken)) return queryToken[0];
  if (queryToken) return queryToken;

  // Fallback for direct invocation paths like /api/metadata/2 if Vercel passes URL only.
  const url = req.url || "";
  const match = url.match(/\/api\/metadata\/(\d+)/);
  return match?.[1];
}

export default async function handler(req, res) {
  const tokenId = resolveTokenId(req);

  if (!tokenId || !/^\d+$/.test(String(tokenId))) {
    return res.status(400).json({ error: "Invalid tokenId" });
  }

  const tokenIdBig = BigInt(tokenId);
  if (tokenIdBig <= 0n || tokenIdBig > 1000000n) {
    return res.status(400).json({ error: "tokenId out of range" });
  }

  if (!ANTHEM_ADDRESS || !RPC_URL) {
    return res.status(503).json({
      error: "Metadata service not configured",
      hint: "Set ANTHEM_ADDRESS and RITUAL_RPC_URL in Vercel environment variables.",
    });
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(ANTHEM_ADDRESS, ABI, provider);

    let owner;
    try {
      owner = await contract.ownerOf(tokenIdBig);
    } catch {
      return res.status(404).json({ error: "Token does not exist" });
    }

    const anthem = await contract.getAnthem(owner);
    const snap = await contract.getCardSnapshot(owner);

    const currentPower = Number(snap.currentPower);
    const currentRarity = Number(snap.currentRarity);
    const initialPower = Number(snap.initialPower);
    const initialRarity = Number(snap.initialRarity);
    const grade = rarityLabel(currentRarity);
    const initialGrade = rarityLabel(initialRarity);
    const isGenesis = await contract.isGenesisToken(tokenIdBig);
    const lastEvolved = formatTimeAgo(snap.lastRefreshed);

    // P0-2 fix: read canonical Identity Score + Rank from the registry.
    // Never invent a score locally — the registry is the only source of
    // truth per docs/IDENTITY.md. Falls back to 0 / INITIATE if the
    // registry is unreachable (still a renderable metadata response).
    const REGISTRY_ADDRESS = process.env.VITE_RITUAL_IDENTITY_REGISTRY_ADDRESS || process.env.IDENTITY_REGISTRY_ADDRESS || process.env.VITE_IDENTITY_REGISTRY_ADDRESS;
    let identityScore = 0;
    let identityRankIndex = 0;
    if (REGISTRY_ADDRESS) {
      try {
        const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
        const [score, rank] = await Promise.all([
          registry.getTotalScore(owner),
          registry.getRank(owner),
        ]);
        identityScore = Number(score);
        identityRankIndex = Number(rank);
      } catch (err) {
        console.warn("[metadata] registry read failed for", owner, "— using 0/INITIATE:", err.shortMessage || err.message);
        identityScore = 0;
        identityRankIndex = 0;
      }
    }
    const identityRank = rankName(identityRankIndex);

    const metadata = {
      name: `Ritual Arena #${tokenId}`,
      description: buildDescription({ xHandle: anthem.xHandle, currentPower, currentRarity }),
      image: `${PUBLIC_APP_URL}/api/card-image/${tokenId}`,
      external_url: "https://ritual-arenav0.vercel.app",
      attributes: [
        { trait_type: "Power", value: currentPower },
        { trait_type: "Grade", value: grade },
        { trait_type: "Rarity Rank", value: currentRarity },
        { trait_type: "Identity Score", value: identityScore },
        { trait_type: "Identity Rank", value: identityRank },
        { trait_type: "Initial Power", value: initialPower },
        { trait_type: "Initial Grade", value: initialGrade },
        { trait_type: "Snapshot Version", value: Number(snap.snapshotVersion) },
        { trait_type: "Last Evolved", value: lastEvolved },
        { trait_type: "Genesis", value: isGenesis },
      ],
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60");
    return res.status(200).json(metadata);
  } catch (err) {
    console.error("[metadata] Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch metadata" });
  }
};
