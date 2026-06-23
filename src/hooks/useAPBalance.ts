// src/hooks/useAPBalance.ts
// Reads the user's AP balance directly from the on-chain RitualAP
// ERC-20. AP is the on-chain game currency — no off-chain ledger,
// no localStorage source of truth, no backend settlement.
//
// Refetch is exposed for use after a Training.train() or Pack open
// that may have minted new AP. Listens to Transfer events on the
// AP contract to auto-refresh on inbound transfers.

import { useEffect, useState, useCallback } from "react";
import type { Address } from "viem";
import { RITUAL_AP_ABI } from "../lib/apAbi";
import { publicClient } from "./useAnthem";
import { envAddress, apAddress } from "../lib/chains";
import { toApNumberDecimals } from "../lib/apFormat";
import { on } from "../lib/eventBus";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

function getAPAddress(): Address | null {
  return apAddress;
}

export interface APBalanceState {
  /** AP in human units (e.g. 5000 == 5000 AP), not wei. */
  balance: number;
  /** Decimals from the contract (always 18 for RitualAP). */
  decimals: number;
  /** On-chain cap (21,000,000 AP). */
  cap: number;
  /** On-chain totalSupply in human units. */
  totalSupply: number;
  source: "onchain" | "unconfigured";
  label: string;
}

export interface UseAPBalanceResult {
  state: APBalanceState | null;
  loading: boolean;
  error: string | undefined;
  refetch: () => Promise<void>;
}

export function useAPBalance(wallet?: Address): UseAPBalanceResult {
  const [state, setState] = useState<APBalanceState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(async () => {
    if (!wallet) {
      setState(null);
      return;
    }
    const apAddr = getAPAddress();
    if (!apAddr) {
      // VITE_RITUAL_AP_ADDRESS not set — surface as "unconfigured"
      // rather than silently returning 0.
      setState({
        balance: 0,
        decimals: 18,
        cap: 21_000_000,
        totalSupply: 0,
        source: "unconfigured",
        label: "AP contract not deployed (set VITE_RITUAL_AP_ADDRESS)",
      });
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const [bal, dec, cap, supply] = await Promise.all([
        publicClient.readContract({
          address: apAddr,
          abi: RITUAL_AP_ABI,
          functionName: "balanceOf",
          args: [wallet],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: apAddr,
          abi: RITUAL_AP_ABI,
          functionName: "decimals",
        }) as Promise<number>,
        publicClient.readContract({
          address: apAddr,
          abi: RITUAL_AP_ABI,
          functionName: "cap",
        }) as Promise<bigint>,
        publicClient.readContract({
          address: apAddr,
          abi: RITUAL_AP_ABI,
          functionName: "totalSupply",
        }) as Promise<bigint>,
      ]);
      // Use formatUnits for precise conversion (avoids Number(bigint)
      // precision loss for values > 2^53 wei, i.e. > ~9 AP).
      const d = Number(dec);
      setState({
        balance: toApNumberDecimals(bal, d),
        decimals: d,
        cap: toApNumberDecimals(cap, d),
        totalSupply: toApNumberDecimals(supply, d),
        source: "onchain",
        label: "on-chain game currency (RitualAP ERC-20)",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    void refetch();
  }, [refetch, nonce]);

  // Auto-refresh on inbound AP Transfer events targeting this wallet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apAddr = getAPAddress();
    if (!apAddr) return;
    const unwatch = publicClient.watchContractEvent({
      address: apAddr,
      abi: RITUAL_AP_ABI,
      eventName: "Transfer",
      args: { to: wallet },
      onLogs: () => setNonce((n) => n + 1),
    });
    return () => { unwatch?.(); };
  }, [wallet]);

  // Also listen to client-side event bus — refresh immediately after
  // any write action that we know changes AP (claim, stake, pack, etc.).
  useEffect(() => {
    return on("ap-changed", () => setNonce((n) => n + 1));
  }, []);

  return { state, loading, error, refetch: async () => { await refetch(); setNonce((n) => n + 1); } };
}

export function emitAPChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ritual-arena:ap-changed"));
  }
}
