import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Anthem } from "../lib/anthem";
import { renderAnthemCardDataUrl } from "../lib/cardImage";
import { explorerAddressUrl } from "../lib/chains";
import { RARITY_BADGE } from "../lib/rarity";
import { RitualMark } from "./Logo";
import { WindowControls } from "./win2k";
import { VisualEvolutionEffects } from "./card/VisualEvolutionEffects";

export type GalleryItem = Anthem & {
  tokenId?: number;
  wallet?: string;
  preview?: boolean;
  /** Card training level — drives Visual Evolution unlocks. */
  trainingLevel?: number;
  /**
   * Override for the portrait image URL. Forwarded to the canvas renderer
   * so non-X sources (Discord CDN, etc.) can be displayed. Falls back to
   * the Anthem.xHandle unavatar lookup when not set.
   */
  portraitUrl?: string;
};

function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

/**
 * A minted/preview anthem rendered with the exact same holographic card
 * template as the live preview (via the shared canvas renderer). The card
 * image is rendered lazily once it scrolls near the viewport so the gallery
 * stays snappy even with many mints.
 */
export function AnthemCard({ item, snapshot }: { item: GalleryItem; snapshot?: { currentPower?: number; currentRarity?: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string>();
  const [timedOut, setTimedOut] = useState(false);
  const [visible, setVisible] = useState(false);
  const validSnapshotPower = snapshot?.currentPower !== undefined && snapshot.currentPower > 0;
  const requiresSnapshot = !item.preview && Boolean(item.tokenId);
  const canRenderPower = item.preview || !requiresSnapshot || validSnapshotPower;
  const badge = RARITY_BADGE[item.rarity];
  const renderKey = useMemo(
    () => [
      item.tokenId ?? "preview",
      item.xHandle || "anon",
      item.wallet || "",
      item.seed || 0,
      item.score || 0,
      item.rarity,
      item.portraitUrl || "",
      snapshot?.currentPower || 0,
      snapshot?.currentRarity || 0,
    ].join(":"),
    [item.tokenId, item.xHandle, item.wallet, item.seed, item.score, item.rarity, item.portraitUrl, snapshot?.currentPower, snapshot?.currentRarity],
  );

  // Reveal (start rendering) when the card is near the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Render the holographic card to a data URL once visible.
  useEffect(() => {
    if (!visible || !canRenderPower) return;
    let cancelled = false;
    setTimedOut(false);
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled && !url) setTimedOut(true);
    }, 3000);
    if (!item.seed && !item.wallet) {
      window.clearTimeout(fallbackTimer);
      return;
    }
    void renderAnthemCardDataUrl(item, {
      tokenId: item.tokenId,
      currentPower: snapshot?.currentPower,
      currentRarity: snapshot?.currentRarity,
      trainingLevel: item.trainingLevel,
    })
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setTimedOut(true);
      })
      .finally(() => {
        window.clearTimeout(fallbackTimer);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, canRenderPower, renderKey]);

  return (
    <VisualEvolutionEffects
      trainingLevel={item.trainingLevel}
      compact
      className="win-open bevel-out bg-wgray p-[2px]"
    >
      <article>
      {/* title bar */}
      <div className="title-grad flex items-center gap-1.5 px-1.5 py-[3px]">
        <RitualMark size={12} glow={false} />
        <span className="font-mono text-[10px] text-iceaccent/60">
          Identity Card
        </span>
        <span className="flex-1" />
        <span className="bg-black/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-iceaccent">
          {item.preview ? "PREVIEW" : `#${item.tokenId}`}
        </span>
        <WindowControls />
      </div>

      <div className="bevel-in bg-coal p-2">
        {/* Holographic card image - same template as the live preview */}
        <div ref={ref} className="bevel-in-thin relative overflow-hidden bg-[#071512]">
          {url ? (
            <img src={url} alt={`@${item.xHandle || "anon"} card`} className="block w-full" />
          ) : canRenderPower || timedOut ? (
            <div
              className="grid aspect-square w-full place-items-center p-3 text-center font-mono text-[10px] text-aqua/75"
              style={{
                background: `linear-gradient(135deg, ${item.gradient?.[0] ?? "#071512"}, ${item.gradient?.[2] ?? "#063a33"})`,
              }}
            >
              <div>
                <p className="font-handle font-bold">@{item.xHandle || "anon"}</p>
                <p>#{item.tokenId ?? "preview"} · {snapshot?.currentPower || item.score || 1} Power</p>
                <p>{snapshot?.currentRarity !== undefined ? item.rarity : item.rarity}</p>
              </div>
            </div>
          ) : (
            <div className="grid aspect-square w-full place-items-center bg-[#061512] p-4 text-center font-mono text-[11px] text-aqua/65">
              {visible ? "card power unavailable" : "loading..."}
            </div>
          )}
        </div>

        {/* status bar */}
        <div className="bevel-in-thin mt-2 flex items-center justify-between bg-coal px-1.5 py-1 font-mono text-[10px] text-aqua">
          {item.wallet && !item.preview ? (
            <a
              href={explorerAddressUrl(item.wallet)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-iceaccent hover:underline"
            >
              {shortAddr(item.wallet)} <ExternalLink size={10} />
            </a>
          ) : (
            <span className="truncate text-aqua/70">
              {item.rarity} · {badge.tag}
            </span>
          )}
          {item.preview ? null : (
            <span className="inline-flex items-center gap-1 text-aqua/50">
              <span className="inline-block h-1.5 w-1.5 bg-[#1CC744]" /> forged
            </span>
          )}
        </div>
      </div>
      </article>
    </VisualEvolutionEffects>
  );
}
