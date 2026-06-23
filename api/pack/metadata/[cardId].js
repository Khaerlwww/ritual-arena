// api/pack/metadata/[cardId].js
// --------------------------------------------------------------------
// GET /api/pack/metadata/:cardId
//   -> ERC-721 Metadata JSON Schema response, served from the
//      ritual-pack-pool.json. The metadataURI stored on-chain
//      points here. (Testnet scope: served from the serverless
//      function rather than IPFS.)
//
// IMPORTANT: The pool JSON is structured as
//   { rarities: { COMMON: [...], RARE: [...], LEGENDARY: [...], ... } }
// — there is NO top-level `cards` array. The handler below flattens
// every bucket in `rarities` and finds the card by `id`.
// --------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { ok, bad, methodNotAllowed } from "../../_lib/http.js";

let cachedPool = null;
function loadPool() {
  if (cachedPool) return cachedPool;
  const candidates = [
    path.join(process.cwd(), "public", "data", "ritual-pack-pool.json"),
    path.join(process.cwd(), "..", "public", "data", "ritual-pack-pool.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      cachedPool = JSON.parse(fs.readFileSync(p, "utf8"));
      return cachedPool;
    }
  }
  cachedPool = { rarities: {} };
  return cachedPool;
}

/**
 * Flatten all records across every bucket of pool.rarities and find
 * the card whose `id` matches `cardId`. Returns null if not found.
 */
function findCardInPool(pool, cardId) {
  const rarities = pool && pool.rarities;
  if (!rarities || typeof rarities !== "object") return null;
  for (const bucket of Object.values(rarities)) {
    if (!Array.isArray(bucket)) continue;
    for (const rec of bucket) {
      if (rec && Number(rec.id) === cardId) return rec;
    }
  }
  return null;
}

export default function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const id = Number(req.query.cardId);
  if (!Number.isInteger(id)) return bad(res, 400, "cardId must be an integer");

  const pool = loadPool();
  const card = findCardInPool(pool, id);
  if (!card) return bad(res, 404, "card not found in pool");

  // ERC-721 Metadata JSON Schema (OpenSea compatible)
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  ok(res, {
    name: card.username ? `@${card.username}` : `Ritual Pack #${id}`,
    description:
      `A Ritual Arena pack card themed after @${card.username || "anonymous"} ` +
      `(${card.role || "BITTY"}). Owned on-chain as RitualPackNFT.`,
    image: card.avatarUrl || "",
    external_url: `https://ritual-arenav0.vercel.app/?cardId=${id}`,
    attributes: [
      { trait_type: "Role", value: card.role || "BITTY" },
      { trait_type: "Rarity", value: card.rarity || "RARE" },
      { trait_type: "CardId", value: id },
      { trait_type: "Source", value: "ritual-pack-pool" },
    ],
  });
}
