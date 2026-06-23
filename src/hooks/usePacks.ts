// src/hooks/usePacks.ts
// --------------------------------------------------------------------
// Collection Pack v5 (fully on-chain) — orchestrator over the new flow:
//
//   1. Load community pool JSON for *display only* (Pool Overview panel).
//   2. Open a pack via `useOpenPack`:
//        - PackManager.openInitiatePack() / openRitualPack()
//        - The card draw is decided on-chain (block-hash PRNG — testnet
//          scope; swap in VRF for mainnet)
//        - The NFT lands directly in the user's wallet
//   3. Read owned NFTs from chain via `useOwnedPackNFTs`.
//   4. Read AP balance from the on-chain RitualAP ERC-20 via `useAPBalance`.
//
// Source-of-truth rule: **chain is always the source of truth for
// ownership and AP. localStorage may be used for UI cache only.**
// --------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import {
  loadCollectionPool,
  type CollectionPool,
  type PoolCard,
} from "../lib/packPool";
import { useOwnedPackNFTs, type OwnedPackCard } from "./useOwnedPackNFTs";
import { useOpenPack, type PackType, type PackPhase } from "./useOpenPack";
import { useAPBalance } from "./useAPBalance";
import { INTERNAL_RARITIES, type InternalRarity } from "../lib/rarity";
import { PACK_MANAGER_ABI } from "../lib/packManagerAbi";
import { packManagerAddress, hasPackManagerContract } from "../lib/chains";
import { publicClient } from "./useAnthem";
import { toApNumber } from "../lib/apFormat";

export interface PackOpenedEvent {
  tokenId: bigint;
  cardId: bigint;
  rarity: number;
  power: number;
  role: string;
  serialNumber: bigint;
  maxSupply: bigint;
  txHash: `0x${string}`;
  apBalanceAfter: number;
}

export interface UsePacksResult {
  // Status
  ready: boolean;
  loading: boolean;
  error: string | undefined;

  // Pack open phase (for step indicator)
  packPhase: PackPhase;
  pendingTxHash: `0x${string}` | undefined;
  pendingStepLabel: string | undefined;

  // Pool snapshot (display only)
  pool: CollectionPool | null;
  total: number;
  counts: Record<string, number>;
  getCardsByRarity: (rarity: string) => PoolCard[];
  getCardById: (cardId: number) => PoolCard | undefined;
  // NOTE: getRemainingSupply was removed in V5. The chain (PackManager)
  // is the source of truth for live supply; there is no client-side
  // remaining-supply helper anymore.

  // Pack opening (on-chain)
  openInitiatePack: () => Promise<PackOpenedEvent[]>;
  openRitualistPack: () => Promise<PackOpenedEvent[]>;
  initiateCost: number;
  ritualistCost: number;
  // TRUE drop probabilities (basis points 0..10000, per InternalRarity 0..4)
  // from PackManager.initiatePack() / ritualPack(). Sum to 10000.
  initiateDropBps: Record<number, number> | undefined;
  ritualDropBps: Record<number, number> | undefined;

  // On-chain owned collection (source of truth)
  userCollection: OwnedPackCard[];

  // AP balance (on-chain via RitualAP)
  apBalance: number;
  apSource: "onchain" | "unconfigured" | "unknown";

  // Diagnostics
  refetch: () => Promise<void>;
  resetPackError: () => void;
}

const PACK_AP_DECIMALS = 18;

async function readPackCostFromChain(packType: 0 | 1): Promise<number> {
  if (!hasPackManagerContract) return 0;
  try {
    const fn = packType === 0 ? "initiatePack" : "ritualPack";
    const cfg = (await publicClient.readContract({
      address: packManagerAddress,
      abi: PACK_MANAGER_ABI,
      functionName: fn as "initiatePack" | "ritualPack",
    })) as { apCost: bigint };
    // Use formatUnits-based conversion to avoid Number(bigint) precision
    // loss (1e18 wei = 1 AP, which already exceeds 2^53 for any non-zero
    // pack cost).
    return toApNumber(cfg.apCost);
  } catch {
    return 0;
  }
}

const EMPTY_COUNTS: Record<string, number> = Object.fromEntries(
  INTERNAL_RARITIES.map((r) => [r, 0]),
) as Record<string, number>;

export function usePacks(address?: Address): UsePacksResult {
  const [pool, setPool] = useState<CollectionPool | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState<Error | undefined>();

  // 1) pool JSON for display
  const refetchPool = useCallback(async () => {
    setPoolLoading(true);
    setPoolError(undefined);
    try {
      setPool(await loadCollectionPool());
    } catch (e) {
      setPoolError(e as Error);
    } finally {
      setPoolLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetchPool();
  }, [refetchPool]);

  // 2) on-chain owned NFTs
  const owned = useOwnedPackNFTs(address);

  // 3) on-chain pack open (with phase state machine)
  const opener = useOpenPack();

  // 4) on-chain AP balance
  const ap = useAPBalance(address);

  // 5) on-chain pack prices (source of truth: PackManager)
  const [initiateCost, setInitiateCost] = useState<number>(0);
  const [ritualistCost, setRitualistCost] = useState<number>(0);
  const refetchCosts = useCallback(async () => {
    const [i, r] = await Promise.all([readPackCostFromChain(0), readPackCostFromChain(1)]);
    setInitiateCost(i);
    setRitualistCost(r);
  }, []);
  useEffect(() => {
    void refetchCosts();
  }, [refetchCosts]);
  // Refresh on-chain prices after every pack-open attempt.
  const openerIdle = opener.phase === "idle" || opener.phase === "done" || opener.phase === "error";
  useEffect(() => {
    if (openerIdle) void refetchCosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openerIdle]);

  // 5b) TRUE drop probabilities from PackConfig.initiatePack/ritualPack.
  // Each is a tuple (apCost, bps0..bps4) — basis points (0..10000) per
  // InternalRarity (0..4). Sum should be 10000. We expose these so the FE
  // shows the *actual* drop rates, not the supply distribution.
  const [initiateDropBps, setInitiateDropBps] = useState<Record<number, number> | undefined>();
  const [ritualDropBps, setRitualDropBps] = useState<Record<number, number> | undefined>();
  const refetchDropBps = useCallback(async () => {
    if (!hasPackManagerContract || !packManagerAddress) {
      setInitiateDropBps(undefined);
      setRitualDropBps(undefined);
      return;
    }
    try {
      const [initRaw, ritRaw] = await Promise.all([
        publicClient.readContract({
          address: packManagerAddress,
          abi: PACK_MANAGER_ABI,
          functionName: "initiatePack",
        }),
        publicClient.readContract({
          address: packManagerAddress,
          abi: PACK_MANAGER_ABI,
          functionName: "ritualPack",
        }),
      ]);
      const packToBps = (raw: unknown): Record<number, number> | undefined => {
        // viem returns tuple as object with named keys
        const t = raw as { bps0?: bigint; bps1?: bigint; bps2?: bigint; bps3?: bigint; bps4?: bigint };
        if (t?.bps0 === undefined) return undefined;
        return {
          0: Number(t.bps0),
          1: Number(t.bps1),
          2: Number(t.bps2),
          3: Number(t.bps3),
          4: Number(t.bps4),
        };
      };
      setInitiateDropBps(packToBps(initRaw));
      setRitualDropBps(packToBps(ritRaw));
    } catch {
      setInitiateDropBps(undefined);
      setRitualDropBps(undefined);
    }
  }, []);
  useEffect(() => {
    void refetchDropBps();
  }, [refetchDropBps]);
  useEffect(() => {
    if (openerIdle) void refetchDropBps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openerIdle]);

  // Errors from openInitiatePack/openRitualistPack are thrown to caller now.
  const openInitiatePack = useCallback(async (): Promise<PackOpenedEvent[]> => {
    if (!address) throw new Error("Wallet not connected");
    const r = await opener.open(0 as PackType);
    return r.cards.map((c) => ({
      tokenId: c.tokenId,
      cardId: c.cardId,
      rarity: c.rarity,
      power: c.power,
      role: c.role,
      serialNumber: c.serialNumber,
      maxSupply: c.maxSupply,
      txHash: r.txHash,
      apBalanceAfter: ap.state?.balance ?? 0,
    }));
  }, [address, opener, ap.state?.balance]);

  const openRitualistPack = useCallback(async (): Promise<PackOpenedEvent[]> => {
    if (!address) throw new Error("Wallet not connected");
    const r = await opener.open(1 as PackType);
    return r.cards.map((c) => ({
      tokenId: c.tokenId,
      cardId: c.cardId,
      rarity: c.rarity,
      power: c.power,
      role: c.role,
      serialNumber: c.serialNumber,
      maxSupply: c.maxSupply,
      txHash: r.txHash,
      apBalanceAfter: ap.state?.balance ?? 0,
    }));
  }, [address, opener, ap.state?.balance]);

  const getCardsByRarity = useCallback(
    (rarity: string): PoolCard[] => {
      if (!pool) return [];
      const r = rarity as InternalRarity;
      return pool.byRarity?.[r] ?? [];
    },
    [pool],
  );

  const getCardById = useCallback(
    (cardId: number): PoolCard | undefined => {
      if (!pool) return undefined;
      return pool.byId?.[cardId];
    },
    [pool],
  );

  // getRemainingSupply was removed in V5. Chain is source of truth.

  return {
    ready: !poolLoading && pool !== null,
    loading: poolLoading || owned.loading || opener.loading,
    error:
      poolError?.message ||
      (owned.error as Error | undefined)?.message ||
      opener.error,

    // Phase + pending tx for step indicator
    packPhase: opener.phase,
    pendingTxHash: opener.pendingTxHash,
    pendingStepLabel: opener.pendingStepLabel,

    pool,
    total: pool?.total ?? 0,
    counts: pool?.counts ?? EMPTY_COUNTS,
    getCardsByRarity,
    getCardById,

    openInitiatePack,
    openRitualistPack,
    initiateCost,
    ritualistCost,
    initiateDropBps,
    ritualDropBps,

    userCollection: owned.cards,
    apBalance: ap.state?.balance ?? 0,
    apSource: (ap.state?.source as "onchain" | "unconfigured" | "unknown") ?? "unknown",

    refetch: async () => {
      await refetchPool();
      await owned.refetch();
      await ap.refetch();
    },
    resetPackError: opener.reset,
  };
}
