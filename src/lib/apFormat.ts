// src/lib/apFormat.ts
// Shared AP (RitualAP ERC-20) formatting helpers. All AP values on-chain
// are stored in wei (18 decimals). These helpers are the single source of
// truth for converting those bigint wei values into human-readable AP for
// UI display.
//
// Why formatUnits instead of Number(bigint) / 1e18?
//   - Number(bigint) loses precision for values > 2^53 (wei of > ~9 AP)
//   - formatUnits returns a string with full precision; Number(string)
//     gives a number that's correct up to the displayed digits
//   - For totals (e.g. totalClaimedGlobal, cap) approaching 21M AP this
//     still fits in Number safely, but the precision of fractional AP is
//     preserved

import { formatUnits } from "viem";

/** RitualAP ERC-20 decimals — always 18. */
export const AP_DECIMALS = 18;

/** AP_DECIMALS as a bigint (for bigint arithmetic). */
export const AP_DECIMALS_BIGINT = 10n ** BigInt(AP_DECIMALS);

/**
 * Convert a wei bigint to a JS number in AP units. Safe for any value
 * that fits in a 64-bit double (≈ 9 quadrillion AP, far above the 21M
 * supply cap). Returns 0 for null/undefined.
 */
export function toApNumber(wei: bigint | null | undefined): number {
  if (wei === null || wei === undefined) return 0;
  return Number(formatUnits(wei, AP_DECIMALS));
}

/**
 * Convert a wei bigint to a JS number in AP units with a custom decimals
 * parameter. Use this only when the on-chain decimals() call is in play
 * (currently it always returns 18, but the helper accepts a parameter
 * to stay robust if the contract decimals ever differ).
 */
export function toApNumberDecimals(wei: bigint | null | undefined, decimals: number): number {
  if (wei === null || wei === undefined) return 0;
  return Number(formatUnits(wei, decimals));
}

/**
 * Format a wei bigint as a human-readable AP string for UI display.
 *   formatAp(10000000000000000000n) -> "10"
 *   formatAp(1500000000000000000n)  -> "1.5"
 *   formatAp(0n)                    -> "0"
 * Returns "0" for null/undefined.
 */
export function formatAp(wei: bigint | null | undefined, maxFractionDigits = 4): string {
  if (wei === null || wei === undefined) return "0";
  const s = formatUnits(wei, AP_DECIMALS);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
}

/**
 * Format a wei bigint as a compact AP string (2 decimals, trimmed).
 *   formatApShort(10000000000000000000n) -> "10"
 *   formatApShort(1234567890123456789n)  -> "1.23"
 */
export function formatApShort(wei: bigint | null | undefined): string {
  return formatAp(wei, 2);
}

/** Re-export for callers that need to compose. */
export { formatUnits };
