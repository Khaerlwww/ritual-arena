// src/hooks/useOwnedPackNFTs.ts
// Reads the list of RitualPackNFT tokenIds owned by `address` from chain
// (via the contract's `tokensOfOwnerByIndex`), then loads each token's
//   `cardData` in parallel using the shared `readCardData` helper.
//
// This is the **source of truth** — localStorage is never used for
// ownership. The pack engine stores only animation/cache state in
// localStorage; the chain is authoritative.

import { useEffect, useState, useCallback, useRef } from "react";
import { type Address } from "viem";
import { RITUAL_PACK_NFT_ABI } from "../lib/packNftAbi";
import { publicClient } from "./useAnthem";
import { getSharedAddress, subscribeSharedWallet } from "../lib/wallet";
import { readCardWithSupplyBatch } from "../lib/packNftReads";
import { packNftAddress as CANONICAL_PACK_NFT_ADDRESS } from "../lib/chains";
import { on } from "../lib/eventBus";

export interface OwnedPackCard {
  tokenId: bigint;
  cardId: bigint;
  serialNumber: bigint;
  maxSupply: bigint;
  rarity: number;
  role: string;
  power: number;
  mintedAt: number;
}

export interface UseOwnedPackNFTsResult {
  cards: OwnedPackCard[];
  loading: boolean;
  error: Error | undefined;
  refetch: () => Promise<void>;
}

const CURRENT_PACK_NFT_ADDRESS = CANONICAL_PACK_NFT_ADDRESS;

export function useOwnedPackNFTs(address?: Address): UseOwnedPackNFTsResult {
  const [cards, setCards] = useState<OwnedPackCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [nonce, setNonce] = useState(0);
  // requestSeq is monotonic per-refetch token. Each refetch captures the
  // current value; only the latest in-flight refetch is allowed to call
  // setCards. Prevents an older, slower RPC response from overwriting a
  // newer, fresher one (which is what caused Ritual Pack NFTs to be
  // hidden behind stale Initiate Pack reads after multi-stage refetch
  // bursts on tx-success).
  // v2 build marker 2026-06-21 00:59
  const requestSeqRef = useRef(0);

  const wallet = (address ?? getSharedAddress())?.toLowerCase() as
    | Address
    | undefined;
  const packNftAddress: Address = CURRENT_PACK_NFT_ADDRESS as Address;

  const refetch = useCallback(async () => {
    if (!wallet || !packNftAddress) {
      setCards([]);
      return;
    }
    const mySeq = ++requestSeqRef.current;
    setLoading(true);
    setError(undefined);
    try {
      const balance = (await publicClient.readContract({
        address: packNftAddress,
        abi: RITUAL_PACK_NFT_ABI,
        functionName: "balanceOf",
        args: [wallet],
      })) as bigint;
      // Drop this result if a newer refetch has started.
      if (mySeq !== requestSeqRef.current) return;

      if (balance === 0n) {
        setCards([]);
        return;
      }

      // Enumerate tokens via ERC721Enumerable.tokenOfOwnerByIndex.
      // viem's strict generics don't match our hand-rolled ABI
      // literals, so we cast the multicall arg array to `any`.
      const idCalls = Array.from({ length: Number(balance) }, (_, i) => ({
        address: packNftAddress,
        abi: RITUAL_PACK_NFT_ABI,
        functionName: "tokenOfOwnerByIndex" as const,
        args: [wallet, BigInt(i)] as const,
      })) as unknown as Parameters<typeof publicClient.multicall>[0]["contracts"];
      const tokenIds = (await publicClient.multicall({
        contracts: idCalls,
        allowFailure: false,
      })) as bigint[];

      if (mySeq !== requestSeqRef.current) return;

      // Parallel cardData + supply reads (Current runtime: cardData from PackNFT,
      // serialNumber/maxSupply from PackManager).
      const settled = await readCardWithSupplyBatch(tokenIds);

      if (mySeq !== requestSeqRef.current) return;

      const out: OwnedPackCard[] = [];
      settled.forEach((decoded, i) => {
        if (!decoded) return;
        // Skip zeroed entries (un-minted slot or pre-mint ghost).
        if (decoded.cardId === 0n && decoded.role === "" && decoded.maxSupply === 0n) {
          return;
        }
        out.push({
          tokenId: tokenIds[i],
          cardId: decoded.cardId,
          serialNumber: decoded.serialNumber,
          maxSupply: decoded.maxSupply,
          rarity: decoded.rarity,
          role: decoded.role,
          power: decoded.power,
          mintedAt: Number(decoded.mintedAt),
        });
      });
      setCards(out);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [wallet, packNftAddress]);

  useEffect(() => {
    void refetch();
  }, [refetch, nonce]);

  // Re-fetch when a CardMinted event fires for this wallet.
  useEffect(() => {
    if (!packNftAddress || !wallet) return;
    let cancelled = false;
    let unwatch: (() => void) | undefined;
    try {
      unwatch = publicClient.watchContractEvent({
        address: packNftAddress,
        abi: RITUAL_PACK_NFT_ABI,
        eventName: "CardMinted",
        args: { to: wallet },
        onLogs: () => {
          if (!cancelled) setNonce((n) => n + 1);
        },
      });
    } catch {
      // ABI mismatch or RPC unavailable — silent no-op; manual
      // refetch() still works.
    }
    return () => {
      cancelled = true;
      try {
        unwatch?.();
      } catch {
        /* noop */
      }
    };
  }, [packNftAddress, wallet]);

  // Re-fetch on wallet change
  useEffect(() => subscribeSharedWallet(() => setNonce((n) => n + 1)), []);

  // Also listen to client-side event bus — pack open, marketplace
  // list/buy/cancel all change NFT ownership for this wallet.
  useEffect(() => {
    return on("nft-changed", () => setNonce((n) => n + 1));
  }, []);

  // AGGRESSIVE: every tx-success from any source (pack open, burn,
  //   marketplace list/buy/cancel, training) can change NFT balance.
  // Multi-stage fallback handles RPC indexing lag (some nodes take
  // 1-3s to index new mints after the tx confirms):
  //   +250ms : debounced immediate refetch (coalesces bursts)
  //   +1.5s  : catches RPC lag for fast nodes
  //   +4s    : catches RPC lag for slow nodes
  //   +10s   : hard ceiling — if balance still wrong after 10s the
  //            user should hard-reload the page
  // Each subsequent tx-success resets and restarts the schedule.
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let stage1: ReturnType<typeof setTimeout> | undefined;
    let stage2: ReturnType<typeof setTimeout> | undefined;
    let stage3: ReturnType<typeof setTimeout> | undefined;
    const clearAll = () => {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = undefined; }
      if (stage1) { clearTimeout(stage1); stage1 = undefined; }
      if (stage2) { clearTimeout(stage2); stage2 = undefined; }
      if (stage3) { clearTimeout(stage3); stage3 = undefined; }
    };
    const trigger = () => setNonce((n) => n + 1);
    const unsub = on("tx-success", () => {
      clearAll();
      // Stage 0: debounced coalesce — handles rapid back-to-back tx
      debounceTimer = setTimeout(trigger, 250);
      // Stage 1: 1.5s — fast RPC
      stage1 = setTimeout(trigger, 1500);
      // Stage 2: 4s — slow RPC
      stage2 = setTimeout(trigger, 4000);
      // Stage 3: 10s — last-ditch ceiling
      stage3 = setTimeout(trigger, 10000);
    });
    return () => {
      unsub();
      clearAll();
    };
  }, []);

  return { cards, loading, error, refetch };
}
