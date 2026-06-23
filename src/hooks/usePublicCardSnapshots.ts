import { useCallback, useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { identityCardAbi } from "../abi/identityCard";
import { anthemAddress, hasAnthemContract, publicClient } from "./useAnthem";

export type PublicCardSnapshot = {
  tokenId: bigint;
  currentPower: number;
  currentRarity: number;
  snapshotVersion: number;
};

const cache = new Map<string, PublicCardSnapshot>();

function decodeSnapshot(raw: Record<string, unknown>): PublicCardSnapshot {
  return {
    tokenId: BigInt(raw.tokenId as string | number | bigint),
    currentPower: Number(raw.currentPower),
    currentRarity: Number(raw.currentRarity),
    snapshotVersion: Number(raw.snapshotVersion),
  };
}

export function usePublicCardSnapshots(wallets: readonly (Address | undefined)[]) {
  const key = wallets.filter(Boolean).map((w) => String(w).toLowerCase()).sort().join(",");
  const [snapshots, setSnapshots] = useState<Map<string, PublicCardSnapshot>>(() => new Map(cache));
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    const unique = Array.from(new Set(wallets.filter((w): w is Address => Boolean(w && isAddress(w)))));
    if (!hasAnthemContract || unique.length === 0) {
      setSnapshots(new Map(cache));
      return new Map(cache);
    }
    setLoading(true);
    try {
      const next = new Map(cache);
      await Promise.all(unique.map(async (wallet) => {
        try {
          const raw = await publicClient.readContract({
            address: anthemAddress,
            abi: identityCardAbi,
            functionName: "getCardSnapshot",
            args: [wallet],
          });
          const snap = decodeSnapshot(raw as Record<string, unknown>);
          if (snap.currentPower > 0) {
            next.set(wallet.toLowerCase(), snap);
          } else {
            next.delete(wallet.toLowerCase());
          }
        } catch {
          // Fallback: derive from getCurrentPower + rarityForPower so cards
          // minted before the snapshot phase still show in the gallery.
          try {
            const cur = await publicClient.readContract({
              address: anthemAddress,
              abi: identityCardAbi,
              functionName: "getCurrentPower",
              args: [wallet],
            }) as unknown as bigint;
            const pow = Number(cur);
            if (pow > 0) {
              let rar = 0;
              try {
                rar = Number(await publicClient.readContract({
                  address: anthemAddress,
                  abi: identityCardAbi,
                  functionName: "rarityForPower",
                  args: [pow],
                }));
              } catch { /* keep rar=0 */ }
              next.set(wallet.toLowerCase(), { tokenId: 0n, currentPower: pow, currentRarity: rar, snapshotVersion: 0 });
            } else {
              next.delete(wallet.toLowerCase());
            }
          } catch {
            next.delete(wallet.toLowerCase());
          }
        }
      }));
      cache.clear();
      for (const [k, v] of next) cache.set(k, v);
      setSnapshots(new Map(next));
      return next;
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => { void refetch(); }, [refetch]);

  return { snapshots, loading, refetch };
}
