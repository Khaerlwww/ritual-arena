// src/hooks/useCardBurner.ts
//
// Frontend hook for the NFT deflation sink (CardBurner contract).
//
// Flow for burning a card:
//   1. User must approve CardBurner to burn their RitualPackNFTs:
//      RitualPackNFT.setApprovalForAll(CardBurner, true)  (one-time)
//   2. User calls CardBurner.burnCard(tokenId) — burns NFT + mints AP
//   3. UI emits `ap-changed` + `nft-changed` via event bus for cross-hook
//      invalidation. The gallery + AP badge refresh automatically.
//
// Phase machine (mirrors useOpenPack):
//   idle → checking (preflight) → approving (one-time setApprovalForAll)
//        → burning (CardBurner.burnCard or burnCards) → confirming
//        → done | error
//
// Rate table is read live from the contract (burnRates[r]) so owner
// adjustments are reflected without code changes.

import { useCallback, useRef, useState } from "react";
import { type Address, type Hash, decodeEventLog } from "viem";
import { CARD_BURNER_ABI } from "../lib/cardBurnerAbi";
import {
  hasCardBurner,
  cardBurnerAddress,
  packNftAddress,
  ritualTestnet,
} from "../lib/chains";
import { publicClient } from "./useAnthem";
import { ensureReadyForWrite, getSharedWalletClient } from "../lib/wallet";
import { emit } from "../lib/eventBus";
import { formatAp } from "../lib/apFormat";
import { RITUAL_GAS } from "../lib/gasDefaults";
import { shortTxError } from "../lib/shortTxError";

export type BurnPhase =
  | "idle"
  | "checking"
  | "approving"
  | "burning"
  | "confirming"
  | "done"
  | "error";

export interface BurnCardResult {
  tokenId: bigint;
  rarity: number;
  apEarned: bigint;
  txHash: Hash;
}

export interface UseCardBurnerResult {
  /** Approve CardBurner to burn ALL of the user's RitualPackNFTs. One-time. */
  approve: () => Promise<Hash>;
  /** Burn a single token. Burns NFT + mints AP. */
  burnCard: (tokenId: bigint) => Promise<BurnCardResult>;
  /** Batch burn — all must be owned by sender, atomic on revert. */
  burnCards: (tokenIds: bigint[]) => Promise<BurnCardResult[]>;
  phase: BurnPhase;
  loading: boolean;
  error: string | undefined;
  pendingTxHash: Hash | undefined;
  pendingStepLabel: string | undefined;
  reset: () => void;
  /** Read live burn rate from contract (per rarity, wei AP). */
  readBurnRate: (rarity: number) => Promise<bigint>;
}

export function useCardBurner(): UseCardBurnerResult {
  const [phase, setPhase] = useState<BurnPhase>("idle");
  const [error, setError] = useState<string | undefined>();
  const [pendingTxHash, setPendingTxHash] = useState<Hash | undefined>();
  const [pendingStepLabel, setPendingStepLabel] = useState<string | undefined>();
  const inFlightRef = useRef(false);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(undefined);
    setPendingTxHash(undefined);
    setPendingStepLabel(undefined);
  }, []);

  const readBurnRate = useCallback(async (rarity: number): Promise<bigint> => {
    if (!hasCardBurner) return 0n;
    return (await publicClient.readContract({
      address: cardBurnerAddress,
      abi: CARD_BURNER_ABI,
      functionName: "burnRates",
      args: [rarity],
    })) as bigint;
  }, []);

  const approve = useCallback(async (): Promise<Hash> => {
    if (!hasCardBurner) throw new Error("CardBurner not deployed — set chains.ts cardBurnerAddress");
    if (inFlightRef.current) throw new Error("Burn operation already in progress");
    inFlightRef.current = true;
    setError(undefined);
    setPendingTxHash(undefined);
    setPendingStepLabel(undefined);
    try {
      setPhase("checking");
      setPendingStepLabel("Checking approval");
      const account = await ensureReadyForWrite();
      const walletClient = getSharedWalletClient();
      if (!walletClient) throw new Error("Wallet not connected");

      // Idempotent: skip if already approved.
      const alreadyApproved = (await publicClient.readContract({
        address: packNftAddress,
        abi: [
          {
            type: "function",
            name: "isApprovedForAll",
            inputs: [
              { name: "owner", type: "address" },
              { name: "operator", type: "address" },
            ],
            outputs: [{ type: "bool" }],
            stateMutability: "view",
          },
        ],
        functionName: "isApprovedForAll",
        args: [account, cardBurnerAddress],
      })) as boolean;
      if (alreadyApproved) {
        setPhase("done");
        return "0x" as Hash;
      }

      setPhase("approving");
      setPendingStepLabel("Approving burner (one-time)");
      const hash = await walletClient.writeContract({
        account,
        chain: ritualTestnet,
        address: packNftAddress,
        abi: [
          {
            type: "function",
            name: "setApprovalForAll",
            inputs: [
              { name: "operator", type: "address" },
              { name: "approved", type: "bool" },
            ],
            outputs: [],
            stateMutability: "nonpayable",
          },
        ],
        functionName: "setApprovalForAll",
        args: [cardBurnerAddress, true],
        maxFeePerGas: RITUAL_GAS.maxFeePerGas,
        maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
      });
      setPendingTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Approval transaction reverted");
      }
      setPendingTxHash(undefined);
      setPhase("done");
      return hash;
    } catch (e) {
      const msg = shortTxError(e, "Approval");
      setError(msg);
      setPhase("error");
      throw e;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const burnOne = useCallback(
    async (tokenId: bigint): Promise<BurnCardResult> => {
      setPhase("burning");
      setPendingStepLabel(`Burning card #${tokenId.toString()}`);
      const account = await ensureReadyForWrite();
      const walletClient = getSharedWalletClient();
      if (!walletClient) throw new Error("Wallet not connected");

      // Preflight: ensure approval.
      const approved = (await publicClient.readContract({
        address: packNftAddress,
        abi: [
          {
            type: "function",
            name: "isApprovedForAll",
            inputs: [
              { name: "owner", type: "address" },
              { name: "operator", type: "address" },
            ],
            outputs: [{ type: "bool" }],
            stateMutability: "view",
          },
        ],
        functionName: "isApprovedForAll",
        args: [account, cardBurnerAddress],
      })) as boolean;
      if (!approved) {
        throw new Error("CardBurner not approved. Click 'Approve Burner' first.");
      }

      const gas = await publicClient.estimateContractGas({
        account,
        address: cardBurnerAddress,
        abi: CARD_BURNER_ABI,
        functionName: "burnCard",
        args: [tokenId],
      }).catch(() => 120_000n);
      const hash = await walletClient.writeContract({
        account,
        chain: ritualTestnet,
        address: cardBurnerAddress,
        abi: CARD_BURNER_ABI,
        functionName: "burnCard",
        args: [tokenId],
        gas: (gas * 130n) / 100n,
        maxFeePerGas: RITUAL_GAS.maxFeePerGas,
        maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
      });
      setPendingTxHash(hash);
      setPhase("confirming");
      setPendingStepLabel("Waiting for confirmation");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Burn transaction reverted on-chain");
      }

      // Decode CardBurnFinished event from receipt.
      let rarity = 0;
      let apEarned = 0n;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: CARD_BURNER_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "CardBurnFinished") {
            const args = decoded.args as unknown as {
              tokenId: bigint;
              rarity: number;
              apEarned: bigint;
            };
            if (args.tokenId === tokenId) {
              rarity = args.rarity;
              apEarned = args.apEarned;
              break;
            }
          }
        } catch {
          /* not our event */
        }
      }

      return { tokenId, rarity, apEarned, txHash: hash };
    },
    [],
  );

  const burnCard = useCallback(
    async (tokenId: bigint): Promise<BurnCardResult> => {
      if (!hasCardBurner) throw new Error("CardBurner not deployed");
      if (inFlightRef.current) throw new Error("Burn operation already in progress");
      inFlightRef.current = true;
      setError(undefined);
      try {
        const result = await burnOne(tokenId);
        // Cross-hook invalidation: AP balance changed, NFT count changed.
        emit({ type: "ap-changed", reason: "burn-card" });
        emit({ type: "nft-changed", reason: "burn-card" });
        emit({ type: "tx-success", source: "useCardBurner", action: "burnCard", hash: result.txHash });
        setPhase("done");
        setPendingTxHash(undefined);
        setPendingStepLabel(undefined);
        return result;
      } catch (e) {
        const msg = shortTxError(e, "Burn");
        setError(msg);
        setPhase("error");
        setPendingTxHash(undefined);
        setPendingStepLabel(undefined);
        throw e;
      } finally {
        inFlightRef.current = false;
      }
    },
    [burnOne],
  );

  const burnCards = useCallback(
    async (tokenIds: bigint[]): Promise<BurnCardResult[]> => {
      if (!hasCardBurner) throw new Error("CardBurner not deployed");
      if (tokenIds.length === 0) return [];
      if (inFlightRef.current) throw new Error("Burn operation already in progress");
      inFlightRef.current = true;
      setError(undefined);
      try {
        setPhase("burning");
        setPendingStepLabel(`Burning ${tokenIds.length} cards`);
        const account = await ensureReadyForWrite();
        const walletClient = getSharedWalletClient();
        if (!walletClient) throw new Error("Wallet not connected");

        const gas = await publicClient.estimateContractGas({
          account,
          address: cardBurnerAddress,
          abi: CARD_BURNER_ABI,
          functionName: "burnCards",
          args: [tokenIds],
        }).catch(() => 200_000n + 120_000n * BigInt(tokenIds.length));
        const hash = await walletClient.writeContract({
          account,
          chain: ritualTestnet,
          address: cardBurnerAddress,
          abi: CARD_BURNER_ABI,
          functionName: "burnCards",
          args: [tokenIds],
          gas: (gas * 130n) / 100n,
          maxFeePerGas: RITUAL_GAS.maxFeePerGas,
          maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
        });
        setPendingTxHash(hash);
        setPhase("confirming");
        setPendingStepLabel("Waiting for confirmation");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("Burn batch transaction reverted on-chain");
        }

        const results: BurnCardResult[] = [];
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: CARD_BURNER_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "CardBurnFinished") {
              const args = decoded.args as unknown as {
                tokenId: bigint;
                rarity: number;
                apEarned: bigint;
              };
              results.push({
                tokenId: args.tokenId,
                rarity: args.rarity,
                apEarned: args.apEarned,
                txHash: hash,
              });
            }
          } catch {
            /* not our event */
          }
        }

        emit({ type: "ap-changed", reason: "burn-cards" });
        emit({ type: "nft-changed", reason: "burn-cards" });
        emit({ type: "tx-success", source: "useCardBurner", action: "burnCards", hash });
        setPhase("done");
        setPendingTxHash(undefined);
        setPendingStepLabel(undefined);
        return results;
      } catch (e) {
        const msg = shortTxError(e, "Burn batch");
        setError(msg);
        setPhase("error");
        setPendingTxHash(undefined);
        setPendingStepLabel(undefined);
        throw e;
      } finally {
        inFlightRef.current = false;
      }
    },
    [],
  );

  const loading =
    phase === "checking" ||
    phase === "approving" ||
    phase === "burning" ||
    phase === "confirming";

  return {
    approve,
    burnCard,
    burnCards,
    phase,
    loading,
    error,
    pendingTxHash,
    pendingStepLabel,
    reset,
    readBurnRate,
  };
}

export { formatAp };
