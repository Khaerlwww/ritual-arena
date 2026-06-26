// src/hooks/useArena.ts
// V5 Battle system: createBattle → voteAP → settle → claimVotedAP.
// No daily check-in. AP is escrowed via RitualAP transferFrom.
// IdentityRegistry holds canonical arena score (capped 200).

import { useCallback, useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { ritualArenaAbi } from "../abi/ritualArena";
import { arenaAddress, apAddress, hasArenaContract, ritualTestnet } from "../lib/chains";
import { isHiddenProductWallet } from "../lib/hiddenWallets";
import { publicClient, zeroAddress } from "./useAnthem";
import { RITUAL_GAS } from "../lib/gasDefaults";
import { getSelectedWalletProvider, getSharedWalletClient, ensureReadyForWrite } from "../lib/wallet";
import { shortTxError } from "../lib/shortTxError";

export { arenaAddress, hasArenaContract } from "../lib/chains";

export const defaultArenaAddress = zeroAddress;

export const BATTLE_DURATION_SEC = 24 * 60 * 60;
export const COOLDOWN_SEC = 24 * 60 * 60;
export const MAX_ARENA_SCORE = 200;
export const FEE_BPS = 500; // 5%

export type ArenaStats = {
  wins: number;
  losses: number;
  settledBattles: number;
  /**
   * Battles where the user was matched into but the battle hasn't settled yet.
   * Derived: arenaScore grants +5 per battle creation (both wallets), so the
   * floor of (arenaScore - 100*wins - 10*losses) / 5 is the unmatched count.
   */
  unmatchedBattles: number;
  /**
   * settled + unmatched. Used to show "1 matched (0 settled)" instead of "—"
   * when a wallet has arena activity but no settled battles yet.
   */
  totalBattles: number;
  /** Active battle ID if user is currently in a live battle (0 otherwise). */
  activeBattleId: number;
  supportGiven: bigint;
  supportReceived: bigint;
  arenaScore: number;
  winStreak: number;
  bestWinStreak: number;
};

export type Battle = {
  id: bigint;
  walletA: Address;
  walletB: Address;
  startTime: number;
  endTime: number;
  settled: boolean;
  outcome: number; // 0=Unsettled 1=WinA 2=WinB 3=Tie
  votedApPoolA: bigint;
  votedApPoolB: bigint;
  powerA: number;
  powerB: number;
};

const emptyStats: ArenaStats = {
  wins: 0, losses: 0, settledBattles: 0,
  unmatchedBattles: 0, totalBattles: 0, activeBattleId: 0,
  supportGiven: 0n, supportReceived: 0n,
  arenaScore: 0, winStreak: 0, bestWinStreak: 0,
};

// ── Reads ──────────────────────────────────────────────────────────

export function useArenaStats(wallet?: Address) {
  const [stats, setStats] = useState<ArenaStats>(emptyStats);
  const [supported, setSupported] = useState<boolean>(hasArenaContract);

  const refetch = useCallback(async () => {
    if (!wallet || !isAddress(wallet) || !hasArenaContract) {
      setSupported(false);
      setStats(emptyStats);
      return;
    }
    try {
      // Fetch arena stats + activeBattleOf in parallel.
      // activeBattleOf may not exist on legacy contracts — ignore failure.
      const [statsResult, activeBattleIdResult] = await Promise.all([
        publicClient.readContract({
          address: arenaAddress, abi: ritualArenaAbi, functionName: "getArenaStats", args: [wallet],
        }),
        publicClient.readContract({
          address: arenaAddress, abi: ritualArenaAbi, functionName: "activeBattleOf", args: [wallet],
        }).catch(() => 0n),
      ]);
      const r = statsResult as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
      const wins = Number(r[0]);
      const losses = Number(r[1]);
      const settledBattles = Number(r[2]);
      const supportGiven = r[3];
      const supportReceived = r[4];
      const arenaScore = Number(r[5]);
      const winStreak = Number(r[6]);
      const bestWinStreak = Number(r[7]);

      // Derive "unmatched" count: every battle created grants +5 to both
      // wallets. Settled battles contribute +100 (win) or +10 (loss) on top
      // of that. So (arenaScore - 100*wins - 10*losses) / 5 = total matches
      // participated in. Subtract the settled ones to get unmatched.
      const accounted = 100n * BigInt(wins) + 10n * BigInt(losses);
      const remaining = BigInt(Math.max(0, arenaScore)) - accounted;
      const unmatchedBattles = Number(remaining / 5n);
      const totalBattles = settledBattles + unmatchedBattles;

      setStats({
        wins,
        losses,
        settledBattles,
        unmatchedBattles,
        totalBattles,
        activeBattleId: Number(activeBattleIdResult ?? 0n),
        supportGiven,
        supportReceived,
        arenaScore,
        winStreak,
        bestWinStreak,
      });
      setSupported(true);
    } catch {
      setSupported(false);
    }
  }, [wallet]);

  useEffect(() => { void refetch(); }, [refetch]);
  return { stats, supported, refetch };
}

export function useArenaLeaderboard(offset = 0, limit = 20) {
  const [rows, setRows] = useState<{ wallet: Address; arenaScore: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState<boolean>(hasArenaContract);

  const refetch = useCallback(async () => {
    if (!hasArenaContract) { setSupported(false); setRows([]); return; }
    setLoading(true);
    try {
      const r = (await publicClient.readContract({
        address: arenaAddress, abi: ritualArenaAbi, functionName: "getLeaderboard", args: [BigInt(offset), BigInt(limit)],
      })) as readonly [readonly Address[], readonly bigint[]];
      setRows(r[0]
        .map((w, i) => ({ wallet: w, arenaScore: Number(r[1][i]) }))
        .filter((row) => !isHiddenProductWallet(row.wallet)));
      setSupported(true);
    } catch {
      setSupported(false);
    } finally {
      setLoading(false);
    }
  }, [offset, limit]);

  useEffect(() => { void refetch(); }, [refetch]);
  return { rows, loading, supported, refetch };
}

export function useBattle(battleId?: bigint) {
  const [battle, setBattle] = useState<Battle | null>(null);
  const [supported, setSupported] = useState<boolean>(hasArenaContract);

  const refetch = useCallback(async () => {
    if (!hasArenaContract || battleId === undefined) {
      setSupported(false); setBattle(null); return;
    }
    try {
      const r = (await publicClient.readContract({
        address: arenaAddress, abi: ritualArenaAbi, functionName: "getBattle", args: [battleId],
      })) as readonly [Address, Address, bigint, bigint, boolean, number, bigint, bigint, bigint, bigint];
      setBattle({
        id: battleId,
        walletA: r[0], walletB: r[1],
        startTime: Number(r[2]), endTime: Number(r[3]),
        settled: r[4], outcome: r[5],
        votedApPoolA: r[6], votedApPoolB: r[7],
        powerA: Number(r[8]), powerB: Number(r[9]),
      });
      setSupported(true);
    } catch {
      setSupported(false);
    }
  }, [battleId]);

  useEffect(() => { void refetch(); }, [refetch]);
  return { battle, supported, refetch };
}

export function useRecentBattles(wallet?: Address) {
  const [ids, setIds] = useState<bigint[]>([]);
  const [supported, setSupported] = useState<boolean>(hasArenaContract);

  const refetch = useCallback(async () => {
    if (!wallet || !isAddress(wallet) || !hasArenaContract) {
      setSupported(false); setIds([]); return;
    }
    try {
      const r = (await publicClient.readContract({
        address: arenaAddress, abi: ritualArenaAbi, functionName: "getRecentBattles", args: [wallet],
      })) as readonly bigint[];
      setIds([...r]);
      setSupported(true);
    } catch {
      setSupported(false);
    }
  }, [wallet]);

  useEffect(() => void refetch(), [refetch]);
  return { ids, supported, refetch };
}

/// Returns ALL active (not settled, endTime > now) battles on the arena.
/// Public — anyone can see ongoing battles. Walks the most recent
/// MAX_BATTLES_SCAN ids backwards from nextBattleId - 1.
export const MAX_BATTLES_SCAN = 100;

export function useActiveBattles() {
  const [battles, setBattles] = useState<Battle[]>([]);
  const [supported, setSupported] = useState<boolean>(hasArenaContract);
  const [loading, setLoading] = useState<boolean>(false);

  const refetch = useCallback(async () => {
    if (!hasArenaContract) { setSupported(false); setBattles([]); return; }
    setLoading(true);
    try {
      const nextId = Number(
        await publicClient.readContract({
          address: arenaAddress, abi: ritualArenaAbi, functionName: "nextBattleId",
        })
      );
      if (nextId <= 1) { setBattles([]); setSupported(true); return; }

      const startId = Math.max(1, nextId - MAX_BATTLES_SCAN);
      const ids: bigint[] = [];
      for (let i = startId; i < nextId; i++) ids.push(BigInt(i));

      const rows = await Promise.all(
        ids.map((id) =>
          publicClient
            .readContract({
              address: arenaAddress, abi: ritualArenaAbi, functionName: "getBattle", args: [id],
            })
            .then((r) => {
              const t = r as readonly [Address, Address, bigint, bigint, boolean, number, bigint, bigint, bigint, bigint];
              return {
                id,
                walletA: t[0],
                walletB: t[1],
                startTime: Number(t[2]),
                endTime: Number(t[3]),
                settled: t[4],
                outcome: Number(t[5]),
                votedApPoolA: t[6],
                votedApPoolB: t[7],
                powerA: Number(t[8]),
                powerB: Number(t[9]),
              };
            })
            .catch(() => null)
        )
      );
      // Ritual Arena contract stores endTime as `block.timestamp + BATTLE_DURATION`,
      // where block.timestamp is in MS (13 digits, > 1e12). Compare in MS —
      // same pattern as useTraining.ts:106 / useStakingActivity.ts.
      const now = Date.now();
      const active = rows
        .filter((r): r is Battle => r !== null)
        .filter((r) => !r.settled && r.endTime > now)
        .sort((a, b) => Number(b.id - a.id));
      setBattles(active);
      setSupported(true);
    } catch {
      setSupported(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);
  return { battles, supported, loading, refetch };
}

// ── Writes ─────────────────────────────────────────────────────────

export function useArenaWrites() {
  const [isPending, setIsPending] = useState(false);
  const [txHash, setTxHash] = useState<string>();

  const write = useCallback(async (functionName: string, args: unknown[]) => {
    if (!hasArenaContract) throw new Error("Arena is unavailable right now.");
    const walletClient = getSharedWalletClient();
    if (!walletClient) throw new Error("Wallet extension not found");
    setIsPending(true);
    setTxHash(undefined);
    try {
      const account = await ensureReadyForWrite();
      const hash = await walletClient.writeContract({
        account, chain: ritualTestnet, address: arenaAddress, abi: ritualArenaAbi, functionName, args,
        maxFeePerGas: RITUAL_GAS.maxFeePerGas,
        maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
      });
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    } finally {
      setIsPending(false);
    }
  }, []);

  const createBattle = useCallback(async (walletA: Address, walletB: Address) =>
    write("createBattle", [walletA, walletB]), [write]);

  const voteAP = useCallback(async (battleId: bigint, forA: boolean, amount: bigint) =>
    write("voteAP", [battleId, forA, amount]), [write]);

  // Approve AP spending by Arena contract. Uses max uint256 so user
  // never has to re-approve for subsequent votes.
  const approveAP = useCallback(async () => {
    const walletClient = getSharedWalletClient();
    if (!walletClient) throw new Error("Wallet extension not found");
    const account = await ensureReadyForWrite();
    const hash = await walletClient.writeContract({
      account, chain: ritualTestnet, address: apAddress, abi: [
        { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
      ], functionName: "approve", args: [arenaAddress, 2n ** 256n - 1n],
      maxFeePerGas: RITUAL_GAS.maxFeePerGas,
      maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
    });
    setTxHash(hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  }, []);

  const settle = useCallback(async (battleId: bigint) =>
    write("settle", [battleId]), [write]);

  const claimVotedAP = useCallback(async (battleId: bigint) =>
    write("claimVotedAP", [battleId]), [write]);

  const setArenaOptOut = useCallback(async (optOut: boolean) =>
    write("setArenaOptOut", [optOut]), [write]);

  const hasWallet = Boolean(getSelectedWalletProvider());

  return { isPending, txHash, hasWallet, createBattle, voteAP, approveAP, settle, claimVotedAP, setArenaOptOut };
}
