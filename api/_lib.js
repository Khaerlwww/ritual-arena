// api/_lib.js
// Pure helper functions shared between api/metadata.js, api/card-image.js,
// and the api test suite. No I/O, no env reads — easy to unit-test.
//
// RANK_NAMES is the server-side mirror of src/lib/identityRanks.ts
// (RANK_LABELS). The two MUST stay in sync. If you add or rename a tier
// in the contract, update both. Server is JavaScript (ESM — "type": "module"
// in package.json) so we mirror the literal here.

export const RARITY_LABELS = ["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"];
export const RANK_NAMES = ["INITIATE", "ASCENDANT", "BITTY", "RITTY", "RITUALIST", "RADIANT RITUALIST"];
const RANK_UNKNOWN = "UNKNOWN";

export function rarityLabel(rank) {
  return RARITY_LABELS[rank] || "COMMON";
}

export function rankName(rankIndex) {
  // Unknown rank uint8 must not silently become "INITIATE". Log a
  // server-side warning so the operator notices contract drift.
  if (typeof rankIndex !== "number" || !Number.isInteger(rankIndex) || rankIndex < 0 || rankIndex >= RANK_NAMES.length) {
    if (typeof console !== "undefined") {
      console.warn(`[api/_lib] unknown rank uint8 from registry: ${rankIndex}`);
    }
    return RANK_UNKNOWN;
  }
  return RANK_NAMES[rankIndex];
}

/**
 * Build the OpenSea description. P0-5 fix: a freshly forged card has
 * currentPower=1, currentRarity=0 — those values are hard-coded in
 * IdentityCard._mintAnthem and never represent evolution. Only describe
 * the card as "Evolved" once it has actually been trained.
 */
export function buildDescription({ xHandle, currentPower, currentRarity }) {
  const handlePart = xHandle ? `@${xHandle}'s` : "A";
  const base = `${handlePart} Ritual Arena Identity Card. Power ${currentPower} | Grade: ${RARITY_LABELS[currentRarity] || "COMMON"}.`;
  if (currentPower > 1 || currentRarity > 0) {
    return `${base} Evolved through Training and Arena activity.`;
  }
  return `${base}`;
}

/**
 * P0-4 fix: Ritual Chain block.timestamp is in MILLISECONDS. Both the
 * contract's `block.timestamp <= expiry` check and the client (Date.now()
 * + offset) operate in milliseconds. The server's expiry validation MUST
 * use the same unit.
 */
export function isExpiredMs(expiryMs, nowMs) {
  if (typeof expiryMs !== "bigint" && typeof expiryMs !== "number") return true;
  const exp = BigInt(expiryMs);
  const now = BigInt(nowMs ?? Date.now());
  return exp <= now;
}
