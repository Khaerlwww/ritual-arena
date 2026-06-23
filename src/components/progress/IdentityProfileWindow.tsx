import { Award, BadgeCheck, CalendarDays, Clock, Fingerprint, Layers, Swords, Trophy, TrendingUp, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { AnthemCard, type GalleryItem } from "../AnthemCard";
import { CollectionCard } from "../pack/CollectionCard";
import type { PackResultCard } from "../../types/packCard";
import { useCardSnapshot } from "../../hooks/useAnthem";
import { usePacks } from "../../hooks/usePacks";
import { useTrainingProgress } from "../../hooks/useTraining";
import type { IdentityView } from "../../lib/identityEngine";
import { getTierColor } from "../../lib/identityEngine";
import type { Achievement } from "../../lib/achievementEngine";
import { activeProfileTitle } from "../../lib/achievementEngine";
import { rankToRarity } from "../../lib/rarity";
import { formatRitualDate, formatRitualDateTime, normalizeRitualTimestamp } from "../../lib/ritualTime";

const XP_PER_TRAIN = 25;

type TimelineEvent = {
  type: "forge" | "training" | "power" | "grade" | "collection" | "arena";
  label: string;
  detail: string;
  timestamp: number | null;
  icon: ReactNode;
  accent: string;
};

function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "—";
}

function pct(n: number, d: number) {
  if (d <= 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function valueOrDash(value: ReactNode, reliable: boolean) {
  return reliable ? value : "—";
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="bevel-out bg-wgray p-[2px]">
      <div className="title-grad flex items-center gap-1.5 px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
        {icon}
        <span className="flex-1">{title}</span>
      </div>
      <div className="bevel-in bg-coal p-3 font-mono text-[11px] text-iceaccent/75">{children}</div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="bevel-in-thin bg-[#061512] p-2">
      <p className="text-[9px] uppercase tracking-[0.18em] text-iceaccent/45">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold ${accent || "text-aqua"}`}>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="flex justify-between gap-4 border-b border-aqua/10 py-1 last:border-b-0">
      <span className="text-iceaccent/60">{label}</span>
      <span className="text-right text-aqua">{value}</span>
    </span>
  );
}

function ScoreRow({ label, value, max, color, pending, hint }: { label: string; value: number; max: number; color?: string; pending?: boolean; hint?: string }) {
  const width = pending || max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="font-mono text-[10px]" title={hint}>
      <div className="flex items-center justify-between">
        <span className="text-iceaccent/70">{label}</span>
        <span className={pending ? "text-[#ffd76a]" : "text-aqua"}>
          {value.toLocaleString()}
        </span>
      </div>
      <div className="mt-1 h-1 w-full bg-black/40">
        <div className={`h-1 ${pending ? "bg-[#ffd76a]/30" : color ?? "bg-aqua"}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function TimelineEntry({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#061512] ${event.accent}`}>{event.icon}</div>
        {!isLast && <div className="w-px flex-1 bg-aqua/15" />}
      </div>
      <div className="flex-1 pb-4">
        <div className="flex items-start justify-between gap-2">
          <span className={`font-bold ${event.accent}`}>{event.label}</span>
          <span className="shrink-0 text-[9px] text-iceaccent/35">
            <Clock size={9} className="mr-0.5 inline" />
            {event.timestamp ? formatRitualDateTime(event.timestamp) : "—"}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-iceaccent/55">{event.detail}</p>
      </div>
    </div>
  );
}

export function IdentityProfileWindow({
  address,
  identity,
  achievements,
  cards,
  primaryCard,
  primaryPackCard,
  arenaPlayer,
  arenaRank,
  arenaScore,
  onRefresh,
}: {
  address?: Address;
  identity: IdentityView & { refetch?: () => void; isStale?: boolean };
  achievements: Achievement[];
  cards: GalleryItem[];
  primaryCard?: GalleryItem;
  primaryPackCard?: PackResultCard;
  arenaPlayer: {
    wins: number;
    totalBattles: number;
    settledBattles: number;
    unmatchedBattles: number;
    activeBattleId: number;
    winStreak: number;
    bestWinStreak: number;
  };
  arenaRank: "INITIATE" | "ASCENDANT" | "BITTY" | "RITTY" | "RITUALIST" | "RADIANT RITUALIST";
  arenaScore: number;
  onRefresh?: () => void;
}) {
  const cardSnap = useCardSnapshot(address);
  const snap = cardSnap.snapshot && cardSnap.snapshot.snapshotVersion >= 1 ? cardSnap.snapshot : undefined;
  const tokenId = snap ? Number(snap.tokenId) : primaryCard?.tokenId ? Number(primaryCard.tokenId) : undefined;
  const training = useTrainingProgress(address, tokenId);
  const packs = usePacks(address);

  const unlocked = achievements.filter((a) => a.unlocked);
  const profileTitle = activeProfileTitle(achievements, identity);

  const hasTrainingData = identity.canonical;
  const trainingLevel = hasTrainingData ? identity.level : undefined;
  const totalXp = hasTrainingData ? identity.totalXp : undefined;
  const currentPower = hasTrainingData ? identity.currentPower : undefined;
  const currentRarity = hasTrainingData ? identity.currentRarity : undefined;
  const grade = currentRarity !== undefined ? rankToRarity(currentRarity) : undefined;
  const collectionCount = packs.userCollection.length;
  const hasPackData = collectionCount > 0;
  const losses = Math.max(0, arenaPlayer.totalBattles - arenaPlayer.wins);
  const latestTraining = normalizeRitualTimestamp(training.progress.lastTrainedAt)
    ? formatRitualDateTime(training.progress.lastTrainedAt)
    : "—";

  const displayScore = identity.canonical ? identity.score : undefined;
  const displayRank = identity.canonical ? identity.rank : "INITIATE" as const;
  const displayScoreIsCanonical = identity.canonical;
  const tierColor = getTierColor(displayRank);

  const canonicalComponents = identity.components;
  const breakdownTraining = identity.canonical && canonicalComponents ? canonicalComponents.training : undefined;
  const breakdownArena = identity.canonical && canonicalComponents ? canonicalComponents.arena : undefined;
  const breakdownAchievement = identity.canonical && canonicalComponents ? canonicalComponents.achievement : undefined;
  const breakdownCollection = identity.canonical && canonicalComponents ? canonicalComponents.collection : undefined;
  const breakdownTotal = displayScore;

  const timelineEvents: TimelineEvent[] = [];
  if (snap) {
    timelineEvents.push({
      type: "forge",
      label: "Identity Forged",
      detail: `Identity Card #${snap.tokenId} created — Power ${snap.initialPower}, ${rankToRarity(snap.initialRarity)}`,
      timestamp: normalizeRitualTimestamp(snap.forgedAt),
      icon: <Zap size={11} />,
      accent: "text-[#ffd76a]",
    });
    if (Number(snap.currentPower) > Number(snap.initialPower)) {
      timelineEvents.push({
        type: "power",
        label: "Power Increased",
        detail: `Power ${snap.initialPower} → ${snap.currentPower}`,
        timestamp: normalizeRitualTimestamp(snap.lastRefreshed),
        icon: <TrendingUp size={11} />,
        accent: "text-[#ff6a6a]",
      });
    }
    if (Number(snap.currentRarity) > Number(snap.initialRarity)) {
      timelineEvents.push({
        type: "grade",
        label: "Grade Upgraded",
        detail: `${rankToRarity(snap.initialRarity)} → ${rankToRarity(snap.currentRarity)}`,
        timestamp: normalizeRitualTimestamp(snap.lastRefreshed),
        icon: <Trophy size={11} />,
        accent: "text-[#c9b8ff]",
      });
    }
  }
  if (totalXp !== undefined && totalXp > 0) {
    timelineEvents.push({
      type: "training",
      label: "Training Completed",
      detail: `${totalXp.toLocaleString()} XP accumulated`,
      timestamp: normalizeRitualTimestamp(training.progress.lastTrainedAt),
      icon: <CalendarDays size={11} />,
      accent: "text-aqua",
    });
  }
  if (collectionCount > 0) {
    timelineEvents.push({
      type: "collection",
      label: "Collection Edition Owned",
      detail: `${collectionCount} Collection Edition${collectionCount === 1 ? "" : "s"} owned`,
      timestamp: null,
      icon: <Layers size={11} />,
      accent: "text-teal2",
    });
  }
  if (arenaPlayer.totalBattles > 0) {
    timelineEvents.push({
      type: "arena",
      label: "Arena Record Updated",
      detail: `${arenaPlayer.wins}W / ${losses}L recorded through Arena activity`,
      timestamp: null,
      icon: <Swords size={11} />,
      accent: "text-[#7dd3fc]",
    });
  }
  timelineEvents.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  return (
    <div className="grid gap-3">
      <Section title="Identity Summary" icon={<Fingerprint size={12} className="text-ice" />}>
        <div className="mb-3 grid gap-1 text-[11px] sm:grid-cols-2">
          <Row label="Handle" value={<span className="font-handle font-bold">{primaryCard?.xHandle ? `@${primaryCard.xHandle}` : "—"}</span>} />
          <Row label="Wallet" value={shortAddr(address)} />
          <Row label="Identity Card Token ID" value={tokenId ? `#${tokenId}` : "—"} />
          <Row label="Identity Forged" value={snap ? formatRitualDate(snap.forgedAt) : "—"} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatBox label="Power" value={valueOrDash(currentPower, currentPower !== undefined)} accent="text-[#ff6a6a]" />
          <StatBox label="Grade" value={grade ?? "—"} accent="text-[#c9b8ff]" />
          <StatBox
            label="Identity Score"
            value={displayScore !== undefined ? displayScore.toLocaleString() : "—"}
            accent="text-aqua"
          />
          <StatBox label="Identity Rank" value={displayRank} accent={tierColor} />
        </div>
        {displayScoreIsCanonical && displayScore !== undefined ? (
          <p className="mt-2 text-center text-[9px] uppercase tracking-[0.2em] text-iceaccent/40">
            Registry synced · score {displayScore.toLocaleString()} / 1,000
          </p>
        ) : (
          <p className="mt-2 text-center text-[9px] uppercase tracking-[0.2em] text-[#ffd76a]/70">
            Registry awaiting first on-chain action — score will appear after forge / train / arena.
          </p>
        )}
      </Section>

      {primaryCard || primaryPackCard ? (
        <Section title="Card Preview" icon={<Layers size={12} className="text-ice" />}>
          {primaryCard ? (
            <AnthemCard
              item={{ ...primaryCard, trainingLevel }}
              snapshot={snap ? { currentPower: Number(snap.currentPower), currentRarity: Number(snap.currentRarity) } : undefined}
            />
          ) : primaryPackCard ? (
            <>
              <CollectionCard card={primaryPackCard} />
              <p className="mt-2 text-center font-mono text-[9px] text-iceaccent/40">
                forged RitualPackNFT · no Anthem NFT minted yet
              </p>
            </>
          ) : null}
          <p className="mt-2 text-center text-[10px] text-iceaccent/55">
            Visual state at training level {trainingLevel ?? "—"}
            {trainingLevel !== undefined && trainingLevel >= 2 ? " — see all unlocks in Card Image API" : " — forge + train to unlock visual effects"}
          </p>
        </Section>
      ) : null}

      <Section title="Reputation Breakdown" icon={<Award size={12} className="text-ice" />}>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-aqua/60">Identity Score Breakdown</p>
          <div className="mt-3 grid gap-1.5">
            <ScoreRow label="Training" value={breakdownTraining ?? 0} max={400} color="bg-teal2" />
            <ScoreRow label="Arena" value={breakdownArena ?? 0} max={200} color="bg-[#c9b8ff]" />
            <ScoreRow label="Achievements" value={breakdownAchievement ?? 0} max={300} color="bg-[#7dd3fc]" />
            <ScoreRow
              label="Collection"
              value={breakdownCollection ?? 0}
              max={100}
              color="bg-[#ffd76a]"
              hint="From opened packs"
            />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-aqua/20 pt-2">
          <span className="font-bold text-ice">Breakdown Total</span>
          <span className="font-bold text-aqua">
            {breakdownTotal !== undefined ? `${breakdownTotal.toLocaleString()} / 1,000` : "—"}
          </span>
        </div>
      </Section>

      <Section title="Progress Signals" icon={<BadgeCheck size={12} className="text-ice" />}>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 font-bold text-ice">Training Progress</p>
            <Row label="Training Level" value={trainingLevel !== undefined ? `Lv ${trainingLevel}` : "—"} />
            <Row label="Training XP" value={totalXp !== undefined ? totalXp.toLocaleString() : "—"} />
            <Row label="Latest Training" value={latestTraining} />
          </div>
          <div>
            <p className="mb-1 font-bold text-ice">Arena Record</p>
            <Row label="Record" value={arenaPlayer.totalBattles > 0 ? `${arenaPlayer.wins}W-${losses}L` : "—"} />
            <Row
              label="Arena Activity"
              value={
                arenaPlayer.totalBattles > 0
                  ? (arenaPlayer.unmatchedBattles > 0
                      ? `${arenaPlayer.totalBattles} (${arenaPlayer.settledBattles} settled, ${arenaPlayer.unmatchedBattles} active)`
                      : arenaPlayer.totalBattles)
                  : "—"
              }
            />
            <Row label="Identity Rank" value={displayRank} />
            <Row
              label="Win Rate"
              value={
                arenaPlayer.activeBattleId > 0
                  ? `in battle #${arenaPlayer.activeBattleId}`
                  : arenaPlayer.settledBattles > 0
                  ? pct(arenaPlayer.wins, arenaPlayer.settledBattles)
                  : "—"
              }
            />
          </div>
          {hasPackData ? (
            <div>
              <p className="mb-1 font-bold text-ice">Collection Progress</p>
              <Row label="Collection Editions" value={collectionCount} />
              <Row label="Initiate Pack Cost" value={`${packs.initiateCost} AP`} />
              <Row label="Collection Size" value={packs.pool?.total ?? 0} />
            </div>
          ) : (
            <div>
              <p className="mb-1 font-bold text-ice">Collection Progress</p>
              <p className="text-[10px] leading-4 text-iceaccent/55">
                No Collection Editions owned yet. Earn AP through Training or Arena, then open an Initiate Pack from the
                Pack window to add Collection Editions.
              </p>
            </div>
          )}
        </div>
      </Section>

      <Section title="Evolution Timeline" icon={<Clock size={12} className="text-ice" />}>
        {timelineEvents.length === 0 ? (
          <div className="py-6 text-center text-iceaccent/45">No on-chain reputation events found.</div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto pr-1">
            {timelineEvents.map((event, i) => <TimelineEntry key={`${event.type}-${event.label}-${i}`} event={event} isLast={i === timelineEvents.length - 1} />)}
          </div>
        )}
      </Section>

    </div>
  );
}
