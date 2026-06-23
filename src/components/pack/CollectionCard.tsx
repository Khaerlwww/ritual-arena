// --------------------------------------------------------------------
// Collection Pack System v5 — Card Component
// --------------------------------------------------------------------
// Reuses the existing canvas renderer (cardImage.ts) by constructing an
// Anthem shape populated with the pack-pool data. The visual rendering
// pipeline (frame, foil, gradients, glow, particles) is unchanged — we
// only inject the seven fields the spec calls out:
//   avatarUrl, username, visualRarity, serial, power, traits, generation
//
// The wrapper around the canvas image mirrors AnthemCard's visual chrome
// (title bar / status bar) so the two card types read as a single family.

import { useEffect, useMemo, useRef, useState } from "react";
import { renderAnthemCardDataUrl } from "../../lib/cardImage";
import { packResultToAnthem } from "../../lib/packCardToAnthem";
import { RARITY_BADGE } from "../../lib/rarity";
import { RitualMark } from "../Logo";
import { WindowControls } from "../win2k";
import type { PackResultCard } from "../../types/packCard";

interface CollectionCardProps {
  card: PackResultCard;
  /** Optional badge to display in the title bar — e.g. "V10" to disambiguate
   *  the active contract from stranded V9 NFTs that have the same visual. */
  versionBadge?: string;
}

/**
 * Translate a PackResultCard into the Anthem shape consumed by the
 * existing canvas renderer. Only the seven "inject" fields are meaningful;
 * other Anthem fields get deterministic placeholders.
 */
export function CollectionCard({ card, versionBadge }: CollectionCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string>();
  const [timedOut, setTimedOut] = useState(false);
  const [visible, setVisible] = useState(false);
  const badge = RARITY_BADGE[card.visualRarity];

  const anthem = useMemo(() => packResultToAnthem(card), [card]);
  const renderKey = useMemo(
    () => [
      card.cardId,
      card.serialNumber,
      card.avatarUrl,
      card.visualRarity,
      card.power,
      card.traits.join("|"),
      card.generation,
    ].join(":"),
    [card],
  );

  // Reveal once near the viewport.
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

  // Render via the shared canvas renderer.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setTimedOut(false);
    const fallback = window.setTimeout(() => {
      if (!cancelled && !url) setTimedOut(true);
    }, 3500);
    void renderAnthemCardDataUrl(anthem, { tokenId: card.cardId })
      .then((u: string) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setTimedOut(true);
      })
      .finally(() => {
        window.clearTimeout(fallback);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, renderKey]);

  return (
    <article className="win-open bevel-out bg-wgray p-[2px]">
      
      <div className="title-grad flex items-center gap-1.5 px-1.5 py-[3px]">
        <RitualMark size={12} glow={false} />
        <span className="font-mono text-[10px] text-iceaccent/60">
          Collection Card
        </span>
        {versionBadge && (
          <span className="bg-[#1CC744]/15 border border-[#1CC744]/40 px-1 py-[1px] font-mono text-[9px] font-bold text-[#1CC744]">
            {versionBadge}
          </span>
        )}
        <span className="flex-1" />
        <span className="bg-black/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-iceaccent">
          #{card.cardId}
        </span>
        <WindowControls />
      </div>

      <div className="bevel-in bg-coal p-2">
        
        <div ref={ref} className="bevel-in-thin relative overflow-hidden bg-[#071512]">
          {url ? (
            <img
              src={url}
              alt={card.username ? `@${card.username} card` : `card #${card.cardId}`}
              className="block w-full"
            />
          ) : visible || timedOut ? (
            <div
              className="grid aspect-square w-full place-items-center p-3 text-center font-mono text-[10px] text-aqua/75"
              style={{
                background: `linear-gradient(135deg, ${anthem.gradient[0]}, ${anthem.gradient[2]})`,
              }}
            >
              <div>
                
                {card.username ? (
                  <p className="font-bold">@{card.username}</p>
                ) : (
                  <p className="font-bold text-aqua/60">[ unclaimed ]</p>
                )}
                <p>
                  #{card.cardId} · {card.power} Power
                </p>
                <p>{card.visualRarity}</p>
              </div>
            </div>
          ) : (
            <div className="grid aspect-square w-full place-items-center bg-[#061512] p-4 text-center font-mono text-[11px] text-aqua/65">
              loading...
            </div>
          )}
        </div>

        
        <div className="bevel-in-thin mt-2 bg-coal px-1.5 py-1 font-mono text-[10px] text-aqua">
          <div className="flex items-center justify-between">
            <span className="truncate text-aqua/70">
              {card.rarity} · {badge.tag}
            </span>
            <span className="text-aqua/60">S{card.generation}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[9px] text-iceaccent/60">
            <span>{card.serial}</span>
            <span>
              Power {card.power} · Traits {card.traits.length}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
