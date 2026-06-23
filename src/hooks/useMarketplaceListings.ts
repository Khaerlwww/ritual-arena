// src/hooks/useMarketplaceListings.ts
// Reads the active listings from RitualMarketplace and watches the
// marketplace events so the list refreshes automatically.

import { useEffect, useState, useCallback } from "react";
import { type Address } from "viem";
import { RITUAL_MARKETPLACE_ABI } from "../lib/marketplaceAbi";
import { envAddress, marketplaceAddress } from "../lib/chains";
import { publicClient } from "./useAnthem";
import { subscribeSharedWallet } from "../lib/wallet";

export interface MarketplaceListing {
  listingId: bigint;
  seller: Address;
  nftContract: Address;
  tokenId: bigint;
  priceAp: bigint;
  listedAt: number;
  active: boolean;
}

export interface UseMarketplaceListingsResult {
  listings: MarketplaceListing[];
  loading: boolean;
  error: Error | undefined;
  refetch: () => Promise<void>;
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;

function getMktAddress(): Address | undefined {
  return marketplaceAddress;
}

export function useMarketplaceListings(): UseMarketplaceListingsResult {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [nonce, setNonce] = useState(0);

  const mktAddress = getMktAddress();

  const refetch = useCallback(async () => {
    if (!mktAddress) {
      setListings([]);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const raw = (await publicClient.readContract({
        address: mktAddress,
        abi: RITUAL_MARKETPLACE_ABI,
        functionName: "getActiveListings",
        args: [],
      })) as readonly {
        listingId: bigint;
        seller: Address;
        nftContract: Address;
        tokenId: bigint;
        priceAp: bigint;
        listedAt: bigint;
        active: boolean;
      }[];
      setListings(
        raw.map((l) => ({
          listingId: l.listingId,
          seller: l.seller,
          nftContract: l.nftContract,
          tokenId: l.tokenId,
          priceAp: l.priceAp,
          listedAt: Number(l.listedAt),
          active: l.active,
        })),
      );
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [mktAddress]);

  useEffect(() => {
    void refetch();
  }, [refetch, nonce]);

  // Watch marketplace events (any of them bump the refetch nonce)
  useEffect(() => {
    if (!mktAddress) return;
    const unwatch = publicClient.watchContractEvent({
      address: mktAddress,
      abi: RITUAL_MARKETPLACE_ABI,
      onLogs: () => setNonce((n) => n + 1),
    });
    return () => {
      try {
        unwatch?.();
      } catch {
        /* noop */
      }
    };
  }, [mktAddress]);

  useEffect(() => subscribeSharedWallet(() => setNonce((n) => n + 1)), []);

  return { listings, loading, error, refetch };
}
