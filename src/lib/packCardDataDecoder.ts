// src/lib/packCardDataDecoder.ts
//
// Custom decoder for the deployed RitualPackNFT `cardData(uint256)`
// return data. The contract's runtime encoding does NOT follow standard
// Solidity ABI struct encoding — the dynamic `string role` field is
// placed at its declaration position (word 4, offset 128) rather than
// after all the trailing static fields. viem's built-in tuple decoder
// assumes standard reordering and reads word 4 as `mintedAt`, which
// points the role offset at word 5's 0x19ed4004640 value (ms timestamp)
// and explodes with "Position 49153 out of bounds".
//
// Data layout (verified against on-chain raw eth_call):
//   word 0  (off 0-31):   packType (uint8, last byte)
//   word 1  (off 32-63):  cardId   (uint256)
//   word 2  (off 64-95):  rarity   (uint8, last byte)
//   word 3  (off 96-127): power    (uint16, last 2 bytes)
//   word 4  (off 128-159): role offset pointer (uint256, points to 0xC0 = 192)
//   word 5  (off 160-191): mintedAt (uint64, last 8 bytes)
//   word 6+ (off 192+):   role length + UTF-8 content
//
// This decoder reads the raw hex (without 0x prefix) and parses each
// field in the actual on-chain order. Drop-in replacement for viem's
// tuple decode.

export interface DecodedCardData {
  packType: number;
  cardId: bigint;
  rarity: number;
  power: number;
  role: string;
  mintedAt: bigint;
}

const ROLE_OFFSET_DEFAULT = 192; // 6 words * 32 bytes

function hexToBigInt(hex: string): bigint {
  if (!hex) return 0n;
  return BigInt("0x" + hex);
}

function lastByte(hex: string): number {
  return parseInt(hex.slice(-2), 16);
}

function lastTwoBytes(hex: string): number {
  return parseInt(hex.slice(-4), 16);
}

function utf8FromHex(hex: string): string {
  if (!hex) return "";
  // Drop trailing zero-padding to the nearest byte.
  // Find the last non-zero byte.
  let i = hex.length;
  while (i > 0 && hex.slice(i - 2, i) === "00") i -= 2;
  if (i === 0) return "";
  const bytes: number[] = [];
  for (let j = 0; j < i; j += 2) {
    bytes.push(parseInt(hex.slice(j, j + 2), 16));
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    // Fallback: latin-1 safe conversion.
    return String.fromCharCode(...bytes);
  }
}

/**
 * Decode the raw `cardData(uint256)` return data into a typed struct.
 * @param data 0x-prefixed hex string from eth_call / multicall returnData
 * @param totalLen declared length of the string (in bytes) — used to trim
 *                 trailing zero-pad bytes that viem includes for variable-size
 *                 return payloads. If omitted, uses the full hex length.
 */
export function decodeCardData(data: string, totalLen?: number): DecodedCardData | undefined {
  if (!data || data === "0x") return undefined;
  let hex = data.startsWith("0x") ? data.slice(2) : data;
  // Trim to the declared length if shorter than what was returned (caller
  // passes the byte length from the multicall result metadata).
  if (totalLen !== undefined) {
    const want = totalLen * 2;
    if (hex.length > want) hex = hex.slice(0, want);
  }
  if (hex.length < 192) return undefined; // not enough data

  const packTypeHex = hex.slice(0, 64);
  const cardIdHex = hex.slice(64, 128);
  const rarityHex = hex.slice(128, 192);
  const powerHex = hex.slice(192, 256);
  const roleOffsetHex = hex.slice(256, 320);
  const mintedAtHex = hex.slice(320, 384);

  const roleOffset = Number(hexToBigInt(roleOffsetHex));
  // roleOffset is in bytes from the start of the return data.
  // Convert to hex character offset (each byte = 2 hex chars).
  let roleDataHex = "";
  if (roleOffset > 0 && roleOffset * 2 + 64 <= hex.length) {
    roleDataHex = hex.slice(roleOffset * 2, roleOffset * 2 + 64);
    // The first 32 hex bytes (64 chars) is the length, the rest is content.
    const lengthBytes = Number(hexToBigInt(roleDataHex.slice(0, 64)));
    if (lengthBytes > 0) {
      // The content starts immediately after the length word (in bytes).
      const contentStart = roleOffset * 2 + 64; // 32-byte length word ends at roleOffset + 32
      const contentEnd = contentStart + lengthBytes * 2;
      if (contentEnd <= hex.length) {
        roleDataHex = hex.slice(contentStart, contentEnd);
      } else if (lengthBytes <= 32) {
        // Content fits inside the same 32-byte word as the length.
        // Layout: length (32-N bytes) | content (N bytes) | zeros
        const contentHex = hex.slice(roleOffset * 2 + 64, roleOffset * 2 + 64 + lengthBytes * 2);
        roleDataHex = contentHex;
      } else {
        // Out-of-bounds: clamp to whatever is available.
        roleDataHex = hex.slice(contentStart);
      }
    } else {
      roleDataHex = "";
    }
  }

  return {
    packType: lastByte(packTypeHex),
    cardId: hexToBigInt(cardIdHex),
    rarity: lastByte(rarityHex),
    power: lastTwoBytes(powerHex),
    role: utf8FromHex(roleDataHex),
    mintedAt: hexToBigInt(mintedAtHex),
  };
}

/**
 * Decode a list of raw returnData blobs (from multicall with
 * allowFailure: true) into a list of DecodedCardData.
 * The first byte in the multicall sub-result is the success flag;
 * the rest is the ABI-encoded return data — we strip the 32-byte
 * offset prefix viem adds for `bytes` returns.
 */
export function decodeCardDataResults(rawResults: readonly (string | undefined)[]): (DecodedCardData | undefined)[] {
  return rawResults.map((raw) => {
    if (!raw || raw === "0x") return undefined;
    return decodeCardData(raw);
  });
}
