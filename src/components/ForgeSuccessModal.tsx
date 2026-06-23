// ForgeSuccessModal.tsx
// Modal that appears immediately after a successful Identity Card forge.
// Offers two actions:
//   1. Download Card — exports the rendered card as PNG (canonical, uses the
//      same renderer as the metadata API and card-image API, so it matches
//      the on-screen card byte-for-byte).
//   2. Share on X — opens https://x.com/intent/tweet with pre-filled text.
//
// No heavy deps (no html2canvas / dom-to-image). The card PNG is generated
// by the existing canvas renderer in src/lib/cardImage.ts.
//
// Data flow contract:
//   - The parent MUST pass a ForgeSuccessCard with a real, positive
//     `tokenId` extracted from the AnthemMinted event in the mint receipt.
//   - If the parent ever passes a card with tokenId <= 0 (or undefined),
//     this modal shows a short loading state ("Rendering forged card…")
//     instead of rendering the AnthemCard. This prevents the visual bug
//     where the card preview would otherwise display "#undefined" and
//     "#preview · 1 Power" as fallbacks.
//   - Share on X uses the SAME `buildShareText` from src/lib/anthem.ts
//     that the global share button uses, so the copy stays consistent
//     across both entry points and never falls back to forgePreview.

import { Download, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AnthemCard, type GalleryItem } from "./AnthemCard";
import { renderAnthemCardDataUrl } from "../lib/cardImage";
import { buildShareText } from "../lib/anthem";
import type { Address } from "viem";

export interface ForgeSuccessCard {
  xHandle: string;
  mood: string;
  lyrics: string;
  prompt: string;
  audioURI: string;
  wallet?: string;
  /**
   * Real on-chain tokenId from the AnthemMinted event. REQUIRED — a missing
   * or non-positive value means the modal renders a loading state instead
   * of a broken card preview.
   */
  tokenId: number;
  /** Additional Anthem fields (filled from onchain data when available). */
  score?: number;
  genre?: string;
  archetype?: string;
  bpm?: number;
  musicKey?: string;
  gradient?: [string, string, string];
  accent?: string;
}

export interface ForgeSuccessModalProps {
  open: boolean;
  card: ForgeSuccessCard | null;
  /** Current power from the live CardSnapshot (post-forge). */
  power: number;
  /** Current rarity index (0..4) from the live CardSnapshot (post-forge). */
  rarity: number;
  /** Current Identity Score (from registry snapshot). null if the
   *  registry has not yet recorded this wallet (post-forge push is
   *  async). Callers must NOT default this to 0 — see identitySyncing. */
  identityScore: number | null;
  /** Current Identity Rank tier name (e.g. "INITIATE"). null when
   *  identitySyncing is true. */
  identityRank: string | null;
  /** True when the registry has not yet recorded the wallet. The modal
   *  shows "Syncing identity..." instead of a fake score. */
  identitySyncing: boolean;
  /** Training level (0 if no training yet). */
  trainingLevel: number;
  /** Wallet address — for the share URL and short-address label. */
  wallet?: Address;
  onClose: () => void;
  /** Optional analytics callbacks. */
  onDownloaded?: () => void;
  onShared?: () => void;
}

const RARITY_NAMES = ["INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT"] as const;
const APP_URL = "https://ritual-arenav0.vercel.app";

function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}

function isValidTokenId(tokenId: unknown): tokenId is number {
  return typeof tokenId === "number" && Number.isFinite(tokenId) && tokenId > 0;
}

export function ForgeSuccessModal({
  open,
  card,
  power,
  rarity,
  identityScore,
  identityRank,
  identitySyncing,
  trainingLevel,
  wallet,
  onClose,
  onDownloaded,
  onShared,
}: ForgeSuccessModalProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDownloading(false);
      setDownloadError(null);
    }
  }, [open]);

  // Show a short loading state until the real tokenId is available.
  // Without a tokenId, the card renderer falls back to "PREVIEW" and the
  // success card displays "#preview" / "#undefined", which is wrong.
  const hasMintedCard =
    open &&
    card != null &&
    isValidTokenId(card.tokenId);

  if (!open || !card) return null;

  if (!hasMintedCard) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="forge-success-title"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 font-mono"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="bevel-out relative w-full max-w-md bg-wgray p-[3px]">
          <div className="title-grad flex items-center justify-between gap-2 px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
            <span className="flex items-center gap-1.5">
              <Sparkles size={12} /> Identity Card forged
            </span>
            <button
              onClick={onClose}
              className="win-btn !py-0 !text-[10px]"
              aria-label="Close"
              title="Close"
            >
              <X size={11} />
            </button>
          </div>
          <div className="bevel-in bg-coal p-6 text-center font-mono text-[11px] text-iceaccent/75">
            <p className="animate-pulse">Rendering forged card…</p>
            <p className="mt-2 text-[10px] text-iceaccent/45">
              Waiting for the on-chain tokenId to be confirmed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const grade = RARITY_NAMES[Math.max(0, Math.min(4, rarity | 0))] ?? "INITIATE";
  const powerDisplay = Math.max(1, power | 0);
  const tokenId = card.tokenId; // narrowed by hasMintedCard

  // Construct a full Anthem for the canvas renderer. Real values come from
  // the on-chain anthem (passed in via `card` after forge); missing fields
  // fall back to neutral defaults so the PNG is always renderable.
  const fullAnthem = {
    xHandle: card.xHandle,
    mood: card.mood,
    lyrics: card.lyrics,
    prompt: card.prompt,
    audioURI: card.audioURI || "",
    score: card.score ?? 0,
    genre: card.genre ?? "unknown",
    archetype: card.archetype ?? "Ritual Minter",
    colorWord: "luminous",
    bpm: card.bpm ?? 90,
    musicKey: card.musicKey ?? "C",
    gradient: card.gradient ?? (["#7fe3d2", "#48a89a", "#063a33"] as [string, string, string]),
    accent: card.accent ?? "#9ff0e0",
    seed: 0,
    rarity: grade as "INITIATE" | "BITTY" | "RITTY" | "RITUALIST" | "RADIANT",
    cardArchetype: "DREAMER",
    cardTraits: [],
    mintId: "RA-00-0000",
  };

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const dataUrl = await renderAnthemCardDataUrl(fullAnthem, {
        tokenId,
        currentPower: powerDisplay,
        currentRarity: rarity,
        trainingLevel,
      });
      const handle = card.xHandle?.replace(/[^a-zA-Z0-9_-]/g, "") || "card";
      const fileName = `ritual-arena-${handle}-#${tokenId}.png`;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      onDownloaded?.();
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  // Share on X uses the canonical `buildShareText` from src/lib/anthem.ts so
  // the tweet copy is consistent with the rest of the app. Source data is
  // the finalized forgeSuccess card (NOT forgePreview).
  const tweetText = buildShareText({
    tokenId,
    xHandle: card.xHandle,
    power: powerDisplay,
    grade,
    identityRank,
    identityScore,
    wallet: card.wallet ?? wallet,
    appUrl: APP_URL,
  });
  const tweetUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  const handleShareX = () => {
    onShared?.();
    // Open in a new tab — works on both desktop and mobile.
    const win = window.open(tweetUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      // Popup blocked — fall back to direct navigation.
      window.location.href = tweetUrl;
    }
  };

  // Build a GalleryItem-shaped object for AnthemCard preview. We set
  // `preview: false` explicitly so AnthemCard NEVER falls back to its
  // preview placeholder — we know we have a real tokenId by this point
  // (the `hasMintedCard` guard above already enforced that).
  //
  // CRITICAL: `previewItem` MUST be a complete Anthem-shaped object.
  // `renderAnthemCardDataUrl` reads `anthem.gradient`, `anthem.accent`,
  // `anthem.seed`, `anthem.rarity`, `anthem.cardArchetype`, `anthem.mood`,
  // `anthem.mintId`, etc. — if any of these is undefined, the canvas
  // renderer either throws ("card power unavailable") or paints a
  // broken image. Spreading only `card` (ForgeSuccessCard, which is a
  // STRICT subset of Anthem missing seed/rarity/gradient/accent/...)
  // caused the card preview to render as a blank card.
  //
  // The fix: build previewItem from the same `fullAnthem` that the
  // Download path already uses (it has all Anthem fields with sensible
  // defaults), then inject the real on-chain tokenId / wallet /
  // trainingLevel / preview=false on top.
  const previewItem: GalleryItem = {
    ...fullAnthem,
    wallet: card.wallet ?? wallet,
    tokenId,
    trainingLevel,
    preview: false as const,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forge-success-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 font-mono"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bevel-out relative w-full max-w-md bg-wgray p-[3px]">
        {/* Title bar */}
        <div className="title-grad flex items-center justify-between gap-2 px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          <span className="flex items-center gap-1.5">
            <Sparkles size={12} /> Identity Card forged
          </span>
          <button
            onClick={onClose}
            className="win-btn !py-0 !text-[10px]"
            aria-label="Close"
            title="Close"
          >
            <X size={11} />
          </button>
        </div>

        {/* Body */}
        <div className="bevel-in bg-coal p-3">
          <h2 id="forge-success-title" className="mb-2 text-center font-ui text-[13px] font-bold text-aqua">
            Your Identity Card is live on Ritual Chain
          </h2>

          {/* Card preview — same AnthemCard component used by the gallery
              and the Identity Profile, so the visual style is identical. */}
          <div className="flex justify-center">
            <AnthemCard
              item={previewItem}
              snapshot={{ currentPower: powerDisplay, currentRarity: rarity }}
            />
          </div>

          {/* Identity summary line — uses finalized on-chain values, NOT
              pre-forge preview values. When the registry has not yet
              recorded this wallet (post-forge push is async), we show
              "Syncing identity..." rather than a fake 0 / INITIATE. */}
          <p className="mt-3 text-center text-[10px] text-iceaccent/70">
            #{tokenId} · @{card.xHandle || "anon"} · {shortAddr(card.wallet ?? wallet)}<br />
            Power {powerDisplay} · Grade {grade} ·{" "}
            {identitySyncing
              ? <span className="text-[#ffd76a]">Syncing identity…</span>
              : <>Rank {identityRank} · Score {identityScore}</>}
          </p>

          {/* Action buttons — directly below the card preview */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="win-btn flex items-center justify-center gap-1.5 !text-[11px]"
              data-testid="forge-download"
            >
              <Download size={12} /> {downloading ? "Saving…" : "Download Card"}
            </button>
            <button
              type="button"
              onClick={handleShareX}
              className="win-btn flex items-center justify-center gap-1.5 !text-[11px]"
              data-testid="forge-share-x"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Share on X
            </button>
          </div>

          {/* Helper text */}
          <p className="mt-2 text-center text-[9px] text-iceaccent/45">
            Download your card and attach it to your post on X.
          </p>

          {downloadError ? (
            <p className="mt-2 text-center text-[10px] text-[#ff6a6a]">{downloadError}</p>
          ) : null}

          {/* Continue button */}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="win-btn !text-[10px]"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
