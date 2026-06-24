import {
  Activity,
  AlertTriangle,
  AtSign,
  BookOpen,
  ChevronDown,
  Copy,
  Cpu,
  Droplets,
  ExternalLink,
  FolderOpen,
  Info,
  LogOut,
  Monitor,
  Music2,
  Radio,
  Share2,
  Sparkles,
  UploadCloud,
  Wallet,
  Wifi,
  Swords,
  CalendarCheck,
  Fingerprint,
  Hammer,
  Layers,
  LayoutGrid,
  Recycle,
  Store,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isAddress, keccak256, toHex, type Address } from "viem";
import {
  buildMetadata,
  buildMetadataUri,
  buildShareText,
  generateAnthem,
  sanitizeHandle,
  type Anthem,
} from "../lib/anthem";
import { renderBeatWav } from "../lib/audio";
import { renderAnthemCard, renderAnthemCardDataUrl } from "../lib/cardImage";
import { hasPinata, ipfsToHttp, pinFile, pinJson, probeEndpoint } from "../lib/ipfs";
import { ForgeCardSnapshot, buildForgeCardSnapshot } from "../lib/forgeSnapshot";
import { explorerTxUrl, explorerAddressUrl, faucetUrl } from "../lib/chains";
import {
  anthemAddress,
  hasAnthemContract,
  formatBalance,
  checkHandleTaken,
  publicClient,
  useAllAnthems,
  useAnthemReads,
  useAnthemWrites,
  useCardSnapshot,
  useInjectedWallet,
  useMintFee,
  useNextTokenId,
  useStreak,
  type Anthem as ChainAnthem,
  type CardSnapshot as ChainCardSnapshot,
} from "../hooks/useAnthem";
import { useArenaStats, useArenaWrites } from "../hooks/useArena";
import { useIdentityRegistry } from "../hooks/useIdentityRegistry";
import { usePower } from "../hooks/usePower";
import { useStaking } from "../hooks/useStaking";
import { useOwnedPackNFTs, type OwnedPackCard } from "../hooks/useOwnedPackNFTs";
import { loadCollectionPool, type CollectionPool } from "../lib/packPool";
import { INTERNAL_RARITIES, internalToVisualRarity, roleToInternalRarity, type InternalRarity, type Rarity } from "../lib/rarity";
import { type PackResultCard } from "../types/packCard";
import { identityCardAbi } from "../abi/identityCard";
import { AnthemCard, type GalleryItem } from "./AnthemCard";
import { ForgeSuccessModal, type ForgeSuccessCard } from "./ForgeSuccessModal";
import { RitualMark } from "./Logo";
import { WindowControls } from "./win2k";
import {
  DesktopWindow,
  MenuList,
  useWindows,
  type Bounds,
  type MenuEntry,
  type WinId,
  type WinMeta,
} from "./desktop";
import { SystemInfo, type AnthemWorkflow } from "./SystemInfo";
import { StatusHUD } from "./StatusHUD";
import { APBadge } from "./APBadge";

import { effectiveRarity, rankToRarity, resolvedRarity, rarityToRank, RARITY_NAMES } from "../lib/rarity";
import { checkAchievements, ACHIEVEMENTS, type AchievementState } from "../lib/achievementEngine";
import { shortTxError } from "../lib/shortTxError";
import { useTrainingProgress } from "../hooks/useTraining";
import { usePublicCardSnapshots } from "../hooks/usePublicCardSnapshots";
import { useAchievements, hasAchievementRegistry } from "../hooks/useAchievements";

const TrainingWindow = lazy(() => import("./progress/TrainingWindow").then((m) => ({ default: m.TrainingWindow })));
const IdentityProfileWindow = lazy(() =>
  import("./progress/IdentityProfileWindow").then((m) => ({ default: m.IdentityProfileWindow })),
);
const AnthemArenaWindow = lazy(() => import("./progress/AnthemArenaWindow").then((m) => ({ default: m.AnthemArenaWindow })));
const PackWindow = lazy(() => import("./progress/PackWindow").then((m) => ({ default: m.PackWindow })));
const RecycleBinWindow = lazy(() =>
  import("./progress/RecycleBinWindow").then((m) => ({ default: m.RecycleBinWindow })),
);
const CollectionGalleryWindow = lazy(() =>
  import("./progress/CollectionGalleryWindow").then((m) => ({ default: m.CollectionGalleryWindow })),
);
const RitualDocsWindow = lazy(() => import("./RitualDocsWindow").then((m) => ({ default: m.RitualDocsWindow })));
const MarketWindow = lazy(() => import("./progress/MarketWindow").then((m) => ({ default: m.MarketWindow })));

const EXPLORER_HOME = "https://explorer.ritualfoundation.org";
const WIN: (WinMeta & { icon: LucideIcon })[] = [
  { id: "home", title: "Ritual Arena", icon: Cpu, x: 16, y: 10, w: 820, h: 476 },
  { id: "create", title: "Forge Identity Card", icon: Hammer, x: 360, y: 232, w: 860, h: 499, open: false },
  { id: "sysinfo", title: "System Info", icon: Activity, x: 30, y: 360, w: 480, h: 278, open: false },
  { id: "minted", title: "Identity Cards", icon: Layers, x: 150, y: 470, w: 1080, h: 626, open: false },
  { id: "about", title: "About — Ritual Arena", icon: Info, x: 220, y: 150, w: 440, h: 255, open: false },
  { id: "profile", title: "Identity Profile — Ritual Native Reputation", icon: Fingerprint, x: 70, y: 50, w: 1080, h: 700, open: false },
  { id: "training", title: "Training & Level", icon: CalendarCheck, x: 90, y: 90, w: 900, h: 650, open: false },
  { id: "arena", title: "Arena", icon: Swords, x: 70, y: 50, w: 1040, h: 660, open: false },
  { id: "market", title: "Market", icon: Store, x: 90, y: 60, w: 1060, h: 660, open: false },
  { id: "packs", title: "Collection Packs", icon: Layers, x: 110, y: 70, w: 1000, h: 680, open: false },
  { id: "recycle", title: "Recycle Bin — NFT Sink", icon: Recycle, x: 150, y: 110, w: 920, h: 640, open: false },
  { id: "gallery", title: "Collection Gallery", icon: LayoutGrid, x: 130, y: 90, w: 1080, h: 720, open: false },
  { id: "docs", title: "Ritual Arena Docs", icon: BookOpen, x: 120, y: 80, w: 980, h: 650, open: false },
];
const iconFor = (id: WinId): LucideIcon => WIN.find((w) => w.id === id)?.icon ?? Cpu;

function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function chainToGalleryItem(c: ChainAnthem): GalleryItem {
  const tokenId = Number(c.tokenId);
  if (!Number.isFinite(tokenId) || tokenId <= 0) {
    if (import.meta.env.DEV) console.warn("[RitualAnthem] chainToGalleryItem received an invalid tokenId — rarity may be wrong", c);
  }
  const gen = generateAnthem(c.wallet, c.xHandle);
  // Gallery browsing: seed-based score/rarity for display only, not authoritative
  // Authoritative values come from CardSnapshot (fetched separately for connected wallet)
  return { ...gen, mood: c.mood || gen.mood, rarity: resolvedRarity(tokenId, gen.score), score: gen.score, tokenId, wallet: c.wallet };
}

const FEATURED_GENESIS_CARDS: GalleryItem[] = [
  {
    ...generateAnthem("0x0000000000000000000000000000000000000a01", "niraj", { genesis: true }),
    xHandle: "niraj",
    score: 100,
    rarity: "GENESIS",
    preview: true,
    tokenId: 777,
    wallet: "0x0000000000000000000000000000000000000a01",
    trainingLevel: 10,
  },
  {
    ...generateAnthem("0x0000000000000000000000000000000000000b02", "joshsimenhoff", { genesis: true }),
    xHandle: "joshsimenhoff",
    score: 100,
    rarity: "GENESIS",
    preview: true,
    tokenId: 778,
    wallet: "0x0000000000000000000000000000000000000b02",
    trainingLevel: 10,
  },
];

const FEATURED_GENESIS_SNAPSHOT = { currentPower: 100, currentRarity: 5 };

function SideIcon({
  icon: Icon,
  label,
  onClick,
  href,
  external,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  href?: string;
  external?: boolean;
}) {
  const cls = "group flex w-[88px] flex-col items-center gap-1 px-1 py-1.5 text-center hover:bg-emerald2/40";
  const inner = (
    <>
      <span className="bevel-out grid h-10 w-10 place-items-center bg-wgray text-teal2">
        <Icon size={20} />
      </span>
      <span className="font-ui text-[11px] leading-tight text-ice [text-shadow:1px_1px_0_#000] whitespace-nowrap overflow-hidden text-ellipsis w-full">{label}</span>
    </>
  );
  return href ? (
    <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className={cls}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function WindowLoading({ label = "Loading module" }: { label?: string }) {
  return (
    <div className="bevel-in grid min-h-[180px] place-items-center bg-coal p-4 font-mono text-[12px] text-iceaccent/70">
      <div className="text-center">
        <RitualMark size={34} glow={false} shine />
        <p className="mt-3 text-aqua">{label}...</p>
      </div>
    </div>
  );
}

function uniqueForgedCards(items: GalleryItem[], limit = 10) {
  const seen = new Set<string>();
  return items
    .filter((item) => item.wallet || item.tokenId)
    .filter((item) => {
      const key = `${item.tokenId ?? "no-token"}:${(item.wallet ?? "no-wallet").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function ForgedCardsMarquee({
  items,
  snapshotForItem,
  onOpenGallery,
}: {
  items: GalleryItem[];
  snapshotForItem: (item: GalleryItem) => { currentPower?: number; currentRarity?: number } | undefined;
  onOpenGallery: () => void;
}) {
  const cards = useMemo(() => uniqueForgedCards(items, 10), [items]);
  const shouldMarquee = cards.length >= 4;
  const visibleCards = shouldMarquee ? [...cards, ...cards] : cards;

  if (cards.length === 0) {
    return null;
  }

  return (
    <section className="bevel-in-thin relative mt-5 overflow-hidden bg-[#061512] p-2" aria-label="Recently forged Identity Cards">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div>
          <p className="font-display text-[11px] font-extrabold uppercase tracking-[0.22em] text-aqua">Recently Forged</p>
          <p className="font-mono text-[10px] text-iceaccent/55">live identity cards onchain</p>
        </div>
        <button type="button" onClick={onOpenGallery} className="win-btn !px-2 !py-1 text-[10px]">
          View all
        </button>
      </div>

      <div className={shouldMarquee ? "forge-marquee-mask overflow-hidden" : "overflow-x-auto pb-1"}>
        <div className={`${shouldMarquee ? "forge-card-marquee-track w-max" : "w-full justify-start"} flex gap-3 py-1`}>
          {visibleCards.map((item, i) => (
            <div
              key={`forged-${item.wallet ?? item.tokenId ?? "card"}-${i}`}
              className="w-[150px] shrink-0"
            >
              <AnthemCard item={item} snapshot={snapshotForItem(item)} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


/**
 * Turn a noisy wallet/network error into one short, human line.
 * Detects user-rejected requests (MetaMask code 4001 / "User denied …") and
 * falls back to viem's concise `shortMessage` instead of dumping the full tx.
 */
/** @deprecated use shortTxError from "../lib/shortTxError" instead. */
function txErrorMessage(err: unknown, action: string): string {
  return shortTxError(err, action);
}

const BOOT_MILESTONES = [
  { pct: 10, label: "Loading Ritual Core" },
  { pct: 25, label: "Initializing Card Registry" },
  { pct: 40, label: "Synchronizing Identity" },
  { pct: 60, label: "Loading Arena Records" },
  { pct: 80, label: "Connecting Staking Engine" },
  { pct: 100, label: "Identity Protocol Online" },
];

const ONBOARDING_STEPS = [
  { step: "STEP 1", title: "Forge your Identity Card on Ritual Chain." },
  { step: "STEP 2", title: "Train daily to gain XP and on-chain RitualAP. Use RitualAP in the marketplace." },
  { step: "STEP 3", title: "Train, enter the Arena, and build your Identity Rank." },
];

function BootSequence({ onEnter }: { onEnter: () => void }) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"boot" | "activation" | "onboarding" | "ready">("boot");
  const [step, setStep] = useState(0);
  const [hasSeenOnboarding] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem("ritual-identity-os-onboarded") === "1" : false,
  );

  useEffect(() => {
    if (phase !== "boot") return;
    const id = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(100, current + 1);
        if (next >= 100) {
          window.clearInterval(id);
          window.setTimeout(() => setPhase("activation"), 360);
        }
        return next;
      });
    }, 42);
    return () => window.clearInterval(id);
  }, [hasSeenOnboarding, phase]);

  useEffect(() => {
    if (phase !== "activation") return;
    const id = window.setTimeout(() => setPhase(hasSeenOnboarding ? "ready" : "onboarding"), 1850);
    return () => window.clearTimeout(id);
  }, [hasSeenOnboarding, phase]);

  // Clean launch: wipe legacy localStorage keys from previous versions.
  // Each key is marked "deprecated — V4 only". We do NOT touch keys
  // that may still support legacy V4 user display (USER_COLLECTION_KEY,
  // GUARANTEE_STORAGE_KEY) — they stay read-only in
  // V5 so existing users keep seeing their saved cards. When V4 user
  // data is fully migrated, the read paths can be deleted and these
  // keys removed in a single follow-up.
  useEffect(() => {
    const legacy: Array<{ key: string; note: string }> = [
      { key: "ritual-anthem:rescan-history", note: "V4 rescan flag — safe to wipe" },
    ];
    for (const { key } of legacy) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  }, []);

  const activeMilestone = BOOT_MILESTONES.reduce((active, item) => (progress >= item.pct ? item : active), BOOT_MILESTONES[0]);
  const logoOffset = `calc(${progress}% - 20px)`;

  return (
    <div className="boot-screen ritual-scaled-surface font-mono text-ice">
      <div className="boot-ambient" aria-hidden>
        <div className="boot-ambient-mark boot-ambient-mark-left">
          <RitualMark size={360} spin={false} glow shine />
        </div>
        <div className="boot-ambient-mark boot-ambient-mark-right">
          <RitualMark size={280} spin={false} glow shine />
        </div>
        <div className="boot-rotating-mark boot-rotating-mark-one">
          <RitualMark size={150} spin={false} glow={false} shine={false} />
        </div>
        <div className="boot-rotating-mark boot-rotating-mark-two">
          <RitualMark size={112} spin={false} glow={false} shine={false} />
        </div>
        <div className="boot-light-sweep" />
      </div>
      <div className="boot-crt" aria-hidden />
      <div className="boot-shell">
        {phase === "boot" ? (
          <div className="boot-panel boot-panel-boot">
            <div className="boot-panel-sweep" aria-hidden />
            <div className="boot-logo-wrap">
              <RitualMark size={104} spin={progress < 100} />
            </div>
            <div className="text-center">
              <p className="font-ui text-[12px] uppercase tracking-[0.45em] text-aqua">Ritual Identity</p>
              <h1 className="mt-2 font-display text-3xl font-extrabold uppercase tracking-[0.18em] text-white sm:text-5xl">
                System Boot
              </h1>
            </div>

            <div className="boot-progress-block">
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-iceaccent">
                <span>{activeMilestone.label}</span>
                <span>{progress}%</span>
              </div>
              <div className="boot-progress-track">
                <div className="boot-progress-fill" style={{ width: `${progress}%` }} />
                <div className="boot-progress-mark" style={{ left: logoOffset }}>
                  <RitualMark size={38} spin={false} />
                </div>
              </div>
              <div className="mt-4 grid gap-1 text-[10px] uppercase tracking-[0.18em] text-iceaccent/55">
                {BOOT_MILESTONES.map((item) => (
                  <div key={item.pct} className={progress >= item.pct ? "text-aqua" : ""}>
                    {String(item.pct).padStart(3, "0")}% {item.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {phase === "activation" ? (
          <div className="boot-activation" aria-live="polite">
            <div className="boot-activation-ring" />
            <div className="boot-activation-scan" />
            <div className="boot-activation-logo">
              <RitualMark size={168} spin={false} glow shine />
            </div>
            <p className="boot-activation-copy">IDENTITY PROTOCOL ONLINE</p>
          </div>
        ) : null}

        {phase === "onboarding" ? (
          <div className="boot-panel boot-wizard" key={`wizard-${step}`}>
            <div className="boot-panel-sweep" aria-hidden />
            <div className="boot-wizard-grid" aria-hidden />
            <div className="boot-wizard-signal" aria-hidden />
            <div className="boot-window-title">
              <span>Identity Setup</span>
              <span>{ONBOARDING_STEPS[step].step}</span>
            </div>
            <div className="boot-wizard-body">
              <div className="boot-wizard-orb" aria-hidden />
              <div className="boot-wizard-logo">
                <RitualMark size={72} spin={false} />
              </div>
              <p className="font-ui text-[11px] uppercase tracking-[0.32em] text-aqua">{ONBOARDING_STEPS[step].step}</p>
              <h2 className="mt-3 font-display text-2xl font-extrabold uppercase tracking-[0.08em] text-white sm:text-4xl">
                {ONBOARDING_STEPS[step].title}
              </h2>
              <div className="mt-7 flex justify-center gap-2">
                {ONBOARDING_STEPS.map((item, i) => (
                  <span key={item.step} className={`h-2 w-10 bevel-in-thin ${i <= step ? "bg-aqua" : "bg-coal"}`} />
                ))}
              </div>
              <button
                type="button"
                className="win-btn win-btn-emerald mt-8"
                onClick={() => {
                  if (step < ONBOARDING_STEPS.length - 1) setStep((s) => s + 1);
                  else setPhase("ready");
                }}
              >
                {step < ONBOARDING_STEPS.length - 1 ? "Next" : "Complete Setup"}
              </button>
            </div>
          </div>
        ) : null}

        {phase === "ready" ? (
          <div className="boot-panel boot-ready">
            <div className="boot-panel-sweep" aria-hidden />
            <div className="boot-ready-grid" aria-hidden />
            <div className="boot-ready-pulse" aria-hidden />
            <RitualMark size={112} spin={false} />
            <p className="mt-8 font-display text-3xl font-extrabold uppercase tracking-[0.16em] text-white sm:text-5xl">
              RITUAL IDENTITY
            </p>
            <p className="mt-3 font-ui text-lg font-bold uppercase tracking-[0.38em] text-aqua">System Ready</p>
            <button
              type="button"
              className="win-btn win-btn-emerald mt-10 text-[13px]"
              onClick={() => {
                window.localStorage.setItem("ritual-identity-os-onboarded", "1");
                onEnter();
              }}
            >
              Enter System
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RitualAnthemApp() {
  const [bootComplete, setBootComplete] = useState(false);
  const { address, chainId, connect, disconnect, isConnecting, error, isWrongNetwork, switchToRitual, balance } = useInjectedWallet();
  const { mintAnthem, checkIn: weeklyCheckIn, isPending, txHash, hasWallet, requestAttestation } = useAnthemWrites();
  const arenaStats = useArenaStats(address);
  const arenaWrites = useArenaWrites();
  const arenaBattleWins = arenaStats.stats.wins;
  const arenaBattlesPlayed = arenaStats.stats.settledBattles;
  const { data: onchainAnthem, hasMinted: onchainHasMinted, refetch } = useAnthemReads(address);
  const { items: chainItems, refetch: refetchGallery } = useAllAnthems();
  const { fee: mintFee, feeLabel } = useMintFee();
  const { refetch: refetchNextId } = useNextTokenId();
  const cardSnapshotHook = useCardSnapshot(address);
  const cardSnapshot: ChainCardSnapshot | undefined = cardSnapshotHook.snapshot;
  const trainingProgress = useTrainingProgress(address, onchainAnthem && onchainAnthem.tokenId > 0n ? Number(onchainAnthem.tokenId) : undefined);
  const achievementRegistryState = useAchievements(address);
  const { streak: trainingStreak, refetch: refetchStreak } = useStreak(address);
  const trainingStreakCount = trainingStreak?.streakCount ?? 0;
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInMsg, setCheckInMsg] = useState<string>();

  // Bumped after forge / train / arena / achievement writes so
  // `useIdentityRegistry` and `useIdentityLeaderboard` re-read the canonical
  // snapshot. Without this trigger, the profile would show stale local
  // values while the leaderboard already had the updated on-chain value
  // (causing the 41 vs 16 mismatch the user reported).
  const [identityReloadTick, setIdentityReloadTick] = useState(0);
  const bumpIdentity = () => setIdentityReloadTick((t) => t + 1);

  // Post-train refresh hook — called by TrainingWindow after the tx is confirmed.
  // TrainingWindow handles the transaction and burst message — doTrain just refreshes parent state.
  const doTrain = async () => {
    try {
      await Promise.all([
        arenaStats.refetch(),
        refetchStreak(),
        refetch(),
        refetchGallery(),
        trainingProgress.refetch(),
        cardSnapshotHook.refetch(),
      ]);
      bumpIdentity();
    } catch {
      // Refetch errors are non-critical — UI will retry on next interaction
    }
  };

  const wm = useWindows(WIN);
  const desktopRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Bounds>({ w: 1200, h: 760 });
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const [target, setTarget] = useState<string>("");
  const [handle, setHandle] = useState("");
  // Forge preview — the Anthem generated for the current forge form
  // (pre-forge, deterministic from xHandle + tokenId seed). This is distinct
  // from `onchainAnthem` (the live chain read after forge). The forge preview
  // is what we display in the forge form and the success modal.
  const [forgePreview, setForgePreview] = useState<Anthem>();
  const [status, setStatus] = useState(
    hasAnthemContract
      ? "C:\\\\> ritual-arena ready. Connect wallet to forge your Identity Card on Ritual Chain."
      : "C:\\\\> contracts not configured. Set VITE_RITUAL_ANTHEM_ADDRESS (and the other VITE_RITUAL_*_ADDRESS env vars) in .env.production and on Vercel to enable on-chain features.",
  );
  const [tokenId, setTokenId] = useState<number>();
  const [mintedImage, setMintedImage] = useState<string>();
  const [mintedMeta, setMintedMeta] = useState<string>();
  const [generating, setGenerating] = useState(false);
  const [clock, setClock] = useState<Date>(() => new Date());

  const validTarget = useMemo(() => isAddress(target), [target]);
  const cleanHandle = useMemo(() => sanitizeHandle(handle), [handle]);
  const previewHandle = forgePreview?.xHandle || cleanHandle;
  const power = usePower(validTarget ? (target as Address) : undefined, handle);

  // Live holographic NFT card preview — built from the current username/wallet.
  // This is a PRE-SCAN visual preview only, not final minted card Power/Rarity.
  // After scan/forge, CardSnapshot values override these preview values.
  const previewAnthem = useMemo(
    () => generateAnthem(validTarget ? target : "0xpreview", handle, { onchainData: power.onchainData, xData: power.xData }),
    [validTarget, target, handle, power.onchainData, power.xData],
  );

  // Pre-scan streak boost for preview display only.
  // Final minted card uses CardSnapshot currentPower/currentRarity (no streak boost).
  const effective = useMemo(
    () => effectiveRarity(previewAnthem.score, trainingStreakCount),
    [previewAnthem.score, trainingStreakCount],
  );
  const boostedPreview = useMemo(
    () => ({ ...previewAnthem, rarity: effective.rarity, score: Math.max(1, effective.effectiveScore) }),
    [previewAnthem, effective.rarity, effective.effectiveScore],
  );

  // --- Minted wallet = on-chain ground truth -------------------------------
  // Once the connected wallet has minted, its card display uses CardSnapshot
  // currentPower/currentRarity from on-chain storage, not seed-generated values.
  const mintedItem = useMemo(
    () => (onchainAnthem && onchainAnthem.tokenId > 0n ? chainToGalleryItem(onchainAnthem) : undefined),
    [onchainAnthem],
  );
  const minted = Boolean(onchainAnthem && onchainAnthem.tokenId > 0n);
  // Phase 4: use CardSnapshot for displayed power/rarity when available
  const hasValidSnapshot = Boolean(cardSnapshot && cardSnapshot.snapshotVersion >= 1);
  const mintedEffective = useMemo(
    () => {
      if (!mintedItem) return undefined;
      if (hasValidSnapshot && cardSnapshot) {
        // Use on-chain CardSnapshot currentPower/currentRarity (source of truth)
        // No streak boost — CardSnapshot values are the final displayed power/rarity
        return {
          rarity: rankToRarity(cardSnapshot.currentRarity),
          effectiveScore: cardSnapshot.currentPower,
          baseRarity: rankToRarity(cardSnapshot.currentRarity),
          baseScore: cardSnapshot.currentPower,
          boost: 0,
          appliedBoost: 0,
          upgraded: false,
        };
      }
      // No snapshot: return undefined (caller shows "Snapshot unavailable")
      return undefined;
    },
    [mintedItem, hasValidSnapshot, cardSnapshot],
  );
  // Only swap in the on-chain card when the panel is previewing the connected
  // (minted) wallet itself — exploring another address still uses the preview.
  const previewingSelf = useMemo(
    () => Boolean(validTarget && address && target.toLowerCase() === address.toLowerCase()),
    [validTarget, address, target],
  );
  // Phase 4: show minted card when previewing self and wallet has a minted card
  const hasMintedCard = Boolean(previewingSelf && mintedItem);
  const showMintedCard = Boolean(hasMintedCard && mintedEffective);
  const showMintedNoSnapshot = Boolean(hasMintedCard && !mintedEffective);
  const liveCard = useMemo(
    () => {
      if (showMintedCard && mintedItem && mintedEffective && mintedItem.seed > 0) {
        // CardSnapshot available: display on-chain currentPower/currentRarity
        return { ...mintedItem, rarity: mintedEffective.rarity, score: mintedEffective.effectiveScore };
      }
      if (showMintedNoSnapshot && mintedItem) {
        // Minted but no snapshot: show card with seed-based visual but mark power/rarity as unavailable
        // Use INITIATE as fallback rarity (valid Rarity type) — UI will show "Snapshot unavailable" separately
        return { ...mintedItem, rarity: "INITIATE" as const, score: 0, seed: -1 };
      }
      // After scan, forgePreview is built from ForgeCardSnapshot (source of truth).
      // forgePreview.score >= 1 indicates scan completed (valid CardSnapshot power, range 1-100).
      if (forgePreview && forgePreview.score > 0) {
        return forgePreview;
      }
      return boostedPreview;
    },
    [showMintedCard, showMintedNoSnapshot, mintedItem, mintedEffective, boostedPreview, forgePreview],
  );

  const [cardPreviewUrl, setCardPreviewUrl] = useState<string>();
  const [cardPreviewError, setCardPreviewError] = useState("");
  const [cardRendering, setCardRendering] = useState(false);
  const liveCardGalleryMeta = liveCard as GalleryItem;
  const liveCardRenderKey = useMemo(
    () => [
      liveCardGalleryMeta.tokenId ?? "preview",
      liveCard.xHandle || "anon",
      liveCardGalleryMeta.wallet || target || "",
      liveCard.seed || 0,
      liveCard.score || 0,
      liveCard.rarity,
      showMintedCard ? mintedItem?.tokenId ?? "" : "",
      showMintedCard ? "INITIATE" : "",
    ].join(":"),
    [liveCardGalleryMeta.tokenId, liveCard.xHandle, liveCardGalleryMeta.wallet, liveCard.seed, liveCard.score, liveCard.rarity, target, showMintedCard, mintedItem?.tokenId],
  );
  // Re-render the card (debounced) whenever a new username/wallet/streak changes.
  useEffect(() => {
    let cancelled = false;
    setCardRendering(true);
    setCardPreviewError("");
    const tokenIdOpt = showMintedCard && mintedItem ? { tokenId: mintedItem.tokenId, rankTier: "INITIATE" as const } : undefined;
    const fallbackId = window.setTimeout(() => {
      if (!cancelled) {
        setCardRendering(false);
        setCardPreviewError("Fallback card view");
      }
    }, 3000);
    const id = window.setTimeout(() => {
      renderAnthemCardDataUrl(liveCard, tokenIdOpt)
        .then((url) => {
          if (!cancelled) setCardPreviewUrl(url);
        })
        .catch((error) => {
          if (!cancelled) {
            setCardPreviewError(error instanceof Error ? error.message : "Card preview failed.");
          }
        })
        .finally(() => {
          window.clearTimeout(fallbackId);
          if (!cancelled) setCardRendering(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
      window.clearTimeout(fallbackId);
    };
  }, [liveCardRenderKey]);

  const gallery: GalleryItem[] = useMemo(() => {
    const items = chainItems.map(chainToGalleryItem);
    // Enrich owned gallery items with CardSnapshot currentPower/currentRarity
    if (address && hasValidSnapshot && cardSnapshot) {
      return items.map((item) =>
        item.wallet?.toLowerCase() === address.toLowerCase()
          ? { ...item, score: Number(cardSnapshot.currentPower), rarity: rankToRarity(Number(cardSnapshot.currentRarity)) }
          : item
      );
    }
    return items;
  }, [chainItems, address, hasValidSnapshot, cardSnapshot]);
  const publicCardSnapshots = usePublicCardSnapshots(gallery.map((g) => g.wallet as Address | undefined));
  const snapshotForGalleryItem = (item: GalleryItem) => {
    const snap = item.wallet ? publicCardSnapshots.snapshots.get(item.wallet.toLowerCase()) : undefined;
    return snap && snap.snapshotVersion >= 1 && snap.currentPower > 0
      ? { currentPower: snap.currentPower, currentRarity: snap.currentRarity }
      : undefined;
  };

  // ── Rarity filter state ──
  type RarityFilter = "ALL" | "INITIATE" | "BITTY" | "RITTY" | "RITUALIST" | "RADIANT";
  const RARITY_FILTERS: RarityFilter[] = ["ALL", "INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT"];
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("ALL");

  // ── Sorted + filtered gallery — reputation board order ──
  // Sort: currentPower DESC → forgedAt DESC → unavailable snapshots last
  const [filteredGallery, setFilteredGallery] = useState<GalleryItem[]>([]);

  useEffect(() => {
    const withSnap = gallery.map((g) => {
      const snap = g.wallet ? publicCardSnapshots.snapshots.get(g.wallet.toLowerCase()) : undefined;
      return { item: g, snap };
    });

    const filtered = rarityFilter === "ALL"
      ? withSnap
      : withSnap.filter(({ snap }) => {
          if (!snap || snap.snapshotVersion < 1) return false;
          return rankToRarity(snap.currentRarity) === rarityFilter;
        });

    const sorted = [...filtered].sort((a, b) => {
      const aHas = a.snap && a.snap.snapshotVersion >= 1;
      const bHas = b.snap && b.snap.snapshotVersion >= 1;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      if (aHas && bHas) {
        const powerDiff = (b.snap!.currentPower ?? 0) - (a.snap!.currentPower ?? 0);
        if (powerDiff !== 0) return powerDiff;
        return (b.snap!.tokenId ?? 0) > (a.snap!.tokenId ?? 0) ? 1 : -1;
      }
      return 0;
    });

    setFilteredGallery(sorted.map(({ item }) => item));
  }, [gallery, rarityFilter, publicCardSnapshots.snapshots]);

  // Phase 4: inject CardSnapshot power/rarity into the primary training card
  // Gallery is already enriched above, so trainingCards just filters owned
  const trainingCards = useMemo(() => {
    const owned = address ? gallery.filter((g) => g.wallet?.toLowerCase() === address.toLowerCase()) : [];
    if (owned.length > 0) return owned;
    return mintedItem ? [mintedItem] : [];
  }, [address, gallery, mintedItem]);

  // Identity Score / Rank are computed exclusively by `useIdentityRegistry`
  // (which reads `IdentityRegistry.getIdentity(wallet)`). There is no local
  // fallback calculation. If the registry has not yet recorded the wallet
  // (`identity.canonical === false`), the Profile shows "Sync Pending"
  // rather than a derived value.

  // Achievement list with unlocked flags for profile display
  // Uses registry-on-chain IDs when available, otherwise derives from frontend state
  const achievements = useMemo(() => {
    let unlockedSet: Set<string>;

    if (hasAchievementRegistry && achievementRegistryState.entries.length > 0) {
      // Registry available: match by bytes32 id
      const registryIds = new Set(
        achievementRegistryState.entries
          .filter((e) => e.unlocked)
          .map((e) => e.id.toLowerCase())
      );
      unlockedSet = registryIds;
    } else {
      // Fallback: derive from frontend state using bytes32 IDs
      const state: AchievementState = {
        hasForged: minted,
        hasTrained: trainingProgress.progress.trainCount > 0,
        trainingLevel: trainingProgress.progress.level,
        battlesPlayed: arenaBattlesPlayed,
        wins: arenaBattleWins,
        currentStreak: trainingStreakCount,
      };
      const unlockedIds = checkAchievements(state); // returns bytes32[]
      unlockedSet = new Set(unlockedIds.map((id) => id.toLowerCase()));
    }

    return ACHIEVEMENTS.map((a) => ({
      ...a,
      unlocked: unlockedSet.has(a.id.toLowerCase()),
    }));
  }, [minted, trainingProgress.progress.trainCount, trainingProgress.progress.level, arenaBattlesPlayed, arenaBattleWins, trainingStreakCount, hasAchievementRegistry, achievementRegistryState.entries]);

  // Minimal fallback for `useIdentityRegistry`. When the registry is
  // canonical, the hook overrides every field with the on-chain value.
  // When the registry is NOT canonical (wallet not yet recorded), the
  // Profile shows "Sync Pending" instead of using any of these values.
  // The fields below are kept only to satisfy the `IdentityView` type
  // signature; the Profile never reads them.
  const identityView = useMemo(() => ({
    score: 0,
    rank: "INITIATE" as const,
    level: 0,
    totalXp: 0,
    nextRank: "INITIATE" as const,
    nextRankAt: 0,
    progressPct: 0,
    canonical: false,
    registryUpdatedAt: 0,
    registryVersion: 0,
    sources: [],
  }), []);

  // Inject the current training level into the primary card so every render
  // target (Identity Card display, Profile preview, Metadata image) reads the
  // same Visual Evolution state.
  const primaryCardWithLevel = useMemo(() => {
    const base = trainingCards[0];
    if (!base) return undefined;
    return { ...base, trainingLevel: trainingProgress.progress.level };
  }, [trainingCards, trainingProgress.progress.level]);

  // Fallback for users who have not minted an Anthem NFT but have
  // forged RitualPackNFTs. The Profile "Card Preview" section reads
  // this so pack-only wallets still see a card visual.
  const ownedPacks = useOwnedPackNFTs(address);
  const [packPool, setPackPool] = useState<CollectionPool | null>(null);
  useEffect(() => {
    void loadCollectionPool().then(setPackPool).catch(() => setPackPool(null));
  }, []);
  const primaryPackCard: PackResultCard | undefined = useMemo(() => {
    const c: OwnedPackCard | undefined = ownedPacks.cards[0];
    if (!c) return undefined;
    const poolCard = packPool?.byId?.[Number(c.cardId)];
    const rarityName: InternalRarity =
      (typeof c.rarity === "number" && INTERNAL_RARITIES[c.rarity]) ||
      roleToInternalRarity(c.role) ||
      "BITTY";
    return {
      cardId: Number(c.cardId),
      userId: poolCard?.userId ?? `chain-${c.cardId.toString()}`,
      username: poolCard?.username ?? c.role.toLowerCase() ?? "anonymous",
      avatarUrl: poolCard?.avatarUrl ?? "",
      rarity: rarityName,
      visualRarity: internalToVisualRarity(rarityName) as Rarity,
      power: c.power,
      role: c.role,
      traits: [],
      generation: 1,
      serial: `${c.cardId.toString()} / on-chain`,
      serialNumber: Number(c.cardId),
      mintedSerial: Number(c.cardId),
      owner: address ?? "guest",
      acquiredAt: c.mintedAt,
      instanceId: `nft-${c.tokenId.toString()}`,
    };
  }, [ownedPacks.cards, packPool, address]);

  const identity = useIdentityRegistry(address, identityView, identityReloadTick);

  const mintedCount = chainItems.length;

  useEffect(() => {
    refetchGallery();
  }, [refetchGallery]);
  // Reload the gallery whenever the Anthems window is opened (catch new mints).
  useEffect(() => {
    if (wm.wins.minted.open && !wm.wins.minted.min) void refetchGallery();
  }, [wm.wins.minted.open, wm.wins.minted.min, refetchGallery]);
  useEffect(() => {
    if (address) {
      setTarget(address);
      refetch();
    }
  }, [address, refetch]);
  useEffect(() => {
    if (onchainAnthem && onchainAnthem.tokenId > 0n) setTokenId(Number(onchainAnthem.tokenId));
  }, [onchainAnthem]);
  // Phase 4: show "Snapshot unavailable" status when minted but no CardSnapshot
  useEffect(() => {
    if (showMintedNoSnapshot) {
      setStatus("Identity Card forged — snapshot unavailable. Reconnect wallet to refresh.");
    }
  }, [showMintedNoSnapshot]);
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  // Measure the desktop area for drag-clamping + maximize.
  useEffect(() => {
    if (!bootComplete) return;
    const el = desktopRef.current;
    if (!el) return;
    const update = () => setBounds({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [bootComplete]);

  // Close menus on outside click.
  useEffect(() => {
    if (!openMenu) return;
    const h = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-menu]")) setOpenMenu(null);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [openMenu]);

  // ── Forge card snapshot — fixed at Power 1 / INITIATE ──
  // No scanning. Card starts simple, evolves through Training/Arena.
  const [forgeSnapshot, setForgeSnapshot] = useState<ForgeCardSnapshot | null>(null);

  // Forge success modal: set when a forge tx confirms, drives the share flow.
  // `card.tokenId` is REQUIRED — the parent must only call setForgeSuccess
  // after extracting a real, positive tokenId from the AnthemMinted event.
  // The modal shows a loading state if tokenId is not a positive number,
  // so the type enforces the contract at compile time.
  const [forgeSuccess, setForgeSuccess] = useState<{
    card: ForgeSuccessCard;
    power: number;
    rarity: number;
    trainingLevel: number;
  } | null>(null);

  const scan = () => {
    if (!validTarget) return setStatus("ERR: enter a valid wallet address (0x...).");
    setGenerating(true);
    setStatus("Preparing Identity Card…");
    wm.open("create");
    window.setTimeout(async () => {
      try {
        // Fixed initial snapshot — Power 1, INITIATE
        const snapshot = buildForgeCardSnapshot(target as Address, sanitizeHandle(handle));
        setForgeSnapshot(snapshot);
        const anthemWithSnapshot = generateAnthem(target, handle, {
          onchainData: undefined,
          xData: undefined,
        });
        anthemWithSnapshot.score = 1;
        anthemWithSnapshot.rarity = "INITIATE";
        setForgePreview(anthemWithSnapshot);
        setGenerating(false);
        setStatus("Ready to forge — Power 1 (INITIATE). Your card will evolve through Training and Arena activity.");
      } catch (err) {
        setGenerating(false);
        setForgeSnapshot(null);
        setStatus(err instanceof Error ? err.message : "Unable to prepare card. Try again.");
      }
    }, 450);
  };

  // ── Forge flow (no scan power/rarity — fixed at 1/INITIATE) ──
  const mint = async () => {
    if (!forgePreview) return setStatus("Prepare your card first.");
    if (!hasAnthemContract) return setStatus("Contracts not configured. Set VITE_RITUAL_ANTHEM_ADDRESS in .env.production (and on Vercel for the live build) so the IdentityCard contract can be reached.");
    if (!hasWallet) return setStatus("No wallet extension found. Install MetaMask and refresh.");
    try {
      let acct = address;
      if (!acct) acct = await connect();
      if (!acct) return;

      // Guard 1: one card per wallet.
      // Use direct hasMinted flag (independent of getAnthem RPC read) so the
      // UI works even when the public RPC is unreliable for large array reads.
      if (onchainHasMinted || (onchainAnthem && onchainAnthem.tokenId > 0n)) {
        wm.open("minted");
        return setStatus("This wallet already forged its card — only one card per wallet.");
      }
      // Guard 2: one anthem per X handle (case-insensitive, enforced onchain too).
      if (forgePreview.xHandle) {
        setStatus(`Checking if @${forgePreview.xHandle} is available…`);
        if (await checkHandleTaken(forgePreview.xHandle)) {
          return setStatus(`@${forgePreview.xHandle} is already claimed by another wallet — pick a different X handle.`);
        }
      }

      // No scan required — power is always 1 at forge

      // Build forgePreview with seed-based visual traits only.
      // Power and rarity come from the shared snapshot.
      const forgeAnthem = generateAnthem(target, handle, {
        onchainData: undefined,
        xData: undefined,
      });
      // Override power and rarity from snapshot (source of truth)
      forgeAnthem.score = forgeSnapshot!.power;
      forgeAnthem.rarity = forgeSnapshot!.rarity as typeof forgeAnthem.rarity;

      // ── Validation: preview must match metadata ──
      if (forgePreview && forgePreview.score !== forgeAnthem.score) {
        return setStatus(`Power mismatch: preview=${forgePreview.score}, forge=${forgeAnthem.score}. Please scan again.`);
      }
      if (forgePreview && forgePreview.rarity !== forgeAnthem.rarity) {
        return setStatus(`Rarity mismatch: preview=${forgePreview.rarity}, forge=${forgeAnthem.rarity}. Please scan again.`);
      }

      let metadataURI = buildMetadataUri(forgeAnthem, acct as Address, forgeSnapshot!.power, forgeSnapshot!.rarity);
      let audioURI = forgeAnthem.audioURI;

      if (hasPinata) {
        let ipfsUploadAvailable = false;
        try {
          setStatus("Checking IPFS upload…");
          const ipfsUploadAvailable = await probeEndpoint();
        } catch {
          ipfsUploadAvailable = false;
        }

        if (ipfsUploadAvailable) {
          try {
            setStatus("Rendering card art + beat…");
            const [cardBlob, wavBlob] = await Promise.all([
              renderAnthemCard(forgeAnthem),
              renderBeatWav(forgeAnthem),
            ]);
            setStatus("Uploading image to IPFS…");
            const imageURI = await pinFile(cardBlob, `ritual-anthem-${acct}.png`);
            setStatus("Uploading audio to IPFS…");
            audioURI = await pinFile(wavBlob, `ritual-anthem-${acct}.wav`);
            setStatus("Uploading metadata to IPFS…");
            metadataURI = await pinJson(
              buildMetadata(forgeAnthem, acct as Address, imageURI, audioURI, forgeSnapshot!.power, forgeSnapshot!.rarity),
              `ritual-anthem-${acct}.json`
            );
            setMintedImage(imageURI);
            setMintedMeta(metadataURI);
          } catch (err) {
            if (import.meta.env.DEV) console.warn("IPFS upload failed, using inline fallback:", err);
            ipfsUploadAvailable = false;
          }
        }

        if (!ipfsUploadAvailable) {
          if (hasPinata) {
            setStatus("IPFS upload unavailable. Using inline metadata fallback.");
          }
          metadataURI = buildMetadataUri(forgeAnthem, acct as Address, forgeSnapshot!.power, forgeSnapshot!.rarity);
          setMintedMeta(metadataURI);
        }
      } else {
        metadataURI = buildMetadataUri(forgeAnthem, acct as Address, forgeSnapshot!.power, forgeSnapshot!.rarity);
        setMintedMeta(metadataURI);
      }

      // Ensure metadataURI is always set before minting
      if (!metadataURI) {
        metadataURI = buildMetadataUri(forgeAnthem, acct as Address, forgeSnapshot!.power, forgeSnapshot!.rarity);
      }

      const value = mintFee ?? 0n;
      setStatus(
        value > 0n
          ? `Confirm in wallet — forge fee ${feeLabel} RITUAL will be sent to the creator…`
          : "Confirm the transaction in your wallet (auto add/switch to Ritual Chain)…",
      );

      // Phase 6: request forge attestation (no power/rarity — fixed at 1/INITIATE)
      setStatus("Requesting forge authorization...");
      const attestation = await requestAttestation("forge", {
        xHandle: forgeAnthem.xHandle,
      });

      const { receipt } = await mintAnthem(
        {
          xHandle: forgeAnthem.xHandle,
          mood: forgeAnthem.mood,
          lyrics: forgeAnthem.lyrics,
          musicPrompt: forgeAnthem.prompt,
          audioURI,
          metadataURI,
          signature: attestation.signature,
          expiry: attestation.expiry,
          nonce: attestation.nonce,
        },
        value,
      );

      const ANTHEM_MINTED_TOPIC = keccak256(
        toHex("AnthemMinted(uint256,address,string,string,uint16,uint8)"),
      );
      // Extract the real tokenId from the AnthemMinted event in the receipt.
      // This is the canonical source — don't rely on the (stale) closure
      // value of `mintedItem` from the pre-mint render.
      const mintedLog = receipt.logs.find(
        (l: { topics: ReadonlyArray<string> }) => l.topics[0] === ANTHEM_MINTED_TOPIC,
      );
      if (!mintedLog || !mintedLog.topics[1]) {
        throw new Error("Forge transaction did not emit AnthemMinted with tokenId — cannot show success card.");
      }
      const mintedTokenId = BigInt(mintedLog.topics[1]);
      if (mintedTokenId === 0n) {
        throw new Error("Forged tokenId is zero — unexpected.");
      }

      setStatus(
        `Card forged onchain (block #${receipt.blockNumber}, token #${mintedTokenId}).${hasPinata ? " Art + beat + metadata pinned to IPFS." : ""}`,
      );

      // Read the live on-chain state for the fresh card. We bypass the
      // (closure-captured) `mintedItem` and `cardSnapshotHook` because their
      // state hasn't refetched yet.
      const [freshAnthem, freshSnapshot] = await Promise.all([
        publicClient.readContract({
          address: anthemAddress,
          abi: identityCardAbi,
          functionName: "getAnthem",
          args: [address as Address],
        }) as unknown as Promise<ChainAnthem>,
        publicClient.readContract({
          address: anthemAddress,
          abi: identityCardAbi,
          functionName: "getCardSnapshot",
          args: [address as Address],
        }) as unknown as Promise<ChainCardSnapshot>,
      ]);

      // Trigger the background refetches so other UI (Profile, gallery) updates too.
      void Promise.all([refetch(), refetchGallery()]);
      void refetchNextId();
      // Re-read the canonical IdentityRegistry snapshot so the profile
      // displays the freshly forged card's score instead of a stale value.
      bumpIdentity();

      // Build the full GalleryItem from the live on-chain data.
      const liveMintedItem = chainToGalleryItem(freshAnthem);
      const livePower = Number(freshSnapshot.currentPower);
      const liveRarity = Number(freshSnapshot.currentRarity) as 0 | 1 | 2 | 3 | 4;

      // Open the Identity Cards gallery as before.
      wm.open("minted");

      // Trigger the share-flow modal with the freshly forged card,
      // using the LIVE on-chain data (not the pre-forge preview).
      // The `card.tokenId` is the real on-chain tokenId extracted from
      // the AnthemMinted event in the receipt above. The modal will not
      // render the card preview until this value is a positive number.
      if (!mintedTokenId || mintedTokenId === 0n) {
        // Defensive: should never happen — `mintedTokenId` was already
        // validated to be non-zero right after receipt parsing. If we
        // somehow get here, skip the success modal and let the user
        // see the gallery instead.
        throw new Error("Forge succeeded but no tokenId was extracted from the receipt.");
      }
      setForgeSuccess({
        card: {
          xHandle: liveMintedItem.xHandle,
          mood: liveMintedItem.mood,
          lyrics: liveMintedItem.lyrics,
          prompt: liveMintedItem.prompt,
          audioURI: liveMintedItem.audioURI,
          wallet: address,
          tokenId: Number(mintedTokenId),
          score: liveMintedItem.score,
          genre: liveMintedItem.genre,
          archetype: liveMintedItem.archetype,
          bpm: liveMintedItem.bpm,
          musicKey: liveMintedItem.musicKey,
          gradient: liveMintedItem.gradient,
          accent: liveMintedItem.accent,
        },
        power: livePower,
        rarity: liveRarity,
        trainingLevel: 0, // new card, no training yet
      });
    } catch (err) {
      setStatus(txErrorMessage(err, "Forge"));
    }
  };

  const shareToX = () => {
    // Use the finalized forged card data, never the pre-forge preview.
    // Source priority:
    //   1. `forgeSuccess` — set by the modal after a successful forge (highest priority)
    //   2. `mintedItem` — derived from the live on-chain read
    //   3. `forgePreview` — pre-forge preview (only used before any forge, e.g.
    //      the home-page live card preview for an unconnected wallet)
    // If none of these are ready, show a "Card still rendering" hint instead
    // of sharing partial/garbage data.
    const source =
      (forgeSuccess?.card as { xHandle?: string; tokenId?: number } | undefined) ??
      mintedItem ??
      forgePreview;
    if (!source) return setStatus("Card still rendering.");
    const handle = (source as { xHandle?: string }).xHandle;
    const tokenId = (source as { tokenId?: number }).tokenId;
    // Power / Grade from the highest-fidelity source we have. The card
    // snapshot (currentPower/currentRarity) is canonical; forgeSnapshot is
    // the pre-mint fallback (used for users who forged but the snapshot
    // read hasn't landed yet).
    const power =
      (mintedItem
        ? (cardSnapshot?.currentPower && cardSnapshot.currentPower > 0
            ? cardSnapshot.currentPower
            : 1)
        : (forgeSuccess?.power ?? forgeSnapshot?.power ?? 1)) as number;
    const rarityIndex = (mintedItem
      ? (cardSnapshot?.currentRarity ?? forgeSuccess?.rarity ?? forgeSnapshot?.rarity ?? 0)
      : (forgeSuccess?.rarity ?? forgeSnapshot?.rarity ?? 0)) as number;
    const grade = RARITY_NAMES[Math.max(0, Math.min(4, rarityIndex | 0))] ?? "INITIATE";
    if (tokenId !== undefined && (!Number.isFinite(tokenId) || tokenId <= 0)) {
      return setStatus("Card still rendering.");
    }
    const text = buildShareText({
      tokenId: Number.isFinite(tokenId) && (tokenId as number) > 0 ? (tokenId as number) : undefined,
      xHandle: handle,
      power,
      grade,
      identityRank: (identity?.rank as unknown as string) ?? "INITIATE",
      identityScore: identity?.canonical ? identity.score : undefined,
      wallet: address,
      appUrl: typeof window !== "undefined" ? window.location.origin : "https://ritual-arenav0.vercel.app",
    });
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) window.location.href = url;
  };

  const copyAddress = () => {
    if (!address) return;
    try {
      void navigator.clipboard?.writeText(address);
      setStatus(`Address copied: ${shortAddr(address)}`);
    } catch {
      setStatus("Could not access the clipboard.");
    }
  };

  const disconnectWallet = () => {
    void disconnect();
    // Reset all forge/identity state so a new wallet starts with a clean slate.
    setTarget("");
    setHandle("");
    setForgePreview(undefined);
    setTokenId(undefined);
    setMintedImage(undefined);
    setMintedMeta(undefined);
    setGenerating(false);
    setCardPreviewUrl(undefined);
    setCardPreviewError("");
    setCardRendering(false);
    setForgeSnapshot(null);
    setForgeSuccess(null);
    setStatus("Wallet disconnected. Connect again to forge your card.");
  };

  // Wallet dropdown shared by the title-bar pill and the taskbar tray.
  const walletMenu: MenuEntry[] = address
    ? [
        ...(isWrongNetwork
          ? [{ label: "Switch to Ritual Chain", icon: Wifi, onClick: switchToRitual } as MenuEntry]
          : []),
        { label: "Copy address", icon: Copy, onClick: copyAddress },
        { label: "View on Explorer", icon: ExternalLink, href: explorerAddressUrl(address), external: true },
        { sep: true },
        { label: "Disconnect", icon: LogOut, onClick: disconnectWallet },
      ]
    : [];

  const workflow: AnthemWorkflow = minted
    ? "Forged"
    : isPending
      ? "Forging"
      : forgePreview
        ? "Forge Preview"
        : "Ready";
  const timeStr = clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const wp = (id: WinId) => ({
    st: wm.wins[id],
    z: 10 + wm.order.indexOf(id),
    active: wm.topId === id,
    bounds,
    icon: (() => {
      const Ic = iconFor(id);
      return <Ic size={13} />;
    })(),
    onFocus: () => wm.focus(id),
    onClose: () => wm.close(id),
    onMin: () => wm.toggleMin(id),
    onMax: () => wm.toggleMax(id),
    onMove: (x: number, y: number) => wm.move(id, x, y),
  });

  const menuBar: { name: string; items: MenuEntry[] }[] = [
    {
      name: "File",
      items: [
        { label: "Forge Identity Card", icon: Hammer, onClick: () => wm.open("create") },
        address
          ? { label: "Disconnect Wallet", icon: LogOut, onClick: disconnectWallet }
          : { label: "Connect Wallet", icon: Wallet, onClick: () => void connect() },
        { sep: true },
        { label: "Exit", icon: X, onClick: () => wm.topId && wm.close(wm.topId) },
      ],
    },
    {
      name: "Edit",
      items: [
        { label: "Scan Wallet", icon: Sparkles, onClick: scan },
        { label: "Forge Identity Card", icon: UploadCloud, onClick: () => void mint() },
      ],
    },
    {
      name: "View",
      items: [
        { label: "Home", icon: Cpu, onClick: () => wm.open("home") },
        { label: "Forge Identity Card", icon: Hammer, onClick: () => wm.open("create") },
        { label: "Identity Cards", icon: Layers, onClick: () => wm.open("minted") },
        { label: "Identity Profile", icon: Fingerprint, onClick: () => wm.open("profile") },
        { label: "Arena", icon: Swords, onClick: () => wm.open("arena") },
        { label: "Training", icon: CalendarCheck, onClick: () => wm.open("training") },
        { label: "Ritual Arena Docs", icon: BookOpen, onClick: () => wm.open("docs") },
        { label: "System Info", icon: Activity, onClick: () => wm.open("sysinfo") },
      ],
    },
    {
      name: "Tools",
      items: [
        { label: "Get testnet RITUAL", icon: Droplets, href: faucetUrl, external: true },
        { label: "Ritual Explorer", icon: Cpu, href: EXPLORER_HOME, external: true },
        { label: "Protocol Docs", icon: BookOpen, onClick: () => wm.open("docs") },
      ],
    },
    {
      name: "Window",
      items: [
        { label: "Minimize All", onClick: wm.minimizeAll },
        { label: "Close All", onClick: wm.closeAll },
      ],
    },
    {
      name: "Help",
      items: [
        { label: "About Ritual Arena", icon: Info, onClick: () => wm.open("about") },
        { label: "Ritual Arena Docs", icon: BookOpen, onClick: () => wm.open("docs") },
        { label: "Ritual Docs", icon: ExternalLink, href: "https://docs.ritualfoundation.org", external: true },
      ],
    },
  ];

  const startItems: MenuEntry[] = [
    { label: "Forge Identity Card", icon: Hammer, onClick: () => wm.open("create") },
    { label: "Identity Cards", icon: Layers, onClick: () => wm.open("minted") },
    { label: "Identity Profile", icon: Fingerprint, onClick: () => wm.open("profile") },
    { label: "Arena", icon: Swords, onClick: () => wm.open("arena") },
    { label: "Training", icon: CalendarCheck, onClick: () => wm.open("training") },
    { label: "Ritual Arena Docs", icon: BookOpen, onClick: () => wm.open("docs") },
    { label: "System Info", icon: Activity, onClick: () => wm.open("sysinfo") },
    { sep: true },
    ...(address
      ? [
          { label: shortAddr(address), icon: Wallet } as MenuEntry,
          { label: "Disconnect Wallet", icon: LogOut, onClick: disconnectWallet } as MenuEntry,
        ]
      : [{ label: "Connect Wallet", icon: Wallet, onClick: () => void connect() } as MenuEntry]),
    { label: "Get testnet RITUAL", icon: Droplets, href: faucetUrl, external: true },
    { label: "Ritual Explorer", icon: Cpu, href: EXPLORER_HOME, external: true },
    { sep: true },
    { label: "Ritual Arena Docs", icon: BookOpen, onClick: () => wm.open("docs") },
    { label: "About Ritual Arena", icon: Info, onClick: () => wm.open("about") },
  ];

  const onTask = (id: WinId) => {
    const w = wm.wins[id];
    if (w.min) wm.open(id);
    else if (wm.topId === id) wm.toggleMin(id);
    else wm.focus(id);
  };

  if (!bootComplete) {
    return <BootSequence onEnter={() => setBootComplete(true)} />;
  }

  return (
    <div className="ritual-os-shell ritual-scaled-surface flex h-screen flex-col overflow-hidden font-sys text-ice">
      <div className="crt-overlay" aria-hidden />

      {/* ===== TITLE BAR + MENU BAR ===== */}
      <header className="relative z-40 bevel-out bg-wgray p-[3px]">
        <div className="title-grad flex items-center gap-2 px-2 py-1">
          <RitualMark size={18} spin glow={false} />
          <span className="font-ui text-[13px] font-bold text-ice">Ritual Arena</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-iceaccent/80 sm:inline">
            · identity · activity · ranking
          </span>
          <span className="flex-1" />
          <span className="hidden items-center gap-1.5 bevel-out bg-wgray px-2 py-[3px] font-ui text-[10px] font-bold text-teal2 lg:inline-flex">
            <RitualMark size={11} glow={false} /> Built on Ritual Chain
          </span>

          {/* ===== WALLET CONTROL (top-right) ===== */}
          <div data-menu className="relative flex items-center gap-1.5">
            {address ? <APBadge address={address as Address} /> : null}
            {address ? (
              <button
                type="button"
                onClick={() => setOpenMenu((o) => (o === "wallet" ? null : "wallet"))}
                className="bevel-out inline-flex items-center gap-1.5 bg-wgray px-2 py-[3px] font-ui text-[11px] font-bold text-coal hover:bg-[#cdcdcd]"
                title={isWrongNetwork ? "Wrong network — click to fix" : "Wallet menu"}
              >
                <span
                  className={`h-2 w-2 rounded-full ${isWrongNetwork ? "bg-[#ff5a5a]" : "bg-[#1CC744]"}`}
                  aria-hidden
                />
                <Wallet size={13} className="text-teal2" />
                <span className="font-mono">{shortAddr(address)}</span>
                <span className="hidden items-center gap-1 border-l border-coal/30 pl-1.5 font-mono text-teal2 sm:inline-flex">
                  {formatBalance(balance)}
                  <span className="text-[9px] font-bold text-coal/70">RITUAL</span>
                </span>
                <ChevronDown size={12} className={openMenu === "wallet" ? "rotate-180 transition-transform" : "transition-transform"} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void connect()}
                className="win-btn win-btn-emerald inline-flex items-center gap-1.5 !py-[3px] !text-[11px]"
              >
                <Wallet size={13} /> {isConnecting ? "Connecting…" : "Connect Wallet"}
              </button>
            )}
            {openMenu === "wallet" && address ? (
              <MenuList
                items={walletMenu}
                onPick={() => setOpenMenu(null)}
                className="absolute right-0 top-full mt-[2px] w-[210px]"
                header={
                  <div className="title-grad mb-[3px] px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <Wallet size={14} className="text-ice" />
                      <span className="flex-1 font-mono text-[11px] font-bold text-ice">{shortAddr(address)}</span>
                      <span className={`font-ui text-[9px] font-bold ${isWrongNetwork ? "text-[#ffb4b4]" : "text-iceaccent"}`}>
                        {isWrongNetwork ? "Wrong Net" : "Ritual"}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-[22px] font-mono text-[11px] text-iceaccent">
                      {formatBalance(balance)} <span className="text-[9px] font-bold text-ice/70">RITUAL</span>
                    </div>
                  </div>
                }
              />
            ) : null}
          </div>
        </div>
        <div className="bevel-out-thin flex items-center bg-wgray">
          {menuBar.map((m) => (
            <div key={m.name} data-menu className="relative">
              <button
                className={`menu-item font-ui ${openMenu === m.name ? "bg-teal2 !text-ice" : ""}`}
                onClick={() => setOpenMenu((o) => (o === m.name ? null : m.name))}
                onMouseEnter={() => setOpenMenu((o) => (o ? m.name : o))}
              >
                <u>{m.name[0]}</u>
                {m.name.slice(1)}
              </button>
              {openMenu === m.name ? (
                <MenuList items={m.items} onPick={() => setOpenMenu(null)} className="absolute left-0 top-full mt-[2px]" />
              ) : null}
            </div>
          ))}
        </div>
      </header>

      {/* ===== DESKTOP ===== */}
      <div ref={desktopRef} data-desktop-root className="relative flex-1 overflow-auto pb-8">
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
          <div className="absolute right-[-130px] top-20 opacity-[0.035] mix-blend-screen">
            <RitualMark size={430} glow={false} shine />
          </div>
          <div className="absolute bottom-6 left-[-80px] opacity-[0.025] mix-blend-screen">
            <RitualMark size={300} glow={false} shine />
          </div>
        </div>

        {/* desktop shortcut icons (behind windows) */}
        <div data-desktop-icons className="absolute left-2 top-2 z-0 flex max-h-[calc(100vh-20px)] flex-col gap-1 overflow-y-auto no-scrollbar">
          <SideIcon icon={Monitor} label="My Computer" onClick={() => wm.open("home")} />
          <SideIcon icon={Hammer} label="Forge Identity Card" onClick={() => wm.open("create")} />
          <SideIcon icon={Layers} label="Identity Cards" onClick={() => wm.open("minted")} />
          <SideIcon icon={Fingerprint} label="Identity Profile" onClick={() => wm.open("profile")} />
          <SideIcon icon={Swords} label="Arena" onClick={() => wm.open("arena")} />
          <SideIcon icon={CalendarCheck} label="Training" onClick={() => wm.open("training")} />
          <SideIcon icon={Store} label="Market" onClick={() => wm.open("market")} />
          <SideIcon icon={Layers} label="Collection Packs" onClick={() => wm.open("packs")} />
          <SideIcon icon={Recycle} label="Recycle Bin" onClick={() => wm.open("recycle")} />
          <SideIcon icon={LayoutGrid} label="Collection Gallery" onClick={() => wm.open("gallery")} />
          <SideIcon icon={BookOpen} label="Docs" onClick={() => wm.open("docs")} />
          <SideIcon icon={Activity} label="System Info" onClick={() => wm.open("sysinfo")} />
          <SideIcon icon={Cpu} label="Ritual Chain" href={EXPLORER_HOME} external />
          <SideIcon icon={Droplets} label="Faucet" href={faucetUrl} external />
        </div>

        {/* Wrong-network dialog */}
        {isWrongNetwork ? (
          <div className="absolute left-1/2 top-16 z-[50] w-[min(440px,92vw)] -translate-x-1/2 bevel-out bg-wgray p-[3px]">
            <div className="flex items-center gap-2 bg-[#7a1d1d] px-1.5 py-[3px]">
              <AlertTriangle size={14} className="text-ice" />
              <span className="flex-1 font-ui text-[12px] font-bold text-ice">Network Error</span>
            </div>
            <div className="bevel-in bg-coal p-3 font-mono text-[12px]">
              <p className="text-iceaccent">Wallet is on another network. Switch to Ritual Chain (chainId 1979) to forge.</p>
              <div className="mt-3 flex justify-end">
                <button onClick={switchToRitual} className="win-btn">
                  Switch to Ritual Chain
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ----- HERO ----- */}
        <DesktopWindow {...wp("home")}>
          <div className="grid items-center gap-6 lg:grid-cols-[1.1fr_.9fr]">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 bevel-out bg-wgray px-2 py-1 font-ui text-[10px] font-bold text-teal2">
                <Sparkles size={12} /> Ritual Arena
              </span>
              <h1 className="mt-4 font-display text-4xl font-extrabold uppercase leading-[1.04] tracking-tight text-ice sm:text-5xl">
                Ritual
                <br />
                Arena
                <span className="blink text-iceaccent">_</span>
              </h1>
              <p className="mt-5 max-w-xl font-mono text-[13px] leading-6 text-iceaccent/80">
                Forge your Identity Card, train your progress, enter the Arena, and build your rank on Ritual Chain.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <button onClick={() => wm.open("create")} className="win-btn win-btn-emerald inline-flex items-center gap-2">
                  <Hammer size={14} /> Forge Identity Card
                </button>
                <button onClick={() => wm.open("arena")} className="win-btn inline-flex items-center gap-2">
                  <Swords size={14} /> Enter Arena
                </button>
              </div>
              <div className="mt-7 grid max-w-md grid-cols-3 gap-2">
                {[
                  [String(mintedCount || gallery.length), "CARDS"],
                  ["8", "CLASSES"],
                  ["1979", "CHAIN ID"],
                ].map(([n, l]) => (
                  <div key={l} className="bevel-in-thin bg-[#061512] px-2 py-2 text-center">
                    <p className="font-display text-2xl font-extrabold text-aqua">{n}</p>
                    <p className="font-mono text-[9px] tracking-[0.2em] text-iceaccent/60">{l}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {FEATURED_GENESIS_CARDS.map((card) => (
                <div key={card.xHandle} className="relative">
                  <span className="absolute left-2 top-7 z-10 bevel-out-thin bg-[#050505]/85 px-1.5 py-0.5 font-display text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#ffd76a]">
                    Genesis · 100 Power
                  </span>
                  <AnthemCard item={card} snapshot={FEATURED_GENESIS_SNAPSHOT} />
                </div>
              ))}
            </div>
          </div>
          <ForgedCardsMarquee
            items={filteredGallery.length ? filteredGallery : gallery}
            snapshotForItem={snapshotForGalleryItem}
            onOpenGallery={() => wm.open("minted")}
          />
        </DesktopWindow>

        {/* ----- CREATE ----- */}
        <DesktopWindow {...wp("create")}>
          <div className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
            <div>
              <p className="mb-3 font-display text-xl font-extrabold uppercase text-ice">Forge card</p>

              <label className="mb-1 block font-ui text-[12px] text-iceaccent/80">X username (profile photo → card art)</label>
              <div className="bevel-in flex items-center bg-[#061512]">
                <span className="grid place-items-center px-2 text-aqua">
                  <AtSign size={16} />
                </span>
                <input
                  className="win-input w-full !bg-transparent !shadow-none"
                  placeholder="yourhandle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                />
              </div>

              <label className="mb-1 mt-4 block font-ui text-[12px] text-iceaccent/80">Wallet to scan</label>
              <input className="win-input w-full" value={target} onChange={(e) => setTarget(e.target.value)} />

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button onClick={scan} className="win-btn win-btn-emerald inline-flex items-center justify-center gap-1.5">
                  <Sparkles size={15} /> Scan Wallet
                </button>
                <button
                  onClick={mint}
                  disabled={isPending || minted}
                  className="win-btn inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  <UploadCloud size={15} /> {isPending ? "Forging…" : minted ? "Already Forged" : "Forge Identity Card"}
                </button>
              </div>

              {/* mint fee + one-per-wallet notice */}
              {hasAnthemContract ? (
                <div className="bevel-in mt-3 flex items-center gap-2 bg-[#061512] px-2.5 py-2 font-mono text-[11px]">
                  {minted ? (
                    <>
                      <AlertTriangle size={14} className="shrink-0 text-[#ffd27a]" />
                      <span className="text-iceaccent/80">
                        This wallet already forged its card —{" "}
                        <span className="font-bold text-[#ffd27a]">one card per wallet</span>.
                      </span>
                    </>
                  ) : (
                    <>
                      <Wallet size={14} className="shrink-0 text-aqua" />
                      <span className="text-iceaccent/80">
                        Forge fee: <span className="font-bold text-aqua">{feeLabel} RITUAL</span>
                      </span>
                    </>
                  )}
                </div>
              ) : null}

              <div className="bevel-in mt-4 bg-coal p-2.5 font-mono text-[12px] leading-5 text-aqua">
                {status}
                {error ? <span className="ml-1 text-[#ff8a8a]"> // wallet: {error}</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] font-bold">
                {txHash ? (
                  <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-aqua hover:text-iceaccent hover:underline">
                    Transaction <ExternalLink size={12} />
                  </a>
                ) : null}
                {mintedImage ? (
                  <a href={ipfsToHttp(mintedImage)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-aqua hover:text-iceaccent hover:underline">
                    IPFS image <ExternalLink size={12} />
                  </a>
                ) : null}
                {mintedMeta && mintedMeta.startsWith("ipfs://") ? (
                  <a href={ipfsToHttp(mintedMeta)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-aqua hover:text-iceaccent hover:underline">
                    IPFS metadata <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>

            </div>

            {/* live onchainAnthem card */}
            <div className="bevel-out bg-wgray p-[2px]">
              <div className="title-grad flex items-center gap-1.5 px-1.5 py-[3px]">
                <RitualMark size={12} glow={false} />
                <span className="flex-1 truncate font-ui text-[11px] font-bold text-ice">
                  {previewHandle ? `@${previewHandle}` : "preview"}.card
                </span>
                <span className="bg-black/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-iceaccent">
                  {minted ? `FORGED #${tokenId}` : "PREVIEW"}
                </span>
                <WindowControls />
              </div>
              <div className="bevel-in bg-coal p-4">
                {/* Live holographic NFT preview — updates as you type a username */}
                <div className="bevel-in-thin relative mb-4 overflow-hidden bg-[#071512]">
                  {cardPreviewUrl ? (
                    <img src={cardPreviewUrl} alt="Generated card preview" className="block w-full" />
                  ) : (
                    <div
                      className="grid aspect-square w-full place-items-center p-6 text-center"
                      style={{
                        background: `linear-gradient(135deg, ${liveCard.gradient?.[0] ?? "#071512"}, ${liveCard.gradient?.[2] ?? "#063a33"})`,
                      }}
                    >
                      <div className="grid gap-3">
                        <RitualMark size={54} />
                        <div>
                          <p className="font-handle text-2xl font-bold text-aqua">{previewHandle ? `@${previewHandle}` : "@preview"}</p>
                          <p className="mt-1 font-mono text-[11px] text-iceaccent/70">{liveCard.cardArchetype} · {liveCard.mood}</p>
                        </div>
                        <div className="mx-auto grid w-44 grid-cols-2 gap-2 font-mono text-[10px]">
                          <span className="bevel-in-thin bg-black/35 px-2 py-1 text-iceaccent/70">Power <b className="text-aqua">{liveCard.score || 1}</b></span>
                          <span className="bevel-in-thin bg-black/35 px-2 py-1 text-iceaccent/70">Grade <b className="text-[#c9b8ff]">{liveCard.rarity}</b></span>
                        </div>
                      </div>
                    </div>
                  )}
                  {cardPreviewError ? (
                    <span className="absolute left-2 top-2 bg-black/80 px-2 py-1 font-mono text-[10px] text-[#ffd27a]">
                      {cardPreviewError}
                    </span>
                  ) : null}
                  {cardRendering && cardPreviewUrl ? (
                    <span className="absolute right-1.5 top-1.5 bg-black/70 px-2 py-0.5 font-mono text-[10px] text-aqua/80">
                      updating…
                    </span>
                  ) : null}
                </div>

                <button onClick={shareToX} className="win-btn mt-4 inline-flex w-full items-center justify-center gap-2">
                  <Share2 size={15} /> Share to X
                </button>
              </div>
            </div>
          </div>
        </DesktopWindow>

        {/* ----- SYSTEM INFO ----- */}
        <DesktopWindow {...wp("sysinfo")}>
          <SystemInfo
            address={address}
            chainId={chainId}
            isWrongNetwork={isWrongNetwork}
            isConnecting={isConnecting}
            onConnect={() => void connect()}
            onSwitchNetwork={switchToRitual}
          />
        </DesktopWindow>

        {/* ----- FORGED GALLERY ----- */}
        <DesktopWindow {...wp("minted")}>
          <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 border-b border-dashed border-[#1d3a35] bg-coal px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[12px] text-iceaccent/70">
                {mintedCount > 0
                  ? `${mintedCount} Identity Card${mintedCount === 1 ? "" : "s"} forged on Ritual Chain — ranked by reputation.`
                  : "No forged cards found. Forge the first card to begin the collection."}
              </p>
              <button
                onClick={() => void refetchGallery()}
                className="win-btn inline-flex items-center gap-1.5 !py-0.5 !text-[11px]"
                title="Reload forged cards from the chain"
              >
                <Radio size={12} /> Refresh
              </button>
            </div>
            {/* ── Rarity filter ── */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-iceaccent/50">grade:</span>
              {RARITY_FILTERS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRarityFilter(r)}
                  className={`font-mono text-[10px] px-1.5 py-0.5 bevel-in-thin ${
                    rarityFilter === r
                      ? "bg-[#1a3a35] text-aqua"
                      : "bg-[#0a1a18] text-iceaccent/60 hover:text-iceaccent/80"
                  }`}
                >
                  {r.toLowerCase() === "all" ? "all" : r.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredGallery.map((g, i) => (
              <div key={String(g.tokenId)} style={{ order: i }}>
                <AnthemCard
                  item={g}
                  snapshot={snapshotForGalleryItem(g)}
                />
              </div>
            ))}
            {filteredGallery.length === 0 ? (
              <div className="bevel-in-thin bg-[#061512] p-7 text-center font-mono text-[11px] text-iceaccent/65 sm:col-span-2 xl:col-span-3">
                {gallery.length === 0 ? (
                  <>
                    <div className="bevel-out-thin mx-auto mb-3 grid h-14 w-14 place-items-center bg-wgray text-aqua">
                      <Hammer size={25} />
                    </div>
                    <p className="font-display text-xl font-black uppercase tracking-[0.12em] text-ice">No Identity Card yet</p>
                    <p className="mx-auto mt-2 max-w-md text-[11px] leading-5 text-iceaccent/65">
                      Forge your first Identity Card to unlock Training, Arena, and Packs.
                    </p>
                    <button type="button" onClick={() => wm.open("create")} className="win-btn win-btn-emerald mt-4 inline-flex items-center gap-2">
                      <Hammer size={14} /> Forge Identity
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-aqua">No {rarityFilter.toLowerCase()} identity cards found.</p>
                    <p className="mt-1 text-[10px] text-iceaccent/45">Train cards to evolve their grade over time.</p>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </DesktopWindow>

        {/* ----- ABOUT ----- */}
        <DesktopWindow {...wp("about")}>
          <div className="flex items-start gap-3">
            <RitualMark size={44} />
            <div>
              <p className="font-display text-lg font-extrabold text-ice">Ritual Arena</p>
              <p className="font-mono text-[11px] text-iceaccent/70">forge your identity on Ritual Chain</p>
              <p className="mt-2 font-mono text-[12px] leading-5 text-iceaccent/85">
                Ritual Arena is an on-chain identity experience where your wallet becomes a card, your activity builds progression, and your rank grows through Training, Arena activity, achievements, and collection.
              </p>
              <span className="mt-3 inline-flex items-center gap-1.5 bevel-out bg-wgray px-2 py-1 font-ui text-[10px] font-bold text-teal2">
                <RitualMark size={11} glow={false} /> Built on Ritual Chain
              </span>
            </div>
          </div>
        </DesktopWindow>

        {/* ----- IDENTITY PROFILE ----- */}
        <DesktopWindow {...wp("profile")}>
          <Suspense fallback={<WindowLoading label="Loading Identity Profile" />}>
            <IdentityProfileWindow
              address={address}
              identity={identity}
              achievements={achievements}
              cards={trainingCards}
              primaryCard={primaryCardWithLevel}
              primaryPackCard={primaryPackCard}
              arenaPlayer={{
                wins: arenaBattleWins,
                totalBattles: arenaStats.stats.totalBattles,
                settledBattles: arenaStats.stats.settledBattles,
                unmatchedBattles: arenaStats.stats.unmatchedBattles,
                activeBattleId: arenaStats.stats.activeBattleId,
                winStreak: arenaStats.stats.winStreak,
                bestWinStreak: arenaStats.stats.bestWinStreak,
              }}
              arenaRank={"INITIATE" as const}
              arenaScore={arenaStats.stats.arenaScore}
              onForgeIdentity={() => wm.open("create")}
            />
          </Suspense>
        </DesktopWindow>

        {/* ----- TRAINING & LEVEL ----- */}
        <DesktopWindow {...wp("training")}>
          <Suspense fallback={<WindowLoading label="Loading Training" />}>
            <TrainingWindow
              supported={arenaStats.supported}
              hasAnthem={minted}
              isPending={checkingIn || arenaWrites.isPending}
              message={checkInMsg}
              onTrain={doTrain}
              minted={minted}
              cards={trainingCards}
              address={address}
              cardSnapshot={hasValidSnapshot && cardSnapshot ? {
                currentPower: Number(cardSnapshot.currentPower),
                currentRarity: Number(cardSnapshot.currentRarity),
                snapshotVersion: Number(cardSnapshot.snapshotVersion),
              } : null}
            />
          </Suspense>
        </DesktopWindow>

        {/* ----- ARENA ----- */}
        <DesktopWindow {...wp("arena")}>
          <Suspense fallback={<WindowLoading label="Loading Arena" />}>
            <AnthemArenaWindow address={address} gallery={chainItems} />
          </Suspense>
        </DesktopWindow>

        {/* ----- COLLECTION PACKS ----- */}
        <DesktopWindow {...wp("packs")}>
          <Suspense fallback={<WindowLoading label="Loading Collection Packs" />}>
            <PackWindow
              address={address}
              onViewCollection={() => {
                // Navigate to gallery so the user lands on freshly-refreshed
                // card state (event bus already fired nft-changed + ap-changed
                // inside useOpenPack, so the gallery's read hooks refetch
                // automatically the moment it mounts).
                wm.open("gallery");
              }}
            />
          </Suspense>
        </DesktopWindow>

        {/* ----- RECYCLE BIN (NFT deflation sink) ----- */}
        <DesktopWindow {...wp("recycle")}>
          <Suspense fallback={<WindowLoading label="Loading Recycle Bin" />}>
            <RecycleBinWindow address={address} />
          </Suspense>
        </DesktopWindow>

        {/* ----- COLLECTION GALLERY ----- */}
        <DesktopWindow {...wp("gallery")}>
          <Suspense fallback={<WindowLoading label="Loading Collection Gallery" />}>
            <CollectionGalleryWindow address={address} onOpenPacks={() => wm.open("packs")} />
          </Suspense>
        </DesktopWindow>

        {/* ----- MARKET (contains Marketplace + Staking tabs) ----- */}
        <DesktopWindow {...wp("market")}>
          <Suspense fallback={<WindowLoading label="Loading Marketplace" />}>
            <MarketWindow address={address} />
          </Suspense>
        </DesktopWindow>

        {/* ----- RITUAL ARENA DOCS ----- */}
        <DesktopWindow {...wp("docs")}>
          <Suspense fallback={<WindowLoading label="Loading Docs" />}>
            <RitualDocsWindow />
          </Suspense>
        </DesktopWindow>

      </div>

      <div className="fixed bottom-[34px] left-0 right-0 z-50">
        <StatusHUD address={address} onNavigate={(id) => wm.open(id as WinId)} />
      </div>

      {/* ===== TASKBAR ===== */}
      <footer className="relative z-40 bevel-out bg-wgray p-[3px]">
        <div className="flex items-center gap-1.5">
          <div data-menu className="relative">
            <button
              className="win-btn inline-flex items-center gap-1.5 !px-2 !py-1"
              onClick={() => setOpenMenu((o) => (o === "start" ? null : "start"))}
            >
              <RitualMark size={16} glow={false} />
              <span className="font-ui text-[13px] font-extrabold italic text-coal">Start</span>
            </button>
            {openMenu === "start" ? (
              <MenuList
                items={startItems}
                onPick={() => setOpenMenu(null)}
                className="absolute bottom-full left-0 mb-1 w-[220px]"
                header={
                  <div className="title-grad mb-[3px] flex items-center gap-2 px-2 py-2">
                    <RitualMark size={18} glow={false} />
                    <span className="font-ui text-[12px] font-bold text-ice">Ritual Arena</span>
                  </div>
                }
              />
            ) : null}
          </div>

          <div className="flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
            {WIN.filter((w) => wm.wins[w.id].open).map((w) => {
              const pressed = wm.topId === w.id && !wm.wins[w.id].min;
              const Ic = w.icon;
              return (
                <button
                  key={w.id}
                  onClick={() => onTask(w.id)}
                  className={`inline-flex max-w-[170px] items-center gap-1.5 px-2 py-1 font-ui text-[11px] text-coal ${
                    pressed ? "bevel-in bg-[#b4b4b4]" : "bevel-out bg-wgray hover:bg-[#cdcdcd]"
                  }`}
                >
                  <Ic size={13} />
                  <span className="truncate">{w.title.split(" — ")[0]}</span>
                </button>
              );
            })}
          </div>

          {/* system tray */}
          <div className="bevel-in-thin flex items-center gap-2.5 bg-coal px-2 py-1 font-mono text-[11px]">
            <span className="hidden items-center gap-1 text-iceaccent/80 md:inline-flex">
              <Wifi size={13} className={isWrongNetwork ? "text-[#ff8a8a]" : address ? "text-[#1CC744]" : "text-aqua/50"} />
              {isWrongNetwork ? "Wrong Network" : address ? "Ritual Chain" : "offline"}
            </span>
            {address ? (
              <div data-menu className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu((o) => (o === "wallet-tray" ? null : "wallet-tray"))}
                  className="inline-flex items-center gap-1 text-aqua hover:text-iceaccent"
                  title="Wallet menu"
                >
                  <Wallet size={13} /> {shortAddr(address)}
                  <span className="hidden text-iceaccent/90 lg:inline">· {formatBalance(balance)} RITUAL</span>
                  <ChevronDown size={11} />
                </button>
                {openMenu === "wallet-tray" ? (
                  <MenuList
                    items={walletMenu}
                    onPick={() => setOpenMenu(null)}
                    className="absolute bottom-full right-0 mb-1 w-[210px]"
                  />
                ) : null}
              </div>
            ) : null}
            <span className="bevel-in-thin bg-[#061512] px-1.5 py-0.5 text-iceaccent">{timeStr}</span>
          </div>
        </div>
      </footer>
      <div className="mobile-experience-banner">
        Best experienced on desktop - the arena is waiting.
      </div>
      {/* P7: only pass canonical identity to ForgeSuccessModal. The
          registry snapshot is updated asynchronously after IdentityCard
          pushes via updateCardSnapshot — using a stale (or un-canonical)
          value here would put "Score 0" in the tweet copy. */}
      {forgeSuccess ? (
        <ForgeSuccessModal
          open={true}
          card={forgeSuccess.card}
          power={forgeSuccess.power}
          rarity={forgeSuccess.rarity}
          identityScore={identity?.canonical ? identity.score : null}
          identityRank={identity?.canonical ? identity.rank : null}
          identitySyncing={!identity?.canonical}
          trainingLevel={forgeSuccess.trainingLevel}
          wallet={address as Address}
          onClose={() => setForgeSuccess(null)}
        />
      ) : null}
    </div>
  );
}
