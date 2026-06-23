// src/lib/contractDomains.ts
// EIP-712 domain + typed data builders shared by the FE. Must match
// the on-chain hash functions in contracts/pack/RitualPackNFT.sol
// and contracts/marketplace/RitualMarketplace.sol.

import type { Address } from "viem";

export const PACK_DOMAIN_NAME = "RitualPackNFT" as const;
export const MARKET_DOMAIN_NAME = "RitualMarketplace" as const;

export interface PackMintAuthFields {
  wallet: Address;
  packType: number;
  cardId: bigint;
  rarity: number;
  power: number;
  role: string;
  metadataURI: string;
  nonce: bigint;
  deadline: bigint;
}

export interface ReleaseAuthFields {
  listingId: bigint;
  buyer: Address;
  deadline: bigint;
}

export const PACK_MINT_TYPES = {
  PackMintAuth: [
    { name: "wallet", type: "address" },
    { name: "packType", type: "uint8" },
    { name: "cardId", type: "uint256" },
    { name: "rarity", type: "uint8" },
    { name: "power", type: "uint16" },
    { name: "role", type: "string" },
    { name: "metadataURI", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const RELEASE_TYPES = {
  ReleaseAuth: [
    { name: "listingId", type: "uint256" },
    { name: "buyer", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function packDomain(contractAddress: Address, chainId: number) {
  return {
    name: PACK_DOMAIN_NAME,
    version: "1",
    chainId,
    verifyingContract: contractAddress,
  } as const;
}

export function marketDomain(contractAddress: Address, chainId: number) {
  return {
    name: MARKET_DOMAIN_NAME,
    version: "1",
    chainId,
    verifyingContract: contractAddress,
  } as const;
}
