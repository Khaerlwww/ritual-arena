// src/hooks/useBurnHistory.ts
//
// Local + on-chain burn history. Backfills the user's CardBurnFinished
// events from the CardBurner contract, then keeps a local cache of
// recent burns (last 100) in localStorage for instant render.
//
// Use:
//   const { entries, totalBurned, totalApEarned, refetch } = useBurnHistory(address);
//
// Subscribes to `tx-success` events from useCardBurner so newly confirmed
// burns are appended to the cache immediately, without waiting for the
// next page load.

import { useCallback, useEffect, useState } from "react";
import { type Address, type Hash, decodeEventLog } from "viem";
import { CARD_BURNER_ABI } from "../lib/cardBurnerAbi";
import { cardBurnerAddress, hasCardBurner } from "../lib/chains";
import { publicClient } from "./useAnthem";
import { on } from "../lib/eventBus";

export interface BurnHistoryEntry {
  tokenId: bigint;
  rarity: number;
  apEarned: bigint;
  txHash: Hash;
  burnedAt: number; // unix seconds
}

const STORAGE_KEY = "ritual-arena:burn-history:v1";
const MAX_ENTRIES = 100;

function readStorage(wallet: string): BurnHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY}:${wallet}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BurnHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    // Re-hydrate bigints (JSON.stringify drops the n suffix).
    return parsed
      .map((e) => ({
        ...e,
        tokenId: BigInt(e.tokenId as unknown as string),
        apEarned: BigInt(e.apEarned as unknown as string),
      }))
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function writeStorage(wallet: string, entries: BurnHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    // Serialize bigints as strings so JSON.stringify doesn't throw.
    const safe = entries.slice(0, MAX_ENTRIES).map((e) => ({
      ...e,
      tokenId: e.tokenId.toString(),
      apEarned: e.apEarned.toString(),
    }));
    window.localStorage.setItem(
      `${STORAGE_KEY}:${wallet}`,
      JSON.stringify(safe),
    );
  } catch {
    /* noop — quota exceeded etc. */
  }
}

export interface UseBurnHistoryResult {
  entries: BurnHistoryEntry[];
  totalBurned: number;
  totalApEarned: bigint;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useBurnHistory(address?: Address): UseBurnHistoryResult {
  const wallet = address?.toLowerCase();
  const [entries, setEntries] = useState<BurnHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Hydrate from localStorage on mount / wallet change.
  useEffect(() => {
    if (!wallet) {
      setEntries([]);
      return;
    }
    setEntries(readStorage(wallet));
  }, [wallet]);

  // Refetch from chain: read CardBurnFinished events where msg.sender == wallet.
  // CardBurner emits {tokenId, rarity, apEarned, owner} per burn — filter by owner.
  const refetch = useCallback(async () => {
    if (!wallet || !hasCardBurner) return;
    setLoading(true);
    try {
      const logs = await publicClient.getLogs({
        address: cardBurnerAddress,
        event: {
          type: "event",
          name: "CardBurnFinished",
          inputs: [
            { indexed: true, name: "player", type: "address" },
            { indexed: true, name: "tokenId", type: "uint256" },
            { indexed: true, name: "rarity", type: "uint8" },
            { indexed: false, name: "apEarned", type: "uint256" },
          ],
        },
        args: { player: wallet as Address },
        fromBlock: 0n,
        toBlock: "latest",
      });

      const merged = new Map<string, BurnHistoryEntry>();
      // Seed with localStorage so we don't drop recent entries on cold start.
      for (const e of readStorage(wallet)) {
        merged.set(e.txHash, e);
      }
      for (const log of logs) {
        const txHash = log.transactionHash as Hash;
        if (merged.has(txHash)) continue;
        try {
          const decoded = decodeEventLog({
            abi: CARD_BURNER_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName !== "CardBurnFinished") continue;
          const args = decoded.args as unknown as {
            player: Address;
            tokenId: bigint;
            rarity: number;
            apEarned: bigint;
          };
          merged.set(txHash, {
            tokenId: args.tokenId,
            rarity: args.rarity,
            apEarned: args.apEarned,
            txHash,
            burnedAt: 0, // backfilled — no reliable timestamp without block fetch
          });
        } catch {
          /* skip undecodable */
        }
      }

      const sorted = Array.from(merged.values())
        .sort((a, b) => {
          if (a.burnedAt && b.burnedAt) return b.burnedAt - a.burnedAt;
          // Backfilled (burnedAt=0) sink to bottom; recent (real timestamp) on top.
          if (a.burnedAt) return -1;
          if (b.burnedAt) return 1;
          return 0;
        })
        .slice(0, MAX_ENTRIES);

      setEntries(sorted);
      writeStorage(wallet, sorted);
    } catch (e) {
      console.error("[useBurnHistory] refetch failed", e);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  // Initial backfill + listen for live burns emitted by useCardBurner.
  useEffect(() => {
    if (!wallet) return;
    void refetch();
    return on("tx-success", (ev) => {
      const e = ev as { source?: string; action?: string };
      if (e.source !== "useCardBurner") return;
      // Defer slightly so useCardBurner has finished decoding the receipt
      // and updating its own state.
      setTimeout(() => void refetch(), 500);
    });
  }, [wallet, refetch]);

  const totalBurned = entries.length;
  const totalApEarned = entries.reduce(
    (acc, e) => acc + e.apEarned,
    0n,
  );

  return { entries, totalBurned, totalApEarned, loading, refetch };
}
