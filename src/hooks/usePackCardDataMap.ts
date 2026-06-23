// src/hooks/usePackCardDataMap.ts
// Resolve `cardData(tokenId)` for an arbitrary list of RitualPackNFT
// tokenIds (not just the connected wallet's own).
//
// V9 model: each NFT has packType, cardId, rarity, power, role, mintedAt.
// serialNumber + maxSupply come from PackManager (mintedByCardId / maxSupplyOf).
// Uses readCardWithSupplyBatch from packNftReads (single multicall per token).

import { useEffect, useState, useCallback } from "react";
import type { OwnedPackCard } from "./useOwnedPackNFTs";
import { readCardWithSupplyBatch } from "../lib/packNftReads";

export type PackCardMap = Record<string, OwnedPackCard | undefined>;

export function usePackCardDataMap(
  tokenIds: readonly bigint[],
): { cards: PackCardMap; loading: boolean; error: Error | undefined; refetch: () => Promise<void> } {
  const [cards, setCards] = useState<PackCardMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(async () => {
    if (tokenIds.length === 0) {
      setCards({});
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const settled = await readCardWithSupplyBatch(tokenIds);
      const next: PackCardMap = {};
      settled.forEach((decoded, i) => {
        const key = tokenIds[i].toString();
        if (decoded && decoded.cardId !== 0n) {
          next[key] = {
            tokenId: tokenIds[i],
            cardId: decoded.cardId,
            serialNumber: decoded.serialNumber,
            maxSupply: decoded.maxSupply,
            rarity: decoded.rarity,
            role: decoded.role,
            power: decoded.power,
            mintedAt: Number(decoded.mintedAt),
          };
        } else {
          next[key] = undefined;
        }
      });
      setCards(next);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [tokenIds.join(",")]);

  useEffect(() => {
    void refetch();
  }, [refetch, nonce]);

  return { cards, loading, error, refetch };
}
