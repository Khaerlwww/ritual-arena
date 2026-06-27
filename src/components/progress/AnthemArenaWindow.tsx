// src/components/progress/AnthemArenaWindow.tsx
//
// V5 Battle arena window with PRE-CLEAN-V5 visual design.
//   * Banner-style leaderboard ranking (gradient cards, large #rank)
//   * Featured top player card with crown icon
//   * Rank badges (#1/#2/#3 highlighted)
//   * Larger identity cards via ArenaCardImage
//   * CLI header pattern with lucide icons
//   * Battle list with voteAP / settle / claim interactions
//
// Data sources are V5 — battle state from RitualArena (no daily check-in).

import { Activity, Crown, Gavel, Lock, Sparkles, Swords, Timer, Trophy, Vote } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Address } from "viem";
import { formatUnits } from "viem";
import { renderAnthemCardDataUrl } from "../../lib/cardImage";
import { generateAnthem } from "../../lib/anthem";
import { rankToRarity } from "../../lib/rarity";
import { explorerAddressUrl, apAddress, arenaAddress } from "../../lib/chains";
import { publicClient } from "../../hooks/useAnthem";
import { useAPBalance } from "../../hooks/useAPBalance";
import { RITUAL_AP_ABI } from "../../lib/apAbi";
import { shortTxError } from "../../lib/shortTxError";
import { RitualMark } from "../Logo";
import {
  hasArenaContract,
  useActiveBattles,
  useArenaLeaderboard,
  useArenaStats,
  useArenaWrites,
  useBattle,
  useRecentBattles,
  type ArenaStats,
  type Battle,
} from "../../hooks/useArena";
import { useIdentityLeaderboard, type IdentityLeaderboardEntry } from "../../hooks/useIdentityLeaderboard";
import type { Anthem } from "../../hooks/useAnthem";
import { useStaking } from "../../hooks/useStaking";
import { useOwnedPackNFTs, type OwnedPackCard } from "../../hooks/useOwnedPackNFTs";

type Tab = "arena" | "battles" | "leaderboard" | "activity";

// ── Visual helpers (pre-V5 design) ─────────────────────────────────

function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}

function fmtDuration(ms: number) {
  if (ms <= 0) return "00:00:00";
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  // >= 24h → show "Xd HH:MM"
  if (h >= 24) {
    const days = Math.floor(h / 24);
    const rh = h % 24;
    return `${days}d ${String(rh).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtAp(wei: bigint): string {
  return formatUnits(wei, 18);
}

function txError(err: unknown): string {
  return shortTxError(err, "Arena");
}

function CliHeader({ path, icon: Icon }: { path: string; icon?: typeof Swords }) {
  return (
    <div className="title-grad flex items-center gap-1.5 px-1.5 py-[3px]">
      {Icon && <Icon size={12} className="text-ice" />}
      <span className="font-mono text-[10px] text-iceaccent/60">{path}</span>
    </div>
  );
}

// ── Card image renderer ────────────────────────────────────────────

function LeaderboardCardImage({
  item,
  handle,
  tokenId,
  power,
  grade,
}: {
  item?: Anthem;
  handle: string;
  tokenId?: bigint;
  power: number;
  grade: string;
}) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const renderKey = useMemo(
    () => [item?.tokenId?.toString() ?? tokenId?.toString() ?? "unknown", item?.xHandle || handle, item?.wallet?.toString() || "", power, grade].join(":"),
    [item?.tokenId, item?.xHandle, item?.wallet, tokenId, handle, power, grade],
  );

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setUrl(undefined);
    const fallback = window.setTimeout(() => {
      if (!cancelled) setFailed(true);
    }, 3000);
    if (!item) {
      window.clearTimeout(fallback);
      setFailed(true);
      return () => { cancelled = true; window.clearTimeout(fallback); };
    }
    const rarityIdx = ["INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT"].indexOf(grade);
    const generated = generateAnthem(item.wallet, item.xHandle);
    void renderAnthemCardDataUrl(generated, {
      tokenId: item.tokenId !== undefined ? Number(item.tokenId) : undefined,
      currentPower: power,
      currentRarity: rarityIdx >= 0 ? rarityIdx : 0,
    })
      .then((nextUrl) => { if (!cancelled) setUrl(nextUrl); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => window.clearTimeout(fallback));
    return () => { cancelled = true; window.clearTimeout(fallback); };
  }, [renderKey, item, power, grade, tokenId, handle]);

  if (url) return <img src={url} alt={`${handle} arena card`} className="block h-full w-full object-cover" />;
  return (
    <div className="grid h-full w-full place-items-center bg-gradient-to-b from-[#0a1a16] to-[#020706] p-2 text-center">
      <div>
        <RitualMark size={28} />
        <p className="mt-2 break-all font-display text-[15px] font-bold text-aqua">{handle}</p>
        <p className="mt-1 text-[9px] text-iceaccent/55">#{tokenId?.toString() ?? "card"} · {power} Power · {grade}</p>
        {failed ? <p className="mt-1 text-[8px] text-[#ffd76a]">Fallback card</p> : null}
      </div>
    </div>
  );
}

// ── My Arena card ──────────────────────────────────────────────────

function MyArenaCard({ wallet }: { wallet?: Address }) {
  const { stats, supported, refetch } = useArenaStats(wallet);
  const { ids: recentIds } = useRecentBattles(wallet);

  if (!wallet) {
    return (
      <div className="bevel-in bg-coal p-3 font-mono text-[11px] text-iceaccent/65">
        Connect your wallet to view Arena stats.
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="bevel-in bg-coal p-3 font-mono text-[11px] text-[#E0C15A]">
        Arena is unavailable right now.
      </div>
    );
  }

  const winRate = stats.settledBattles > 0 ? Math.round((stats.wins / stats.settledBattles) * 100) : 0;
  return (
    <div className="bevel-out bg-wgray p-[2px]">
      <CliHeader path="My Arena" icon={Trophy} />
      <div className="bevel-in bg-coal p-3 font-mono text-[11px]">
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Arena Score" value={stats.arenaScore.toString()} sub="/ 200" accent="text-aqua" />
          <Stat label="Wins" value={stats.wins.toString()} sub={`${winRate}% win rate`} accent="text-[#ffd76a]" />
          <Stat label="Battles" value={stats.settledBattles.toString()} sub={`${stats.losses} losses`} accent="text-[#c9b8ff]" />
          <Stat label="Win Streak" value={stats.winStreak.toString()} sub={`best ${stats.bestWinStreak}`} accent="text-[#7dd3fc]" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-iceaccent/55">
          <span>Support Given: <span className="text-aqua">{fmtAp(stats.supportGiven)} AP</span></span>
          <span className="text-iceaccent/40">·</span>
          <span>Support Received: <span className="text-aqua">{fmtAp(stats.supportReceived)} AP</span></span>
          <span className="text-iceaccent/40">·</span>
          <span>Recent: <span className="text-aqua">{recentIds.length} battles</span></span>
          <button onClick={() => void refetch()} className="ml-auto text-[9px] text-iceaccent/50 hover:text-aqua">refresh ↻</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bevel-in-thin bg-[#061512] p-2">
      <p className="text-[9px] uppercase tracking-[0.15em] text-iceaccent/50">{label}</p>
      <p className={`mt-0.5 font-display text-lg font-bold ${accent ?? "text-aqua"}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[9px] text-iceaccent/40">{sub}</p> : null}
    </div>
  );
}

// ── Single Battle row ──────────────────────────────────────────────

function BattleRow({
  battleId,
  wallet,
  byWallet,
  identityByWallet,
}: {
  battleId: bigint;
  wallet?: Address;
  byWallet: Map<string, Anthem>;
  identityByWallet: Map<string, IdentityLeaderboardEntry>;
}) {
  const { battle, refetch } = useBattle(battleId);
  const writes = useArenaWrites();
  // Ritual chain stores endTime in MILLISECONDS (~1.78e12). Compare in MS,
  // not seconds — see useArena.ts:220 and contracts/arena/RitualArena.sol.
  const [now, setNow] = useState<number>(Date.now());
  const [msg, setMsg] = useState<string>();

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  const onSettle = useCallback(async () => {
    setMsg(undefined);
    try {
      const tx = await writes.settle(battleId);
      setMsg(`Settled — tx ${tx.hash.slice(0, 6)}…${tx.hash.slice(-4)}`);
      void refetch();
    } catch (e) { setMsg(txError(e)); }
  }, [writes, battleId, refetch]);

  if (!battle) {
    return (
      <div className="bevel-in-thin bg-[#061512] p-2 text-[10px] text-iceaccent/55">
        <div className="flex items-center gap-2">
          <span className="font-mono text-aqua">#{battleId.toString()}</span>
          <span>Loading battle…</span>
        </div>
      </div>
    );
  }

  const timeLeft = Math.max(0, battle.endTime - now);
  const canSettle = timeLeft === 0 && !battle.settled;
  const outcomeLabel = ["Unsettled", "Card A wins", "Card B wins", "Tie"][battle.outcome] ?? "Unknown";
  const me = wallet?.toLowerCase();
  const isParticipant = me === battle.walletA.toLowerCase() || me === battle.walletB.toLowerCase();
  const poolA = fmtAp(battle.votedApPoolA);
  const poolB = fmtAp(battle.votedApPoolB);
  const totalPool = Number(battle.votedApPoolA) + Number(battle.votedApPoolB);
  const aPct = totalPool > 0
    ? Math.round((Number(battle.votedApPoolA) / totalPool) * 100)
    : 50;
  const bPct = 100 - aPct;
  const lead = battle.settled
    ? outcomeLabel
    : battle.votedApPoolA === battle.votedApPoolB
      ? "Tie"
      : battle.votedApPoolA > battle.votedApPoolB
        ? `Card A leading ${aPct.toFixed(0)}%`
        : `Card B leading ${bPct.toFixed(0)}%`;

  const a = cardMeta(battle.walletA, battle.powerA, byWallet, identityByWallet);
  const b = cardMeta(battle.walletB, battle.powerB, byWallet, identityByWallet);
  const aIsYou = me === battle.walletA.toLowerCase();
  const bIsYou = me === battle.walletB.toLowerCase();
  const settledClass = battle.settled ? "outline outline-1 outline-[#ffd76a]/40" : "";

  return (
    <div className={`bevel-in relative grid gap-2.5 overflow-hidden bg-[#061512] p-3 font-mono ${settledClass}`}>
      <div className="absolute inset-x-0 top-0 flex h-1 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-teal2/90 to-teal2/40 transition-all" style={{ width: `${aPct}%` }} />
        <div className="h-full bg-gradient-to-l from-[#ff6a6a]/90 to-[#ff6a6a]/40 transition-all" style={{ width: `${bPct}%` }} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-aqua/15 pb-1.5 pt-1">
        <span className="inline-flex items-center gap-2 font-display text-[13px] font-bold text-aqua">
          <Swords size={13} className="text-[#ff6a6a]" /> Battle #{battle.id.toString()}
        </span>
        {battle.settled ? (
          <span className={`flex items-center gap-1 rounded-sm border px-2 py-0.5 font-display text-[11px] font-bold ${battle.outcome === 3 ? "border-[#c9b8ff]/40 bg-[#c9b8ff]/10 text-[#c9b8ff]" : "border-[#ffd76a]/40 bg-[#ffd76a]/10 text-[#ffd76a]"}`}>
            {battle.outcome === 1 && <Trophy size={11} />}
            {battle.outcome === 2 && <Trophy size={11} />}
            {outcomeLabel}
          </span>
        ) : timeLeft > 0 ? (
          <span className={`flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[11px] font-bold ${timeLeft < 3_600_000 ? "border-[#ffd76a]/50 bg-[#ffd76a]/10 text-[#ffd76a]" : "border-aqua/30 bg-aqua/10 text-aqua"}`}>
            <Timer size={11} /> {fmtDuration(timeLeft)}
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-sm border border-[#ffd76a]/60 bg-[#ffd76a]/15 px-2 py-0.5 font-bold text-[#ffd76a]">
            <Sparkles size={11} /> Ready to settle
          </span>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
        <div className={aIsYou ? "relative rounded-sm outline outline-2 outline-[#ffd76a]/70" : ""}>
          {aIsYou && <span className="absolute -top-2 left-2 z-10 rounded-sm bg-[#ffd76a] px-1.5 py-0.5 font-display text-[9px] font-bold text-coal">YOU</span>}
          <BattlePlayerCard title="Card A" meta={a} pool={Number(poolA)} accent="teal2" />
        </div>
        <div className="flex flex-col items-center justify-center gap-1 px-2">
          <Swords size={24} className="text-[#ff6a6a] drop-shadow-[0_0_6px_rgba(255,106,106,0.5)]" />
          <span className="font-display text-[14px] font-bold tracking-wider text-aqua">VS</span>
          <span className="rounded-sm bg-coal/80 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#c9b8ff]">
            P{battle.powerA} : P{battle.powerB}
          </span>
        </div>
        <div className={bIsYou ? "relative rounded-sm outline outline-2 outline-[#ffd76a]/70" : ""}>
          {bIsYou && <span className="absolute -top-2 right-2 z-10 rounded-sm bg-[#ffd76a] px-1.5 py-0.5 font-display text-[9px] font-bold text-coal">YOU</span>}
          <BattlePlayerCard title="Card B" meta={b} pool={Number(poolB)} accent="#ff6a6a" />
        </div>
      </div>

      <div className="grid gap-1.5 rounded-sm border border-aqua/15 bg-[#020706] p-2">
        <div className="flex items-center justify-between text-[10px] font-bold">
          <span className="flex items-center gap-1.5 text-teal2">
            <span className="inline-block h-2 w-2 rounded-full bg-teal2 shadow-[0_0_4px_rgba(75,216,200,0.7)]" />
            Pool A · {poolA} AP <span className="text-iceaccent/40">({aPct}%)</span>
          </span>
          <span className="flex items-center gap-1.5 text-[#ff6a6a]">
            <span className="text-iceaccent/40">({bPct}%)</span> {poolB} AP · Pool B
            <span className="inline-block h-2 w-2 rounded-full bg-[#ff6a6a] shadow-[0_0_4px_rgba(255,106,106,0.7)]" />
          </span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-sm bg-coal">
          <div className="h-full bg-gradient-to-r from-teal2/80 to-teal2 transition-all" style={{ width: `${aPct}%` }} />
          <div className="h-full bg-gradient-to-l from-[#ff6a6a]/80 to-[#ff6a6a] transition-all" style={{ width: `${bPct}%` }} />
        </div>
        <div className="text-center font-display text-[10px] font-bold text-[#ffd76a]">{lead}</div>
      </div>

      <div className="flex flex-col gap-2 border-t border-aqua/15 pt-2">
        {!battle.settled && !isParticipant && hasArenaContract ? (
          <VotePanel
            battleId={battleId}
            refetch={refetch}
            setMsg={setMsg}
            address={wallet}
            aLabel={a.handle ? `@${a.handle}` : `Wallet ${battle.walletA.slice(0, 6)}…`}
            bLabel={b.handle ? `@${b.handle}` : `Wallet ${battle.walletB.slice(0, 6)}…`}
            aPct={aPct}
            bPct={bPct}
          />
        ) : null}
        {canSettle ? (
          <button onClick={onSettle} disabled={writes.isPending} className="win-btn inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold disabled:opacity-50" style={{ background: "#ffd76a", color: "#061512", borderColor: "#ffd76a" }}>
            <Gavel size={11} /> {writes.isPending ? "Settling…" : "Settle Battle"}
          </button>
        ) : null}
        {battle.settled ? (
          <ClaimPanel battleId={battleId} refetch={refetch} setMsg={setMsg} />
        ) : null}
        {isParticipant ? (
          <span className="flex items-center gap-1 text-[10px] italic text-iceaccent/55">
            <Lock size={10} /> You're fighting — cannot back
          </span>
        ) : null}
      </div>
      {msg ? (
        <p className={`rounded-sm border px-2.5 py-1 font-mono text-[10px] ${msg.toLowerCase().includes("cancelled") || msg.toLowerCase().includes("failed") ? "border-[#ff8080]/40 bg-[#2a0f0f] text-[#ff8080]" : "border-aqua/30 bg-[#020706] text-aqua"}`}>
          {msg}
        </p>
      ) : null}
    </div>
  );
}

function VotePanel({
  battleId,
  refetch,
  setMsg,
  address,
  aLabel,
  bLabel,
  aPct,
  bPct,
}: {
  battleId: bigint;
  refetch: () => void;
  setMsg: (s: string | undefined) => void;
  address?: Address;
  aLabel: string;
  bLabel: string;
  aPct: number;
  bPct: number;
}) {
  const writes = useArenaWrites();
  const [side, setSide] = useState<"A" | "B">("A");
  const [amount, setAmount] = useState<string>("10");
  const parsedAmount = useMemo(() => {
    try { return BigInt(Math.floor(parseFloat(amount) * 1e18)); } catch { return 0n; }
  }, [amount]);

  // Live AP balance + Arena allowance. Refetch after every vote/approve
  // so the UI never shows stale "Approved ✓" or stale balance.
  const ap = useAPBalance(address);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const refetchAllowance = useCallback(async () => {
    if (!address || !arenaAddress) return;
    try {
      const a = await publicClient.readContract({
        address: apAddress, abi: RITUAL_AP_ABI, functionName: "allowance", args: [address as Address, arenaAddress],
      }) as bigint;
      setAllowance(a);
    } catch {/* keep last */}
  }, [address]);
  useEffect(() => { void refetchAllowance(); }, [refetchAllowance]);
  const needsApproval = allowance < parsedAmount;

  const onApprove = useCallback(async () => {
    setMsg(undefined);
    try {
      setMsg("Approving AP for Arena…");
      const tx = await writes.approveAP();
      setMsg(`Approved AP — tx ${tx.hash.slice(0, 6)}…${tx.hash.slice(-4)}`);
      await refetchAllowance();
    } catch (e) { setMsg(txError(e)); }
  }, [writes, refetchAllowance]);

  const onVote = useCallback(async () => {
    if (parsedAmount <= 0n) { setMsg("Amount must be > 0"); return; }
    if (needsApproval) { setMsg("Approve AP first"); return; }
    setMsg(undefined);
    try {
      const tx = await writes.voteAP(battleId, side === "A", parsedAmount);
      setMsg(`Voted ${amount} AP on side ${side} — tx ${tx.hash.slice(0, 6)}…${tx.hash.slice(-4)}`);
      refetch();
      refetchAllowance();
    } catch (e) { setMsg(txError(e)); }
  }, [writes, battleId, side, parsedAmount, amount, refetch, refetchAllowance, needsApproval]);

  const balDisplay = ap.state ? Math.floor(ap.state.balance).toLocaleString() : "…";
  const balNum = ap.state?.balance ?? 0;
  const amountNum = parseFloat(amount || "0");
  const hasEnoughAP = balNum >= amountNum;
  const overBalance = amountNum > balNum;

  // Quick-chip amounts — one-tap presets that respect the user's balance.
  const chipAmounts = [10, 25, 50, 100];
  const setMax = () => setAmount(String(Math.floor(balNum)));
  const setChip = (n: number) => setAmount(String(Math.min(n, Math.floor(balNum))));

  const sideAColor = "#4BD8C8";        // teal2
  const sideBColor = "#ff6a6a";
  const accent = side === "A" ? sideAColor : sideBColor;

  return (
    <div className="grid gap-2 rounded-sm border border-aqua/15 bg-[#020706]/80 p-2.5 font-mono">
      {needsApproval && (
        <button
          onClick={onApprove}
          disabled={writes.isPending}
          className="flex items-center justify-between gap-2 rounded-sm border border-[#ffd76a]/40 bg-[#3a2a08]/60 px-2.5 py-1.5 text-left text-[11px] font-bold text-[#ffd76a] transition-colors hover:bg-[#3a2a08] disabled:opacity-50"
        >
          <span className="flex items-center gap-1.5">
            <span aria-hidden>⚠</span>
            <span>Approve AP for Arena (one-time)</span>
          </span>
          <span className="rounded-sm bg-[#ffd76a] px-2 py-0.5 text-[10px] text-coal">
            {writes.isPending ? "Approving…" : "Approve"}
          </span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        {(["A", "B"] as const).map((s) => {
          const isSelected = side === s;
          const color = s === "A" ? sideAColor : sideBColor;
          const label = s === "A" ? aLabel : bLabel;
          const pct = s === "A" ? aPct : bPct;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`relative flex flex-col items-start gap-1 rounded-sm border-2 p-2 text-left transition-all ${
                isSelected
                  ? "shadow-[0_0_18px_rgba(0,0,0,0.6)]"
                  : "hover:scale-[1.01]"
              }`}
              style={{
                borderColor: isSelected ? color : `${color}33`,
                background: isSelected ? `${color}1a` : "#061512",
              }}
            >
              {isSelected && (
                <span
                  className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-coal"
                  style={{ background: color }}
                  aria-hidden
                >
                  ✓
                </span>
              )}
              <span
                className="font-display text-[10px] font-bold tracking-[0.18em]"
                style={{ color: isSelected ? color : `${color}cc` }}
              >
                SIDE {s}
              </span>
              <span className="truncate text-[12px] font-bold text-ice">{label}</span>
              <span className="font-mono text-[9px] text-iceaccent/50">
                Pool {pct}%
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-bold uppercase tracking-[0.18em] text-iceaccent/60">
            Vote weight
          </span>
          <span className="text-iceaccent/50">
            AP balance: <span className="font-bold text-aqua">{balDisplay}</span>
          </span>
        </div>
        <div className="flex items-stretch gap-1.5">
          {chipAmounts.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setChip(n)}
              disabled={balNum <= 0}
              className="rounded-sm border border-aqua/30 bg-coal px-2 py-1 text-[11px] font-bold text-aqua transition-colors hover:border-aqua hover:bg-aqua/15 disabled:opacity-30"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={setMax}
            disabled={balNum <= 0}
            className="rounded-sm border border-[#ffd76a]/40 bg-coal px-2 py-1 text-[11px] font-bold text-[#ffd76a] transition-colors hover:border-[#ffd76a] hover:bg-[#ffd76a]/15 disabled:opacity-30"
          >
            MAX
          </button>
          <input
            type="number"
            min="0"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`min-w-0 flex-1 rounded-sm border bg-coal px-2 py-1 text-right text-[12px] font-bold placeholder:text-iceaccent/30 ${
              overBalance ? "border-[#ff6a6a]/60 text-[#ff6a6a]" : "border-aqua/30 text-aqua"
            }`}
            placeholder="AP"
          />
        </div>
        {overBalance && (
          <p className="text-[9px] text-[#ff6a6a]">
            Not enough AP — need {amountNum.toLocaleString()}, you have {balDisplay}.
          </p>
        )}
      </div>

      <button
        onClick={onVote}
        disabled={writes.isPending || parsedAmount <= 0n || !hasEnoughAP || needsApproval}
        title={
          needsApproval ? "Approve AP first" :
          !hasEnoughAP ? `Need ${amountNum} AP, you have ${balDisplay}` :
          undefined
        }
        className="group relative flex items-center justify-center gap-2 overflow-hidden rounded-sm border-2 py-2 font-display text-[12px] font-bold tracking-wider text-coal transition-all disabled:opacity-30 disabled:grayscale"
        style={{
          borderColor: accent,
          background: `linear-gradient(180deg, ${accent} 0%, ${accent}cc 100%)`,
          boxShadow: !writes.isPending && hasEnoughAP && !needsApproval
            ? `0 0 14px ${accent}80, inset 0 0 12px rgba(255,255,255,0.2)`
            : "none",
        }}
      >
        <Vote size={13} />
        {writes.isPending
          ? "Voting…"
          : needsApproval
            ? "Approve AP first"
            : `Back ${side} · ${amountNum > 0 ? amountNum.toLocaleString() : "0"} AP`}
      </button>
    </div>
  );
}

function ClaimPanel({ battleId, refetch, setMsg }: { battleId: bigint; refetch: () => void; setMsg: (s: string | undefined) => void }) {
  const writes = useArenaWrites();
  const onClaim = useCallback(async () => {
    setMsg(undefined);
    try {
      const tx = await writes.claimVotedAP(battleId);
      setMsg(`Claimed — tx ${tx.hash.slice(0, 6)}…${tx.hash.slice(-4)}`);
      refetch();
    } catch (e) { setMsg(txError(e)); }
  }, [writes, battleId, refetch]);
  return (
    <button onClick={onClaim} disabled={writes.isPending} className="win-btn text-[10px] disabled:opacity-50">
      {writes.isPending ? "Claiming…" : "Claim AP"}
    </button>
  );
}

// ── Battles tab ────────────────────────────────────────────────────

// Card meta derived from a player's wallet: pulls canonical identity
// snapshot, joins with gallery item (card image), and falls back to
// the battle-recorded power if neither is available.
function cardMeta(
  wallet: Address,
  battlePower: number,
  byWallet: Map<string, Anthem>,
  identityByWallet: Map<string, IdentityLeaderboardEntry>,
) {
  const key = wallet.toLowerCase();
  const item = byWallet.get(key);
  const row = identityByWallet.get(key);
  const power = row?.currentPower || battlePower || 1;
  const grade = row ? rankToRarity(row.currentRarity) : "INITIATE";
  return {
    item,
    handle: item?.xHandle ? `@${item.xHandle}` : shortAddr(wallet),
    tokenId: item?.tokenId,
    wallet,
    power,
    grade,
    identityScore: row?.totalScore ?? 0,
    identityRank: row?.identityTier ?? "INITIATE",
  };
}

// One player slot in the visual battle row — card image (small, 56x56)
// on the left, compact stats on the right. Sized to keep the whole row
// readable, not the full column.
function BattlePlayerCard({
  title,
  meta,
  pool,
  accent = "teal2",
}: {
  title: string;
  meta: ReturnType<typeof cardMeta>;
  pool: number;
  accent?: string;
}) {
  const accentText = accent === "teal2" ? "text-teal2" : "text-[#ff6a6a]";
  const accentBg = accent === "teal2" ? "bg-teal2" : "bg-[#ff6a6a]";
  return (
    <div className="bevel-in-thin relative grid min-w-0 gap-1.5 overflow-hidden border-l-2 border-[#020706] bg-[#061512] p-2 font-mono"
      style={{ borderLeftColor: accent }}>
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 text-[9px] font-bold ${accentText}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${accentBg} shadow-[0_0_4px_rgba(0,0,0,0.4)]`} />
          {title}
        </span>
        {meta.tokenId !== undefined ? (
          <span className="text-[9px] text-iceaccent/45">#{meta.tokenId.toString()}</span>
        ) : null}
      </div>
      <div className="flex items-start gap-2">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-sm border border-aqua/20 bg-black">
          <LeaderboardCardImage
            item={meta.item}
            handle={meta.handle}
            tokenId={meta.item?.tokenId}
            power={meta.power}
            grade={meta.grade}
          />
        </div>
        <div className="grid min-w-0 flex-1 gap-0.5 text-[10px]">
          <p className="truncate font-display text-[11px] font-bold text-aqua">{meta.handle}</p>
          <p className="truncate text-[9px] text-iceaccent/45">{shortAddr(meta.wallet)}</p>
          <span className="flex justify-between">
            <span className="text-iceaccent/50">Power</span>
            <span className="font-bold text-aqua">{meta.power}</span>
          </span>
          <span className="flex justify-between">
            <span className="text-iceaccent/50">Grade</span>
            <span className="font-bold text-[#c9b8ff]">{meta.grade}</span>
          </span>
          <span className="flex justify-between border-t border-aqua/10 pt-0.5">
            <span className="text-iceaccent/50">Pool</span>
            <span className="font-display font-bold text-[#ffd76a]">{pool} AP</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function BattlesTab({
  wallet,
  gallery = [],
  identityByWallet,
}: {
  wallet?: Address;
  gallery?: Anthem[];
  identityByWallet: Map<string, IdentityLeaderboardEntry>;
}) {
  const { battles, loading, refetch } = useActiveBattles();
  const byWallet = useMemo(() => {
    const m = new Map<string, Anthem>();
    for (const a of gallery) if (a.wallet) m.set(a.wallet.toLowerCase(), a);
    return m;
  }, [gallery]);

  return (
    <div className="grid gap-2">
      <div className="bevel-out bg-wgray p-[2px]">
        <CliHeader path="Battle Arena Global" icon={Swords} />
        <div className="bevel-in bg-coal p-3 font-mono text-[11px]">
          {battles.length === 0 ? (
            <div className="bevel-in-thin flex flex-col items-center gap-2 bg-[#061512] p-4 text-center">
              <p className="text-[12px] font-bold text-[#ffd76a]">
                {loading ? "Loading battles…" : "No active battles"}
              </p>
              <p className="text-[10px] text-iceaccent/55">
                The arena owner pairs eligible cards every cycle. Once a match starts, it shows up here for everyone to back.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="flex items-center justify-between text-[9px] text-iceaccent/50">
                <span>{battles.length} active battle{battles.length === 1 ? "" : "s"} · public feed</span>
                <button onClick={() => void refetch()} className="hover:text-aqua">refresh ↻</button>
              </div>
              {battles.map((b) => (
                <BattleRow
                  key={b.id.toString()}
                  battleId={b.id}
                  wallet={wallet}
                  byWallet={byWallet}
                  identityByWallet={identityByWallet}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Arena leaderboard tab ───────────────────────────────────────────

function ArenaLeaderboard({ rows, loading, gallery }: { rows: { wallet: Address; arenaScore: number }[]; loading: boolean; gallery: Anthem[] }) {
  const galleryByWallet = useMemo(() => {
    const m = new Map<string, Anthem>();
    for (const a of gallery) if (a.wallet) m.set(a.wallet.toLowerCase(), a);
    return m;
  }, [gallery]);

  if (loading) {
    return <p className="text-[11px] text-aqua/70">Loading arena leaderboard from RitualArena…</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="bevel-in-thin flex flex-col items-center gap-2 bg-[#061512] p-4 text-center">
        <p className="text-[12px] font-bold text-[#ffd76a]">No battles yet</p>
        <p className="text-[10px] text-iceaccent/55">Once a battle is settled, winners and losers appear here.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      {rows.map((row, i) => {
        const rank = i + 1;
        const podium = rank <= 3;
        const galleryItem = galleryByWallet.get(row.wallet.toLowerCase());
        return (
          <div
            key={row.wallet}
            className={`bevel-in-thin relative overflow-hidden bg-[#061512] p-2 text-[10px] ${podium ? "outline outline-1 outline-[#ffd76a]/30" : ""}`}
          >
            <div
              className="absolute inset-0 opacity-25"
              style={{
                background: podium
                  ? "linear-gradient(90deg, rgba(255,215,106,.4), transparent 55%, rgba(201,184,255,.28))"
                  : "linear-gradient(90deg, rgba(75,216,200,.35), transparent 55%, rgba(201,184,255,.24))",
              }}
            />
            <div className="relative grid grid-cols-[56px_2rem_1fr_auto] items-center gap-3">
              <div className="h-14 w-14 overflow-hidden border border-aqua/20 bg-black">
                <LeaderboardCardImage
                  item={galleryItem}
                  handle={galleryItem?.xHandle ? `@${galleryItem.xHandle}` : shortAddr(row.wallet)}
                  tokenId={galleryItem?.tokenId}
                  power={1}
                  grade="INITIATE"
                />
              </div>
              <span className={`font-display text-xl font-bold ${rank === 1 ? "text-[#ffd76a]" : rank === 2 ? "text-[#c9b8ff]" : rank === 3 ? "text-[#7dd3fc]" : "text-iceaccent/60"}`}>
                #{rank}
              </span>
              <a href={explorerAddressUrl(row.wallet)} target="_blank" rel="noreferrer" className="font-handle font-bold text-aqua hover:underline">
                {galleryItem?.xHandle ? `@${galleryItem.xHandle}` : shortAddr(row.wallet)}
              </a>
              <span className="font-display text-aqua">{row.arenaScore.toLocaleString()}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Identity leaderboard (existing component, kept for cross-ref) ──

function LeaderboardView({
  rows,
  loading,
  syncPending,
  me,
  gallery,
  myFirstPack,
}: {
  rows: IdentityLeaderboardEntry[];
  loading: boolean;
  syncPending?: boolean;
  me?: string;
  gallery: Anthem[];
  myFirstPack?: OwnedPackCard | undefined;
}) {
  const galleryByWallet = useMemo(() => {
    const m = new Map<string, Anthem>();
    for (const item of gallery) if (item.wallet) m.set(item.wallet.toLowerCase(), item);
    return m;
  }, [gallery]);
  // If the connected user has no Anthem NFT but has RitualPackNFTs,
  // synthesize a minimal "Anthem" entry from the first pack card so
  // their leaderboard row isn't a blank placeholder.
  const meSynthFromPack = useMemo(() => {
    if (!me || !myFirstPack) return undefined;
    return {
      tokenId: myFirstPack.tokenId,
      wallet: me as `0x${string}`,
      xHandle: me.slice(0, 6),
      mood: "",
      lyrics: "",
      musicPrompt: "",
      audioURI: "",
      metadataURI: "",
      createdAt: 0n,
    } as unknown as Anthem;
  }, [me, myFirstPack]);
  return (
    <div className="bevel-out bg-wgray p-[2px]">
      <CliHeader path="Identity Leaderboard" icon={Crown} />
      <div className="bevel-in bg-coal p-3 font-mono">
        <p className="mb-2 text-[10px] text-iceaccent/55">
          Ranked by Identity Score, highest to lowest. Source: <span className="text-aqua">IdentityRegistry</span>.
        </p>
        {loading ? (
          <p className="text-[11px] text-aqua/70">Loading identity scores from IdentityRegistry…</p>
        ) : null}
        {!loading && (syncPending || rows.length === 0) ? (
          <div className="bevel-in-thin flex flex-col items-center gap-2 bg-[#061512] p-4 text-center">
            <p className="text-[12px] font-bold text-[#ffd76a]">Sync Pending</p>
            <p className="text-[10px] text-iceaccent/55">
              No wallets synced to IdentityRegistry yet. Train cards to appear here.
            </p>
          </div>
        ) : null}
        <div className="grid gap-2">
          {rows.map((row, i) => {
            let galleryItem = galleryByWallet.get(row.wallet.toLowerCase());
            const isYou = me && me === row.wallet.toLowerCase();
            // Connected-user fallback: if their Anthem NFT isn't in the
            // gallery (e.g. they only have RitualPackNFTs), use the
            // first pack card so the row has a real visual.
            if (!galleryItem && isYou) galleryItem = meSynthFromPack;
            const rank = i + 1;
            const isPodium = rank <= 3;
            return (
              <div
                key={row.wallet}
                className={`bevel-in-thin relative overflow-hidden bg-[#061512] p-2 text-[10px] ${isYou ? "outline outline-1 outline-aqua/50" : ""}`}
              >
                <div
                  className="absolute inset-0 opacity-25"
                  style={{
                    background: isPodium
                      ? "linear-gradient(90deg, rgba(255,215,106,.4), transparent 55%, rgba(201,184,255,.28))"
                      : "linear-gradient(90deg, rgba(75,216,200,.35), transparent 55%, rgba(201,184,255,.24))",
                  }}
                />
                <div className="relative grid gap-3 sm:grid-cols-[56px_2rem_1fr_auto] sm:items-center">
                  <div className="h-14 w-14 overflow-hidden border border-aqua/20 bg-black">
                    <LeaderboardCardImage
                      item={galleryItem}
                      handle={galleryItem?.xHandle ? `@${galleryItem.xHandle}` : shortAddr(row.wallet)}
                      tokenId={galleryItem?.tokenId}
                      power={row.currentPower || 1}
                      grade={rankToRarity(row.currentRarity)}
                    />
                  </div>
                  <span className={`font-display text-xl font-bold ${rank === 1 ? "text-[#ffd76a]" : rank === 2 ? "text-[#c9b8ff]" : rank === 3 ? "text-[#7dd3fc]" : "text-iceaccent/60"}`}>
                    #{rank}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      {isPodium && <Crown size={14} className={rank === 1 ? "text-[#ffd76a]" : "text-iceaccent/60"} />}
                      <a href={explorerAddressUrl(row.wallet)} target="_blank" rel="noreferrer" className="font-display text-[15px] font-bold text-aqua hover:underline">
                        @{galleryItem?.xHandle || shortAddr(row.wallet)}
                      </a>
                      {isYou ? <span className="text-[8px] font-bold text-aqua">YOU</span> : null}
                    </div>
                    <p className="text-iceaccent/40">{shortAddr(row.wallet)}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-right text-iceaccent/65 sm:grid-cols-2">
                    <span>Identity Score: <span className="font-display text-aqua">{row.totalScore.toLocaleString()}</span></span>
                    <span>Identity Rank: <span className="text-ice">{row.identityTier}</span></span>
                    <span>Power: <span className="text-aqua">{row.currentPower || 1}</span></span>
                    <span>Grade: <span className="text-[#c9b8ff]">{rankToRarity(row.currentRarity)}</span></span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Featured top player banner (pre-V5 visual style) ───────────────

function FeaturedTopPlayer({ rows, gallery }: { rows: IdentityLeaderboardEntry[]; gallery: Anthem[] }) {
  const top = rows[0];
  if (!top) return null;
  const galleryItem = gallery.find((g) => g.wallet?.toLowerCase() === top.wallet.toLowerCase());
  return (
    <div className="bevel-out relative overflow-hidden bg-wgray p-[2px]">
      <div className="absolute inset-0 opacity-30" style={{ background: "linear-gradient(135deg, rgba(255,215,106,.45), transparent 60%, rgba(75,216,200,.4))" }} />
      <CliHeader path="Featured Top Player" icon={Crown} />
      <div className="bevel-in relative grid gap-3 bg-coal p-3 sm:grid-cols-[88px_1fr_auto] sm:items-center">
        <div className="h-20 w-20 overflow-hidden border-2 border-[#ffd76a]/40 bg-black shadow-[0_0_18px_rgba(255,215,106,.3)]">
          <LeaderboardCardImage
            item={galleryItem}
            handle={galleryItem?.xHandle ? `@${galleryItem.xHandle}` : shortAddr(top.wallet)}
            tokenId={galleryItem?.tokenId}
            power={top.currentPower || 1}
            grade={rankToRarity(top.currentRarity)}
          />
        </div>
        <div>
          <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[#ffd76a]">
            <Crown size={14} className="text-[#ffd76a]" /> #1 RANK
          </p>
          <a href={explorerAddressUrl(top.wallet)} target="_blank" rel="noreferrer" className="font-display text-2xl font-extrabold text-aqua hover:underline">
            @{galleryItem?.xHandle || shortAddr(top.wallet)}
          </a>
          <p className="mt-1 text-[10px] text-iceaccent/55">
            Identity Rank <span className="text-ice">{top.identityTier}</span> · Training Lv{" "}
            <span className="text-aqua">{top.trainingLevel}</span> · Power{" "}
            <span className="text-aqua">{top.currentPower || 1}</span> · Grade{" "}
            <span className="text-[#c9b8ff]">{rankToRarity(top.currentRarity)}</span>
          </p>
        </div>
        <div className="bevel-in-thin bg-[#061512] px-3 py-2 text-right">
          <p className="text-[9px] uppercase tracking-[0.15em] text-iceaccent/50">Identity Score</p>
          <p className="font-display text-2xl font-extrabold text-aqua">{top.totalScore.toLocaleString()}</p>
          <p className="text-[9px] text-iceaccent/40">/ 1000</p>
        </div>
      </div>
    </div>
  );
}

// ── Live activity feed ─────────────────────────────────────────────

function LiveActivityFeed({ identity }: { identity: ReturnType<typeof useIdentityLeaderboard> }) {
  const recent = identity.rows.slice(0, 6);
  return (
    <div className="bevel-out bg-wgray p-[2px]">
      <CliHeader path="Live Activity" icon={Activity} />
      <div className="bevel-in bg-coal p-3 font-mono text-[11px]">
        <p className="mb-2 text-[10px] text-iceaccent/55">
          Recent top wallets from the live identity ranking.
        </p>
        {recent.length === 0 ? (
          <div className="bevel-in-thin flex flex-col items-center gap-2 bg-[#061512] p-4 text-center">
            <p className="text-[12px] font-bold text-[#ffd76a]">No activity yet</p>
            <p className="text-[10px] text-iceaccent/55">Train, forge, or settle battles to populate the leaderboard.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {recent.map((row, i) => (
              <div key={row.wallet} className="bevel-in-thin flex items-center justify-between gap-2 bg-[#061512] px-2 py-1.5 text-[10px]">
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${i === 0 ? "text-[#ffd76a]" : "text-aqua"}`}>#{i + 1}</span>
                  <a href={explorerAddressUrl(row.wallet)} target="_blank" rel="noreferrer" className="text-aqua hover:underline">
                    @{row.wallet.slice(0, 6)}…{row.wallet.slice(-4)}
                  </a>
                </div>
                <div className="flex items-center gap-3 text-iceaccent/55">
                  <span>Score: <span className="text-aqua">{row.totalScore.toLocaleString()}</span></span>
                  <span>Power: <span className="text-aqua">{row.currentPower || 1}</span></span>
                  <span>Grade: <span className="text-[#c9b8ff]">{rankToRarity(row.currentRarity)}</span></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main window ────────────────────────────────────────────────────

export function AnthemArenaWindow({ address, gallery = [] }: { address?: Address; gallery?: Anthem[] }) {
  const [tab, setTab] = useState<Tab>("arena");
  const identity = useIdentityLeaderboard();
  const { rows: arenaRows, loading: arenaLoading, refetch: refetchArena } = useArenaLeaderboard(0, 20);

  const me = address?.toLowerCase();

  // Connected user's owned pack NFTs (RitualPackNFT). The leaderboard's
  // gallery only includes Anthem NFTs (the legacy forge path) — if the
  // user only has pack cards we fall back to the first pack card so the
  // leaderboard row has a visual instead of the placeholder.
  const myOwnedPacks = useOwnedPackNFTs(address);
  const myFirstPack = myOwnedPacks.cards[0];

  // Build a wallet→IdentityLeaderboardEntry map for fast lookup when
  // rendering battle cards. Recomputed whenever the leaderboard refreshes.
  const identityByWallet = useMemo(() => {
    const m = new Map<string, IdentityLeaderboardEntry>();
    for (const r of identity.rows) m.set(r.wallet.toLowerCase(), r);
    return m;
  }, [identity.rows]);

  const tabs: { id: Tab; label: string; icon: typeof Swords }[] = [
    { id: "arena", label: "My Arena", icon: Trophy },
    { id: "battles", label: "Battle Arena", icon: Swords },
    { id: "leaderboard", label: "Leaderboards", icon: Crown },
    { id: "activity", label: "Live Activity", icon: Activity },
  ];

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 font-ui text-[11px] font-bold ${tab === t.id ? "title-grad text-ice" : "bevel-out bg-wgray text-coal hover:bg-[#cdcdcd]"}`}
          >
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>
      {tab === "arena" ? (
        <div className="grid gap-2">
          <MyArenaCard wallet={address} />
        </div>
      ) : null}
      {tab === "battles" ? <BattlesTab wallet={address} gallery={gallery} identityByWallet={identityByWallet} /> : null}
      {tab === "leaderboard" ? (
        <div className="grid gap-2">
          <div className="bevel-out bg-wgray p-[2px]">
            <CliHeader path="Arena Leaderboard" icon={Swords} />
            <div className="bevel-in bg-coal p-3 font-mono text-[11px]">
              <p className="mb-2 text-[10px] text-iceaccent/55">
                Top 3 ranked by Arena Score (max 200, from battle wins + entry bonus). Source: <span className="text-aqua">RitualArena</span>.
              </p>
              <ArenaLeaderboard rows={arenaRows.slice(0, 3)} loading={arenaLoading} gallery={gallery} />
              <button onClick={() => void refetchArena()} className="mt-2 self-end text-[9px] text-iceaccent/50 hover:text-aqua">refresh ↻</button>
            </div>
          </div>
          <FeaturedTopPlayer rows={identity.rows} gallery={gallery} />
          <LeaderboardView rows={identity.rows} loading={identity.loading} syncPending={identity.syncPending} me={me} gallery={gallery} myFirstPack={myFirstPack} />
        </div>
      ) : null}
      {tab === "activity" ? <LiveActivityFeed identity={identity} /> : null}
    </div>
  );
}

export default AnthemArenaWindow;
