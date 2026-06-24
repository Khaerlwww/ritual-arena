import { useCallback, useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { ritualTrainingAbi } from "../abi/ritualTraining";
import { hasTrainingContract, ritualTestnet, trainingAddress } from "../lib/chains";
import { publicClient } from "./useAnthem";
import { getSelectedWalletProvider, getSharedWalletClient, ensureReadyForWrite } from "../lib/wallet";
import { toApNumber } from "../lib/apFormat";
import { emit, on } from "../lib/eventBus";
import { RITUAL_GAS } from "../lib/gasDefaults";
import { shortTxError } from "../lib/shortTxError";

export { hasTrainingContract, trainingAddress } from "../lib/chains";

export type TrainingProgress = {
  totalXp: number;
  level: number;
  currentLevelXp: number;
  xpToNextLevel: number;
  apEarned: number;
  trainCount: number;
  lastTrainedAt: number;
  canTrain: boolean;
  secondsLeft: number;
};

export type TrainingRecord = {
  trainedAt: number;
  levelAfter: number;
  xpGained: number;
  apGained: number;
};

const emptyProgress: TrainingProgress = {
  totalXp: 0,
  level: 1,
  currentLevelXp: 0,
  xpToNextLevel: 500,
  apEarned: 0,
  trainCount: 0,
  lastTrainedAt: 0,
  canTrain: false,
  secondsLeft: 0,
};

export function useTrainingProgress(wallet?: Address, tokenId?: number) {
  const [progress, setProgress] = useState<TrainingProgress>(emptyProgress);
  const [history, setHistory] = useState<TrainingRecord[]>([]);
  /** Bump to force refetch — wired to event bus for cross-hook invalidation. */
  const [refetchNonce, setRefetchNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!hasTrainingContract || !tokenId || !wallet || !isAddress(wallet)) {
      setProgress(emptyProgress);
      setHistory([]);
      return;
    }
    setIsLoading(true);
    // Local fallback storage key for client-side cooldown tracking. The
    // on-chain contract only stores trainCount (not lastTrainedAt), so we
    // keep a per (wallet, tokenId) timestamp locally to power the
    // countdown UI when getProgress reverts.
    const COOLDOWN_SECS = 20 * 60 * 60;
    const LEVEL_SIZE = 500;
    const LS_KEY = `ritual:training:lastTrainedAt:${wallet.toLowerCase()}:${tokenId}`;
    function readLastTrainedAt(): number {
      if (typeof window === "undefined") return 0;
      try {
        const v = window.localStorage.getItem(LS_KEY);
        return v ? Number(v) || 0 : 0;
      } catch {
        return 0;
      }
    }
    try {
      // V5-canon ABI: getCardProgress(tokenId) returns CardProgress struct,
      // getTrainingRecord(tokenId, i) returns one history entry. We loop
      // through trainingHistoryCount(tokenId) to enumerate.
      //
      // KEY FIX: contract.train() stores training data keyed by WALLET
      // (`uint256 tokenId = uint256(uint160(msg.sender))`), NOT by the
      // IdentityCard NFT tokenId. Earlier versions of this hook read
      // getCardProgress(BigInt(tokenId)) and got the empty struct, which
      // is why "Latest Training" rendered "—" even after 3 successful
      // trains. Read with wallet as the key to get real data.
      const trainingKey = wallet ? BigInt(wallet) : (tokenId !== undefined ? BigInt(tokenId) : undefined);
      if (!trainingKey) {
        setProgress(emptyProgress);
        setHistory([]);
        return;
      }
      const [rawProgress, historyCount] = await Promise.all([
        publicClient.readContract({
          address: trainingAddress,
          abi: ritualTrainingAbi,
          functionName: "getCardProgress",
          args: [trainingKey],
        }),
        publicClient.readContract({
          address: trainingAddress,
          abi: ritualTrainingAbi,
          functionName: "trainingHistoryCount",
          args: [trainingKey],
        }),
      ]);
      // viem returns named-tuple outputs as OBJECTS with the field names
      // from the ABI (not arrays). Use named keys instead of positional
      // indices — the previous `p[0]/p[1]/...` access returned undefined
      // because the tuple is not iterable, causing all values to silently
      // fall back to 0n. This is why training history displayed "+0 XP /
      // +0 AP" even though on-chain had 25 / 25.
      const p = rawProgress as unknown as {
        totalXp: bigint;
        apEarned: bigint;
        trainCount: bigint;
        lastTrainedAt: bigint;
        createdAt: bigint;
      };
      const totalXp = Number(p.totalXp ?? 0n);
      const apEarned = p.apEarned ?? 0n;
      const trainCount = Number(p.trainCount ?? 0n);
      const lastTrainedAt = Number(p.lastTrainedAt ?? 0n);
      const level = Math.floor(totalXp / LEVEL_SIZE);
      const currentLevelXp = totalXp % LEVEL_SIZE;
      const xpToNextLevel = LEVEL_SIZE - currentLevelXp;
      const canTrain = trainCount === 0 ? true : (() => {
        // Derive cooldown locally — contract has no public canTrain()
        const nowMs = Date.now();
        const lastMs = lastTrainedAt > 1e12 ? lastTrainedAt : lastTrainedAt * 1000;
        const elapsed = nowMs - lastMs;
        return elapsed >= COOLDOWN_SECS * 1000;
      })();
      const secondsLeft = trainCount === 0 || lastTrainedAt === 0
        ? 0
        : Math.max(0, COOLDOWN_SECS - Math.floor((Date.now() - (lastTrainedAt > 1e12 ? lastTrainedAt : lastTrainedAt * 1000)) / 1000));
      setProgress({
        totalXp,
        level,
        currentLevelXp,
        xpToNextLevel,
        // apEarned is 18-decimal wei on-chain — convert to human AP units.
        apEarned: toApNumber(apEarned),
        trainCount,
        lastTrainedAt,
        canTrain,
        secondsLeft,
      });
      // Read history records one at a time.
      // Same KEY FIX: storage is keyed by wallet, not NFT tokenId.
      const historyRecords: { trainedAt: number; levelAfter: number; xpGained: number; apGained: number }[] = [];
      for (let i = 0n; i < historyCount; i++) {
        try {
          const r = await publicClient.readContract({
            address: trainingAddress,
            abi: ritualTrainingAbi,
            functionName: "getTrainingRecord",
            args: [trainingKey, i],
          });
          // viem returns named-tuple outputs as OBJECTS with field names
          // from the ABI (not arrays). Read by name, not by index — array
          // access on an object returns undefined, which silently fell
          // back to 0n and showed "+0 XP / +0 AP" even though on-chain
          // values were 25 / 25 AP per record.
          const rec = r as unknown as {
            trainedAt: bigint;
            levelAfter: bigint;
            xpGained: bigint;
            apGained: bigint;
          };
          historyRecords.push({
            trainedAt: Number(rec.trainedAt ?? 0n),
            levelAfter: Number(rec.levelAfter ?? 1n),
            xpGained: Number(rec.xpGained ?? 0n),
            apGained: toApNumber(rec.apGained ?? 0n),
          });
        } catch { /* skip */ }
      }
      setHistory(historyRecords);
    } catch (primaryErr) {
      // Primary getProgress/getHistory call reverted. The contract only
      // exposes a public trainCount state variable, not a fully-formed
      // progress struct readable from the FE. Derive a usable progress
      // from trainCount + localStorage-tracked lastTrainedAt so the UI
      // can show a real countdown ("Next training in 18h 32m 11s")
      // instead of the generic "come back tomorrow" message.
      // V5-canon contract has no public trainCount() — derive from
      // getCardProgress(0).trainCount as a coarse proxy.
      let trainCount2: number;
      try {
        const p = await publicClient.readContract({
          address: trainingAddress,
          abi: ritualTrainingAbi,
          functionName: "getCardProgress",
          args: [BigInt(tokenId)],
        });
        const pc = p as unknown as { totalXp: bigint; apEarned: bigint; trainCount: bigint; lastTrainedAt: bigint; createdAt: bigint };
        trainCount2 = Number(pc.trainCount ?? 0n);
      } catch {
        trainCount2 = 0;
      }
      const ls = readLastTrainedAt();
      let secondsLeft2 = 0;
      let canTrain2 = trainCount2 === 0;
      if (trainCount2 > 0) {
        if (ls > 0) {
          const elapsed = Math.floor(Date.now() / 1000) - ls;
          secondsLeft2 = Math.max(0, COOLDOWN_SECS - elapsed);
          canTrain2 = secondsLeft2 === 0;
        }
        // trainCount>0 but no localStorage entry (different device /
        // cleared storage): treat as "recently trained" cooldown.
        else {
          canTrain2 = false;
          secondsLeft2 = COOLDOWN_SECS;
        }
      }
      setProgress({
        totalXp: 0,
        level: 1,
        currentLevelXp: 0,
        xpToNextLevel: 500,
        apEarned: 0,
        trainCount: trainCount2,
        lastTrainedAt: ls,
        canTrain: canTrain2,
        secondsLeft: secondsLeft2,
      });
      setHistory([]);
      return;
    } finally {
      setIsLoading(false);
    }
  }, [wallet, tokenId]);

  useEffect(() => {
    void refetch();
  }, [refetch, refetchNonce]);

  // Refresh on training/identity changes via client-side event bus.
  useEffect(() => {
    return on("identity-changed", () => setRefetchNonce((n) => n + 1));
  }, []);

  return { supported: hasTrainingContract, progress, history, isLoading, refetch };
}

export type TrainPhase = "idle" | "awaitingSignature" | "submitted" | "confirming" | "success" | "error";

export function useTrainingWrites() {
  const [phase, setPhase] = useState<TrainPhase>("idle");
  const [txHash, setTxHash] = useState<string>();
  const [error, setError] = useState<string>();

  const train = useCallback(
    async (tokenId: number) => {
      if (!hasTrainingContract) throw new Error("VITE_RITUAL_TRAINING_ADDRESS is not configured.");
      const walletClient = getSharedWalletClient();
      if (!walletClient) throw new Error("Wallet extension not found.");
      setPhase("awaitingSignature");
      setError(undefined);
      setTxHash(undefined);
      try {
        const account = await ensureReadyForWrite();
        // Pre-flight eth_call to detect revert before the wallet prompt
        // (no signature needed) — saves a wasted user signature.
        // Contract train() takes no args — it reads msg.sender and looks up
        // the wallet's token from the IdentityCard directly. Passing tokenId
        // here would call a non-existent overload and revert.
        await publicClient.simulateContract({
          account,
          address: trainingAddress,
          abi: ritualTrainingAbi,
          functionName: "train",
          args: [],
        });
        // Wallet should pop the signature prompt now. After the user signs,
        // the wallet returns a tx hash; we transition to "submitted" and then
        // wait for the receipt ("confirming") before marking success.
        // Training is moderate gas (~1.5M typical). Add 30% headroom so
        // wallet's tight estimate doesn't cause OOG → "reason string unavailable".
        const trainGas = await publicClient.estimateContractGas({
          account,
          address: trainingAddress,
          abi: ritualTrainingAbi,
          functionName: "train",
          args: [],
        }).catch(() => 1_500_000n);
        const hash = await walletClient.writeContract({
          account,
          chain: ritualTestnet,
          address: trainingAddress,
          abi: ritualTrainingAbi,
          functionName: "train",
          args: [],
          gas: (trainGas * 130n) / 100n,
          maxFeePerGas: RITUAL_GAS.maxFeePerGas,
          maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
        });
        setTxHash(hash);
        setPhase("submitted");
        setPhase("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("Training transaction reverted on-chain.");
        }
        setPhase("success");
        // Cross-hook invalidation: AP was minted (+25), trainingLevel/identity
        // may have moved, power may have changed. Tell all relevant hooks.
        emit({ type: 'ap-changed', reason: 'train' });
        emit({ type: 'identity-changed', reason: 'train' });
        emit({ type: 'tx-success', source: 'useTraining', action: 'train', hash: hash });
        return { hash, receipt };
      } catch (err) {
        const msg = shortTxError(err, "Train");
        setError(msg);
        setPhase("error");
        throw err;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setError(undefined);
    setTxHash(undefined);
  }, []);

  return {
    phase,
    isPending: phase === "awaitingSignature" || phase === "submitted" || phase === "confirming",
    txHash,
    error,
    train,
    reset,
    hasWallet: Boolean(getSelectedWalletProvider()),
  };
}
