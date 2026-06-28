// src/hooks/useOpenPack.ts
// Opens a pack on-chain via a single-phase state machine so
// the UI can render a step indicator and block re-entry during a tx.
//
// Flow (for packs with apCost > 0):
//   1. checking      — read pack cost + AP balance + allowance (no prompts)
//   2. approving     — wallet prompt: approve AP spend for the pack
//   3. opening       — wallet prompt: open initiate / ritual pack
//   4. confirming    — tx submitted, waiting for receipt
//   5. done          — CardMinted event parsed
//
// For packs with apCost == 0, skips step 2.
//
// All errors are thrown (no longer swallowed). The hook re-throws so
// the caller (usePacks → PackWindow) can decide how to render them.
// `inFlightRef` blocks double-clicks within the same component instance.

import { useCallback, useRef, useState } from "react";
import { type Address, type Hash, decodeEventLog } from "viem";
import { PACK_MANAGER_ABI } from "../lib/packManagerAbi";
import { RITUAL_AP_ABI } from "../lib/apAbi";
import { ritualTestnet } from "../lib/chains";
import { RITUAL_GAS } from "../lib/gasDefaults";
import { publicClient } from "./useAnthem";
import { ensureReadyForWrite, getSharedWalletClient } from "../lib/wallet";
import { envAddress, packManagerAddress, apPackAddress } from "../lib/chains";
import { getPackNftAddress, getPackNftAddressOrDefault, readCardWithSupplyBatch } from "../lib/packNftReads";
import { emit } from "../lib/eventBus";
import { shortTxError } from "../lib/shortTxError";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

function getPackManagerAddress(): Address {
  return packManagerAddress;
}

function getAPAddress(): Address | null {
  return apPackAddress;
}

export type PackType = 0 | 1; // INITIATE | RITUALIST

export type PackPhase =
  | "idle"
  | "checking"      // reading pack cost + AP balance + allowance (no prompts)
  | "approving"     // user is signing RitualAP.approve
  | "opening"       // user is signing the pack open transaction
  | "confirming"    // tx submitted, waiting for receipt
  | "done"          // success — event parsed
  | "error";        // last attempt failed; `error` is set

export interface OpenPackCard {
  tokenId: bigint;
  // V8 model: cardId + serialNumber, both set later by reading cardData.
  // We only have tokenIds from PackOpened event; serialNumber is looked up
  // post-tx by reading the new cardData(tokenId).
  cardId: bigint;
  serialNumber: bigint;
  maxSupply: bigint;
  rarity: number;
  role: string;
  power: number;
  apCost: bigint;
}

export interface OpenPackResult {
  txHash: Hash;
  cards: OpenPackCard[]; // always 3 cards (v7)
  apCost: bigint;
}

export interface UseOpenPackResult {
  open: (packType: PackType) => Promise<OpenPackResult>;
  phase: PackPhase;
  loading: boolean;            // phase ∈ {checking, approving, opening, confirming}
  error: string | undefined;
  // UI support
  pendingTxHash: Hash | undefined;
  pendingStepLabel: string | undefined;
  reset: () => void;
}

const PHASE_STEP: Record<PackPhase, number> = {
  idle: 0,
  checking: 1,
  approving: 2,
  opening: 3,
  confirming: 4,
  done: 0,
  error: 0,
};

export function phaseStep(phase: PackPhase): number {
  return PHASE_STEP[phase];
}

export function useOpenPack(): UseOpenPackResult {
  const [phase, setPhase] = useState<PackPhase>("idle");
  const [error, setError] = useState<string | undefined>();
  const [pendingTxHash, setPendingTxHash] = useState<Hash | undefined>();
  const [pendingStepLabel, setPendingStepLabel] = useState<string | undefined>();
  // Re-entry guard: blocks double-clicks within the same component instance
  // even if `loading` hasn't propagated through React state yet.
  const inFlightRef = useRef(false);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(undefined);
    setPendingTxHash(undefined);
    setPendingStepLabel(undefined);
  }, []);

  const open = useCallback(
    async (packType: PackType): Promise<OpenPackResult> => {
      if (inFlightRef.current) {
        throw new Error("Pack open already in progress");
      }
      inFlightRef.current = true;
      setError(undefined);
      setPendingTxHash(undefined);
      setPendingStepLabel(undefined);

      try {
        // ── Step 1: pre-flight (no wallet prompts) ─────────────────────
        setPhase("checking");
        setPendingStepLabel("Checking balance");

        const account = await ensureReadyForWrite();
        const walletClient = getSharedWalletClient();
        if (!walletClient) throw new Error("Wallet not connected");
        const mgrAddr = getPackManagerAddress();

        const cfg = (await publicClient.readContract({
          address: mgrAddr,
          abi: PACK_MANAGER_ABI,
          functionName: packType === 0 ? "initiatePack" : "ritualPack",
        })) as { apCost: bigint; bps0: number; bps1: number; bps2: number; bps3: number; bps4: number };

        if (cfg.apCost > 0n) {
          const apAddr = getAPAddress();
          if (!apAddr) {
            throw new Error("Packs are unavailable right now.");
          }
          // Atomic pre-flight: read balance + allowance in parallel.
          // Fail-fast: don't show the user a wallet prompt if we know it'll revert.
          const [bal, allow] = await Promise.all([
            publicClient.readContract({
              address: apAddr, abi: RITUAL_AP_ABI,
              functionName: "balanceOf", args: [account],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: apAddr, abi: RITUAL_AP_ABI,
              functionName: "allowance", args: [account, mgrAddr],
            }) as Promise<bigint>,
          ]);
          if (bal < cfg.apCost) {
            throw new Error(
              `Insufficient AP.`,
            );
          }
          if (allow < cfg.apCost) {
            // ── Step 2: Approve (first wallet prompt) ───────────────────
            // Approve max uint256 so subsequent pack opens don't re-prompt.
            // One-time per (user, PM) pair — much better UX than per-pack reapproval.
            setPhase("approving");
            setPendingStepLabel(`Approve AP spending (one-time)`);
            const MAX_UINT256 = (1n << 256n) - 1n;
            const approveGas = await publicClient.estimateContractGas({
              account, address: apAddr, abi: RITUAL_AP_ABI,
              functionName: "approve", args: [mgrAddr, MAX_UINT256],
            }).catch(() => 60_000n);
            const approveTx = await walletClient.writeContract({
              account, chain: ritualTestnet, address: apAddr, abi: RITUAL_AP_ABI,
              functionName: "approve", args: [mgrAddr, MAX_UINT256],
              gas: (approveGas * 130n) / 100n, // +30% headroom
              maxFeePerGas: RITUAL_GAS.maxFeePerGas,
              maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
            });
            setPendingTxHash(approveTx);
            await publicClient.waitForTransactionReceipt({ hash: approveTx });
            setPendingTxHash(undefined);
          }
        }

        // ── Step 3: Pre-flight simulate (catch revert reason before send) ──
        // Testnet prunes historic state, so we can't get revert reason from
        // a failed tx after-the-fact. Instead, simulate the call against
        // LATEST state to surface the actual reason (e.g. "ERC20InsufficientAllowance").
        setPhase("checking");
        setPendingStepLabel("Simulating pack open");
        const fnName = packType === 0 ? "openInitiatePack" : "openRitualistPack";
        try {
          await publicClient.simulateContract({
            account, chain: ritualTestnet, address: mgrAddr, abi: PACK_MANAGER_ABI,
            functionName: fnName, args: [],
          });
        } catch (e) {
          const err = e as { shortMessage?: string; message?: string };
          throw new Error(`Pack open simulation failed: ${err.shortMessage || err.message || "would revert"}`);
        }

        // ── Step 4: Open pack (third wallet prompt) ─────────────────
        setPhase("opening");
        setPendingStepLabel("Open pack");
        // Estimate gas explicitly with 30% headroom — wallets sometimes
        // set the limit too close to estimate, and the pack open transaction
        // is heavy (3 mints + AP transfer + event emit = ~9.2M gas).
        // OOG gives "reason string unavailable" with no recovery.
        const openGas = await publicClient.estimateContractGas({
          account, address: mgrAddr, abi: PACK_MANAGER_ABI,
          functionName: fnName, args: [],
        }).catch(() => 9_500_000n);
        const gasLimit = (openGas * 130n) / 100n; // 30% headroom
        const txHash = await walletClient.writeContract({
          account, chain: ritualTestnet, address: mgrAddr, abi: PACK_MANAGER_ABI,
          functionName: fnName, args: [],
          gas: gasLimit > 15_000_000n ? 15_000_000n : gasLimit,
          maxFeePerGas: RITUAL_GAS.maxFeePerGas,
          maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
        });
        setPendingTxHash(txHash);

        // ── Step 5: Wait for confirmation ───────────────────────────
        setPhase("confirming");
        setPendingStepLabel("Waiting for confirmation");
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") {
          throw new Error("Pack open transaction reverted on-chain (no state available for trace)");
        }

        // Decode PackOpenedBatch event (V9 emits one batch event per pack
        // with the 3 tokenIds in an array — much easier than 3 individual
        // PackOpened events).
        const tokenIdList: bigint[] = [];
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: PACK_MANAGER_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "PackOpenedBatch") {
              const args = decoded.args as unknown as {
                user: `0x${string}`;
                packType: number;
                tokenIds: readonly bigint[];
                rarities: readonly number[];
                serials: readonly bigint[];
              };
              for (const tid of args.tokenIds ?? []) tokenIdList.push(tid);
            }
          } catch {
            /* not our event */
          }
        }
        if (tokenIdList.length === 0) {
          throw new Error("No PackOpenedBatch event found in receipt");
        }

        // Resolve cardId/serialNumber/maxSupply/rarity/role/power by reading
        // each fresh token's cardData on PackNFT + PackManager supply getters.
        // The PackWindow animation needs real values so the user immediately
        // sees the correct "serialNumber/maxSupply" badge on each newly
        // minted card.
        const apCost = cfg.apCost;
        const cards: OpenPackCard[] = [];
        const settled = await readCardWithSupplyBatch(tokenIdList);
        settled.forEach((d, i) => {
          const tid = tokenIdList[i];
          if (!d) {
            cards.push({
              tokenId: tid,
              cardId: 0n,
              serialNumber: 0n,
              maxSupply: 0n,
              rarity: 0,
              role: "",
              power: 0,
              apCost,
            });
            return;
          }
          cards.push({
            tokenId: tid,
            cardId: d.cardId,
            serialNumber: d.serialNumber,
            maxSupply: d.maxSupply,
            rarity: d.rarity,
            role: d.role,
            power: d.power,
            apCost,
          });
        });

        // ── Step 5: Done ─────────────────────────────────────────────
        // Cross-hook invalidation: AP was deducted, NFTs were minted.
        // Fire AFTER all reads so the listeners refetch fresh data.
        emit({ type: 'ap-changed', reason: 'pack-open' });
        emit({ type: 'nft-changed', reason: 'pack-open' });
        emit({ type: 'tx-success', source: 'useOpenPack', action: packType === 0 ? 'openInitiatePack' : 'openRitualistPack', hash: txHash });
        setPhase("done");
        setPendingStepLabel(undefined);
        return { txHash, cards, apCost: cfg.apCost };
      } catch (e) {
        const msg = shortTxError(e, "Open pack");
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
    phase === "opening" ||
    phase === "confirming";

  return { open, phase, loading, error, pendingTxHash, pendingStepLabel, reset };
}

function formatAp(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  if (frac === 0n) return whole.toString();
  // 2 decimal places
  const f = (Number(frac) / 1e18).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${whole.toString()}.${f}`;
}
