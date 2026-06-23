// api/pack/[cardId].js
// --------------------------------------------------------------------
// GET /api/pack/:cardId   → 200 OK, JSON metadata (extension optional)
//
// The PackManager contract builds the tokenURI as
//   baseURI + "/" + cardId + ".json"
// so the on-chain metadataURI looks like:
//
//   https://ritual-arenav0.vercel.app/api/pack/123.json
//
// This handler matches that path (with or without the `.json` suffix)
// and returns ERC-721 Metadata JSON Schema content sourced from
// public/data/ritual-pack-pool.json.
//
// The older /api/pack/metadata/[cardId].js handler remains for any
// legacy tokenURIs minted before the v8 pool was deployed.
// --------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { ok, bad, methodNotAllowed } from "../_lib/http.js";

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

  // Vercel dynamic param: req.query.cardId (or first path segment)
  const raw = req.query.cardId ?? "";
  // Strip a trailing ".json" if Vercel didn't already
  const idStr = String(raw).replace(/\.json$/i, "");
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return bad(res, 400, "cardId must be a positive integer");
  }

  const pool = loadPool();
  const card = findCardInPool(pool, id);
  if (!card) return bad(res, 404, "card not found in pool");

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
