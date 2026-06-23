import { CalendarCheck, ChevronDown, Lock, Sparkles, Zap, TrendingUp, Award, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import type { GalleryItem } from "../AnthemCard";
import { renderAnthemCardDataUrl } from "../../lib/cardImage";
import { useTrainingProgress, useTrainingWrites, type TrainPhase } from "../../hooks/useTraining";
import { rankToRarity } from "../../lib/rarity";
import { getVisualEvolutionUnlocks, EVOLUTION_THRESHOLDS } from "../../lib/visualEvolution";
import { VisualEvolutionEffects } from "../card/VisualEvolutionEffects";
import { explorerTxUrl } from "../../lib/chains";

// Evolution thresholds live in lib/visualEvolution.ts — single source of truth.
// `EVOLUTION_THRESHOLDS` is the data-driven manifest used by every render target.

const LEVEL_SIZE = 500;

const POWER_THRESHOLDS = [
  { min: 0,  max: 20, name: "INITIATE",  color: "bg-teal2" },
  { min: 20, max: 40, name: "BITTY",    color: "bg-[#7dd3fc]" },
  { min: 40, max: 66, name: "RITTY",    color: "bg-teal2" },
  { min: 66, max: 80, name: "RITUALIST", color: "bg-[#ffd76a]" },
  { min: 80, max: 100, name: "RADIANT", color: "bg-[#c9b8ff]" },
];

function cardKey(card?: GalleryItem, address?: Address) {
  return `${address || "wallet"}:${card?.tokenId ?? card?.mintId ?? card?.seed ?? "preview"}`;
}

function levelFromXp(xp: number) {
  const level = Math.floor(xp / LEVEL_SIZE) + 1;
  return { level, into: xp % LEVEL_SIZE, pct: Math.round(((xp % LEVEL_SIZE) / LEVEL_SIZE) * 100) };
}

/**
 * Live transaction feedback for the Train action. Renders nothing while idle,
 * shows the current phase with a leading icon and the (optional) tx hash
 * linking to the explorer. On error, surfaces the underlying message.
 */
function TxPhaseBanner({
  phase,
  txHash,
  error,
}: {
  phase: TrainPhase;
  txHash?: string;
  error?: string;
}) {
  if (phase === "idle") {
    return null;
  }
  const tone =
    phase === "success"
      ? "bg-[#06231d] text-[#1CC744] border-[#1CC744]/40"
      : phase === "error"
        ? "bg-[#2a0f12] text-[#ff6a6a] border-[#ff6a6a]/40"
        : "bg-[#06231d] text-aqua border-aqua/40";
  const Icon =
    phase === "success" ? CheckCircle2 : phase === "error" ? AlertCircle : Loader2;
  const label =
    phase === "awaitingSignature"
      ? "Awaiting wallet signature — confirm in your wallet to continue."
      : phase === "submitted"
        ? "Transaction submitted — waiting for chain confirmation."
        : phase === "confirming"
          ? "Transaction confirming on-chain — do not close this window."
          : phase === "success"
            ? "Transaction confirmed. Training applied."
            : phase === "error"
              ? "Transaction failed."
              : "";
  return (
    <div className={`bevel-in mt-3 border p-2.5 text-[11px] leading-5 ${tone}`}>
      <p className="flex items-center gap-1.5 font-bold">
        <Icon size={12} className={phase === "success" || phase === "error" ? "" : "animate-spin"} />
        {label}
      </p>
      {txHash ? (
        <p className="mt-1 break-all text-[10px] opacity-80">
          tx:{" "}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer" className="underline">
            {txHash}
          </a>
        </p>
      ) : null}
      {phase === "error" && error ? (
        <p className="mt-1 break-words text-[10px] opacity-80">{error}</p>
      ) : null}
    </div>
  );
}

function ActiveCardImage({ card, level, snapshot }: { card?: GalleryItem; level: number; snapshot?: { currentPower?: number; currentRarity?: number } }) {
  const [url, setUrl] = useState<string>();
  const [timedOut, setTimedOut] = useState(false);
  const needsSnapshot = Boolean(card?.tokenId && !card?.preview);
  const hasValidSnapshotPower = snapshot?.currentPower !== undefined && snapshot.currentPower > 0;
  useEffect(() => {
    let cancelled = false;
    setUrl(undefined);
    setTimedOut(false);
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) setTimedOut(true);
    }, 3000);
    if (card && (!needsSnapshot || hasValidSnapshotPower)) void renderAnthemCardDataUrl(card, {
      tokenId: card.tokenId,
      currentPower: snapshot?.currentPower,
      currentRarity: snapshot?.currentRarity,
    }).then((u) => !cancelled && setUrl(u)).catch(() => !cancelled && setTimedOut(true)).finally(() => window.clearTimeout(fallbackTimer));
    else window.clearTimeout(fallbackTimer);
    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [card?.seed, card?.tokenId, card?.rarity, card?.xHandle, needsSnapshot, hasValidSnapshotPower, snapshot?.currentPower, snapshot?.currentRarity]);

  return (
    <VisualEvolutionEffects
      trainingLevel={level}
      className="bevel-out relative bg-wgray p-[3px]"
    >
      <div className="bevel-in relative overflow-hidden bg-black">
        {url ? <img src={url} alt="Active training card" className="block w-full" /> : (
          <div className="grid aspect-square place-items-center bg-[#061512] p-4 text-center font-mono text-aqua/70">
            <div>
              <p className="font-bold">@{card?.xHandle || "anon"}</p>
              <p>#{card?.tokenId ?? "preview"} · {snapshot?.currentPower || card?.score || 1} Power</p>
              <p>{snapshot?.currentRarity !== undefined ? rankToRarity(snapshot.currentRarity) : card?.rarity || "INITIATE"}</p>
              {timedOut || (needsSnapshot && !hasValidSnapshotPower) ? <p className="mt-1 text-[10px] text-iceaccent/50">Fallback card view</p> : null}
            </div>
          </div>
        )}
      </div>
    </VisualEvolutionEffects>
  );
}

export function TrainingWindow({
  supported,
  hasAnthem,
  isPending,
  message,
  onTrain,
  minted,
  cards = [],
  address,
  cardSnapshot,
}: {
  supported: boolean;
  hasAnthem: boolean;
  isPending: boolean;
  message?: string;
  onTrain: () => void | Promise<void>;
  minted: boolean;
  cards?: GalleryItem[];
  address?: Address;
  cardSnapshot?: { currentPower: number; currentRarity: number; snapshotVersion: number } | null;
}) {
  const roster = useMemo(() => cards.filter((c) => c.tokenId || c.preview).slice(0, 24), [cards]);
  const [selectedKey, setSelectedKey] = useState("");
  const selected = roster.find((c) => cardKey(c, address) === selectedKey) ?? roster[0];
  const key = cardKey(selected, address);
  const [burst, setBurst] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const tokenId = selected?.tokenId ? Number(selected.tokenId) : undefined;
  const chainTraining = useTrainingProgress(address, tokenId);
  const trainingWrites = useTrainingWrites();
  const expectedAp = 25;
  const baseXp = minted ? 200 : 0;
  const totalXp = chainTraining.progress.totalXp;
  const lvl = levelFromXp(totalXp);
  const next = EVOLUTION_THRESHOLDS.find((u) => lvl.level < u.level);
  // Local cooldown tracking — the on-chain contract only stores trainCount
  // (not lastTrainedAt), and getProgress() reverts, so we tick once per
  // second off localStorage + chainTraining.progress so the button label
  // and the message line stay in sync.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const COOLDOWN_SECS = 20 * 60 * 60; // 20 hours, matches on-chain RitualTraining.sol (72_000_000 ms)
  const lsKey = `ritual:training:lastTrainedAt:${(address || "").toLowerCase()}:${tokenId ?? 0}`;
  const lsLast = useMemo(() => {
    if (typeof window === "undefined" || !tokenId) return 0;
    try {
      const v = window.localStorage.getItem(lsKey);
      return v ? Number(v) || 0 : 0;
    } catch {
      return 0;
    }
  }, [lsKey, tokenId, chainTraining.progress.trainCount, chainTraining.progress.lastTrainedAt]);
  const lsSecondsLeft = lsLast > 0 ? Math.max(0, COOLDOWN_SECS - (nowSec - lsLast)) : 0;
  // Prefer the on-chain value when available; fall back to localStorage.
  // When the contract state is unreadable (deployed contract only has
  // trainCount as a public getter and it reverts on some RPCs), optimistically
  // show training as available — the on-chain train() call is the source
  // of truth and will revert naturally if the cooldown hasn't elapsed.
  const effectiveSecondsLeft =
    chainTraining.progress.secondsLeft > 0
      ? chainTraining.progress.secondsLeft
      : lsSecondsLeft;
  const chainSaysCanTrain = chainTraining.progress.canTrain;
  const chainSaysCooldownDone =
    chainSaysCanTrain ||
    (chainTraining.progress.trainCount === 0 && effectiveSecondsLeft === 0);
  const lsSaysCooldownDone = lsLast === 0 || lsSecondsLeft === 0;
  const canTrain = chainTraining.supported && supported && hasAnthem && !isPending && !trainingWrites.isPending && Boolean(selected?.tokenId)
    ? chainSaysCooldownDone && lsSaysCooldownDone
    : false;
  // Accept any snapshot with a positive currentPower. The fallback path in
  // useCardSnapshot returns snapshotVersion=0 with valid power/rarity when
  // the primary getCardSnapshot() call is unavailable (RPC issue, older
  // contract). The UI still needs to render in that case.
  const snapshotForCard = cardSnapshot && cardSnapshot.currentPower > 0
    ? { currentPower: cardSnapshot.currentPower, currentRarity: cardSnapshot.currentRarity }
    : undefined;
  const displayRarity = snapshotForCard ? rankToRarity(snapshotForCard.currentRarity) : undefined;
  const displayPower = snapshotForCard?.currentPower;
  const powerUnavailable = Boolean(selected?.tokenId && !selected.preview && !snapshotForCard);
  const archetypes = selected ? [selected.cardArchetype || "Void Explorer", `${selected.mood || "Ritual"} Summoner`].filter(Boolean) : [];
  const traits = selected?.cardTraits?.length ? selected.cardTraits : ["Ice Affinity", "Void Echo", "Ancient Signal"];

  useEffect(() => {
    if (!selectedKey && roster[0]) setSelectedKey(cardKey(roster[0], address));
  }, [address, roster, selectedKey]);

  const train = async () => {
    if (!canTrain || !selected) return;
    const beforeLvl = lvl.level;
    const beforePower = snapshotForCard ? snapshotForCard.currentPower : undefined;
    try {
      await trainingWrites.train(Number(selected.tokenId));
      // Persist lastTrainedAt client-side so the cooldown countdown works
      // even though the on-chain contract doesn't expose lastTrainedAt as
      // a view function. Per (wallet, tokenId) key.
      if (typeof window !== "undefined" && tokenId) {
        try {
          window.localStorage.setItem(lsKey, String(Math.floor(Date.now() / 1000)));
        } catch {
          /* ignore quota */
        }
      }
      await Promise.all([chainTraining.refetch(), Promise.resolve(onTrain())]);
      const afterLvl = levelFromXp(chainTraining.progress.totalXp).level;
      const afterPower = snapshotForCard ? snapshotForCard.currentPower : undefined;
      setBurst(`+25 XP  +25 AP`);
      window.setTimeout(() => setBurst(undefined), 1200);
      const unlocked = EVOLUTION_THRESHOLDS.find((u) => beforeLvl < u.level && afterLvl >= u.level);
      if (unlocked) {
        setNotice(`${unlocked.name} Unlocked - Level ${unlocked.level} Reached`);
        window.setTimeout(() => setNotice(undefined), 3200);
      }
      // Reset tx phase to idle a moment after success so the banner clears.
      window.setTimeout(() => trainingWrites.reset(), 1500);
    } catch {
      // Phase is already set to "error" by useTrainingWrites. The user can
      // click "Try Again" (or "Train Selected Identity Card") to retry.
    }
  };

  // Build a live "Xh Ym Zs" countdown for the message under the button.
  function fmtCountdown(secs: number) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  return (
    <div className="grid gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-aqua/60">Training & Level</p>
        <p className="mt-1 font-mono text-[12px] leading-5 text-iceaccent/75">
          Train the selected forged card. XP, level, AP earned, visual unlocks, and training history are recorded on-chain per card.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="grid gap-3">
          <div className="bevel-in bg-[#071d1b] p-3 font-mono">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-aqua">
                <CalendarCheck size={14} /> Daily Training
              </span>
            </div>
            
            {chainTraining.supported && displayPower !== undefined && displayRarity ? (() => {
              const power = displayPower;
              const grade = displayRarity;
              const currentTier = POWER_THRESHOLDS.find(t => power >= t.min && power < t.max) ?? POWER_THRESHOLDS[POWER_THRESHOLDS.length - 1];
              const nextTier = POWER_THRESHOLDS.find(t => power < t.min);
              const range = currentTier.max - currentTier.min;
              const intoTier = power - currentTier.min;
              const tierPct = range > 0 ? Math.round((intoTier / range) * 100) : 100;
              const toNext = nextTier ? nextTier.min - power : 0;
              return (
                <div className="bevel-out mt-3 bg-wgray p-[2px]">
                  <div className="title-grad flex items-center gap-1.5 px-1.5 py-[3px]">
                    <TrendingUp size={12} className="text-ice" />
                    <span className="flex-1 font-ui text-[11px] font-bold text-ice">Evolution</span>
                  </div>
                  <div className="bevel-in bg-[#071d1b] p-2.5 font-mono text-[11px]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-iceaccent/70">Current Power</span>
                      <span className="font-bold text-aqua">{power} / 100</span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-iceaccent/70">Current Grade</span>
                      <span className="font-bold text-aqua">{grade}</span>
                    </div>
                    <div className="bevel-in-thin h-3 w-full bg-[#061512]">
                      <div className={`h-full transition-all duration-500 ${currentTier.color}`} style={{ width: `${Math.min(100, (power / 100) * 100)}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px]">
                      {POWER_THRESHOLDS.slice(0, -1).map((t) => (
                        <span key={t.name} className="text-iceaccent/35">{t.min}</span>
                      ))}
                      <span className="text-iceaccent/35">100</span>
                    </div>
                    {nextTier ? (
                      <p className="mt-2 text-[10px] text-iceaccent/50">
                        <span className="font-bold text-ice">{toNext} power</span> until {nextTier.name}
                      </p>
                    ) : (
                      <p className="mt-2 text-[10px] font-bold text-[#c9b8ff]">MAX EVOLUTION REACHED</p>
                    )}
                  </div>
                </div>
              );
            })() : null}

            {powerUnavailable ? (
              <div className="bevel-in mt-3 bg-coal p-2.5 text-[11px] text-iceaccent/60">Card power unavailable — waiting for CardSnapshot.</div>
            ) : null}

            <div className="mt-3 grid gap-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-iceaccent/70">Training XP</span>
                <span className="text-aqua">+25 XP</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-iceaccent/70">Arena Points</span>
                <span className="inline-flex items-center gap-1 text-aqua">
                  <Zap size={12} /> +{expectedAp} AP
                </span>
              </div>
            </div>
            <button
              onClick={train}
              disabled={!canTrain && trainingWrites.phase !== "error"}
              className="win-btn win-btn-emerald relative mt-4 inline-flex w-full items-center justify-center gap-2 disabled:opacity-60"
            >
              {trainingWrites.phase === "awaitingSignature" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Awaiting wallet signature…
                </>
              ) : trainingWrites.phase === "submitted" || trainingWrites.phase === "confirming" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Transaction confirming…
                </>
              ) : trainingWrites.phase === "error" ? (
                <>
                  <AlertCircle size={16} /> Try Again
                </>
              ) : trainingWrites.phase === "success" ? (
                <>
                  <CheckCircle2 size={16} /> Training complete
                </>
              ) : !chainTraining.supported || !supported ? (
                "Training contract not configured"
              ) : !hasAnthem ? (
                "Forge an Identity Card first"
              ) : isPending ? (
                "Training..."
              ) : canTrain ? (
                "Train Selected Identity Card"
              ) : effectiveSecondsLeft > 0 ? (
                `Cooldown: ${fmtCountdown(effectiveSecondsLeft)}`
              ) : (
                "Trained - come back tomorrow"
              )}
              {burst ? <span className="absolute -top-7 right-2 animate-bounce font-mono text-[12px] text-aqua">{burst}</span> : null}
            </button>

            
            <TxPhaseBanner phase={trainingWrites.phase} txHash={trainingWrites.txHash} error={trainingWrites.error} />
            <div className="bevel-in mt-3 bg-coal p-2.5 text-[11px] leading-5 text-aqua">
              {message || (canTrain ? "On-chain training is ready." : effectiveSecondsLeft > 0 ? `Next training available in ${fmtCountdown(effectiveSecondsLeft)}` : "Training recorded — waiting for cooldown state to settle.")}
            </div>
            {notice ? (
              <div className="bevel-in mt-2 bg-[#06231d] p-2.5 text-[11px] font-bold text-[#1CC744]">
                Evolution {notice}
              </div>
            ) : null}
          </div>

          
          <div className="bevel-out bg-wgray p-[2px]">
            <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">Evolution Table</div>
            <div className="bevel-in bg-coal p-2 font-mono text-[10px]">
              {displayPower !== undefined ? (POWER_THRESHOLDS.map((t) => {
                const isCurrent = displayRarity === t.name;
                const currentPower = displayPower;
                const isReached = currentPower >= t.min;
                return (
                  <div key={t.name} className={`flex items-center justify-between px-1 py-0.5 ${isCurrent ? "text-aqua" : isReached ? "text-iceaccent/60" : "text-iceaccent/30"}`}>
                    <span>{t.name}</span>
                    <span>{t.min}–{t.max === 100 ? "100" : t.max.toString()}</span>
                    {isCurrent ? <span className="text-[9px] text-aqua">◄ CURRENT</span> : null}
                  </div>
                );
              })) : <div className="px-1 py-2 text-iceaccent/50">snapshot unavailable</div>}
              {displayPower !== undefined && displayRarity ? (
                <div className="mt-1 border-t border-iceaccent/10 pt-1 text-[9px] text-iceaccent/50">
                  current: power {displayPower} / {displayRarity}
                  {(() => {
                    const power = displayPower;
                    const next = POWER_THRESHOLDS.find((t) => power < t.min);
                    return next ? ` | next: ${next.min - power} power to ${next.name}` : " | max grade reached";
                  })()}
                </div>
              ) : null}
            </div>
          </div>

          
          <div className="bevel-in bg-coal p-2.5 font-mono text-[10px] text-iceaccent/60">
            Arena Link training increases card power. card power is used by arena matchmaking and battle resolution. higher evolved power improves arena competitiveness.
          </div>

          {roster.length > 1 ? (
            <label className="bevel-in bg-coal p-3 font-mono text-[10px] text-iceaccent/70">
              <span className="mb-1 flex items-center gap-1.5 uppercase tracking-[0.2em] text-aqua/70">
                <ChevronDown size={12} /> Select Identity Card
              </span>
              <select value={key} onChange={(e) => setSelectedKey(e.target.value)} className="w-full bevel-in-thin bg-[#061512] px-2 py-1.5 text-[12px] text-aqua">
                {roster.map((c) => (
                  <option key={cardKey(c, address)} value={cardKey(c, address)}>
                    @{c.xHandle || "anon"} #{c.tokenId ?? c.mintId}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="bevel-out bg-wgray p-[2px]">
            <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">Visual Evolution Roadmap</div>
            <div className="bevel-in grid gap-1.5 bg-coal p-2">
              {EVOLUTION_THRESHOLDS.map((u) => {
                const unlocked = lvl.level >= u.level;
                return (
                  <div key={u.level} className={`bevel-in-thin flex items-center justify-between px-2 py-1.5 font-mono text-[11px] ${unlocked ? "bg-[#06231d] shadow-[0_0_12px_rgba(28,199,68,0.22)]" : "bg-[#0b0b0b]"}`}>
                    <span className={unlocked ? "text-aqua" : "text-iceaccent/45"}>
                      Level {u.level} &gt; {u.name}
                    </span>
                    <span className={`text-[9px] font-bold ${unlocked ? "text-[#1CC744]" : "text-iceaccent/35]"}`}>{unlocked ? "UNLOCKED" : "LOCKED"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bevel-out bg-wgray p-[2px]">
          <div className="title-grad flex items-center gap-1.5 px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
            <Sparkles size={12} /> ACTIVE IDENTITY CARD
          </div>
          <div className="bevel-in grid gap-3 bg-coal p-3 font-mono">
            {!selected ? (
              <div className="grid min-h-[380px] place-items-center text-[12px] text-iceaccent/60">No Identity Card found. Forge an Identity Card to begin Training.</div>
            ) : (
              <>
                <ActiveCardImage card={selected} level={lvl.level} snapshot={snapshotForCard} />
                <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-aqua/60">Identity Card</p>
                    <h3 className="font-handle text-2xl font-bold text-ice">@{selected.xHandle || "anon"}</h3>
                  </div>
                  <div className="grid gap-2">
                    <div className="bevel-in-thin bg-[#061512] p-2">
                      <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-aqua/60">Archetype</p>
                      {archetypes.length ? archetypes.map((x) => <p key={x} className="text-[11px] text-iceaccent/80">- {x}</p>) : <p className="text-[11px] text-iceaccent/50">No archetype available.</p>}
                    </div>
                    <div className="bevel-in-thin bg-[#061512] p-2">
                      <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-aqua/60">Traits</p>
                      {traits.slice(0, 4).map((x) => <p key={x} className="text-[11px] text-iceaccent/80">- {x}</p>)}
                    </div>
                  </div>
                </div>
                {notice ? (
                  <div className="bevel-in-thin bg-[#170f2e] p-2 text-center text-[12px] font-bold text-[#c9b8ff]">
                    {notice}
                  </div>
                ) : null}
                {chainTraining.history.length ? (
                  <div className="bevel-in-thin bg-[#061512] p-2 text-[10px] leading-4 text-iceaccent/70">
                    <p className="mb-1 uppercase tracking-[0.2em] text-aqua/60">Training History</p>
                    {chainTraining.history.slice(0, 4).map((h, i) => (
                      <p key={`${h.trainedAt}-${i}`}>- +{h.xpGained} XP / +{h.apGained} AP - Level {h.levelAfter}</p>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
