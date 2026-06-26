// src/lib/packNftReads.ts
// Shared RitualPackNFT current read helpers. The struct returned by
// `cardData(tokenId)` matches contracts/pack/RitualPackNFT.sol:
//   (uint8 packType, uint256 cardId, uint8 rarity, uint16 power, string role, uint64 mintedAt)
//
// IMPORTANT: In the current runtime, `serialNumber` and `maxSupply` are NOT stored on the
// NFT. They live on PackManager:
//   - serialNumber = PackManager.mintedByCardId(cardId)        // increments on every mint
//   - maxSupply    = PackManager.maxSupplyOf(cardId)           // set on pool-card add
// Use `readCardWithSupply` to fetch all fields + supply in one multicall.
//
// Used by:
//   - useOwnedPackNFTs (one-card reads in a multicall)
//   - useOpenPack (post-mint reads so PackWindow can render the
//     freshly opened card right away, without waiting for the
//     CardMinted watcher to trigger a gallery refetch)

import { type Address, encodeFunctionData } from "viem";
import { RITUAL_PACK_NFT_ABI } from "./packNftAbi";
import { PACK_MANAGER_ABI } from "./packManagerAbi";
import { decodeCardData } from "./packCardDataDecoder";
import { publicClient } from "../hooks/useAnthem";
import {
  packNftAddress as CANONICAL_PACK_NFT_ADDRESS,
  packManagerAddress as CANONICAL_PACK_MANAGER_ADDRESS,
} from "./chains";

/**
 * Current CardData struct from RitualPackNFT.cardData(tokenId).
 * On-chain tuple order: packType, cardId, rarity, power, role, mintedAt.
 */
export interface DecodedCardData {
  packType: number;
  cardId: bigint;
  rarity: number;
  power: number;
  role: string;
  mintedAt: bigint;
}

/**
 * Card + supply (combined view used by UI). Serial + maxSupply are
 * read from PackManager, not the NFT.
 */
export interface DecodedCardWithSupply extends DecodedCardData {
  tokenId: bigint;
  serialNumber: bigint;
  maxSupply: bigint;
}

// Find the `cardData` ABI item once at module load — used for both
// the encoded call and the decoded result.
const CARD_DATA_ABI_ITEM = (
  RITUAL_PACK_NFT_ABI as {
    type: string;
    name: string;
    stateMutability: string;
    inputs: { name: string; type: string }[];
    outputs: unknown[];
  }[]
).find((x) => x.type === "function" && x.name === "cardData")!;

// Current Pack NFT — canonical address from chains.ts (single source of truth).
export const PACK_NFT_ADDRESS: Address = CANONICAL_PACK_NFT_ADDRESS;
export const PACK_MANAGER_ADDRESS: Address = CANONICAL_PACK_MANAGER_ADDRESS;

export function getPackNftAddress(): Address {
  return PACK_NFT_ADDRESS;
}

export function getPackNftAddressOrDefault(): Address {
  return PACK_NFT_ADDRESS;
}

/**
 * Read the on-chain cardData for a single tokenId.
 * Returns undefined on failure (missing token, contract revert, RPC drop).
 */
export async function readCardData(
  packAddress: Address,
  tokenId: bigint,
): Promise<DecodedCardData | undefined> {
  try {
    const callData = encodeFunctionData({
      abi: [CARD_DATA_ABI_ITEM],
      functionName: "cardData",
      args: [tokenId],
    });
    const result = await publicClient.call({ to: packAddress, data: callData });
    const data = (result.data ?? "0x") as `0x${string}`;
    if (!data || data === "0x") return undefined;
    // Use the custom decoder (packCardDataDecoder) instead of viem's
    // decodeFunctionResult — viem 2.52.x misreads the dynamic `role`
    // offset inside a tuple-with-string and throws "Position 49153 out
    // of bounds". The custom decoder reads the raw layout that the
    // deployed RitualPackNFT actually emits.
    return decodeCardData(data);
  } catch {
    return undefined;
  }
}

/**
 * Read cardData + supply (serialNumber + maxSupply) for a single tokenId.
 * One multicall per token: cardData + mintedByCardId + maxSupplyOf.
 */
export async function readCardWithSupply(
  tokenId: bigint,
): Promise<DecodedCardWithSupply | undefined> {
  if (!PACK_NFT_ADDRESS || !PACK_MANAGER_ADDRESS) return undefined;
  try {
    const cardData = await readCardData(PACK_NFT_ADDRESS, tokenId);
    if (!cardData) return undefined;
    // Pull serial + maxSupply from PackManager in parallel.
    const [serial, max] = await Promise.all([
      publicClient.readContract({
        address: PACK_MANAGER_ADDRESS,
        abi: PACK_MANAGER_ABI,
        functionName: "mintedByCardId",
        args: [cardData.cardId],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: PACK_MANAGER_ADDRESS,
        abi: PACK_MANAGER_ABI,
        functionName: "maxSupplyOf",
        args: [cardData.cardId],
      }) as Promise<bigint>,
    ]);
    return {
      ...cardData,
      tokenId,
      serialNumber: serial,
      maxSupply: max,
    };
  } catch {
    return undefined;
  }
}

/**
 * Read card + supply for a batch of tokenIds in parallel. Order is preserved.
 * Slots that fail or return zeroed data are mapped to undefined so callers
 * can filter them.
 */
export async function readCardWithSupplyBatch(
  tokenIds: readonly bigint[],
): Promise<(DecodedCardWithSupply | undefined)[]> {
  return Promise.all(tokenIds.map((tid) => readCardWithSupply(tid)));
}
