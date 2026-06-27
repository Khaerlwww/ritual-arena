import { useMemo } from "react";
import { AnthemCard, type GalleryItem } from "./AnthemCard";
import { Sparkles } from "lucide-react";

function uniqueForgedCards(items: GalleryItem[], limit = 16) {
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

export function ForgedCardsMarquee({
  items,
  snapshotForItem,
  onOpenGallery,
}: {
  items: GalleryItem[];
  snapshotForItem: (item: GalleryItem) => { currentPower?: number; currentRarity?: number } | undefined;
  onOpenGallery: () => void;
}) {
  const cards = useMemo(() => uniqueForgedCards(items, 16), [items]);

  if (cards.length === 0) return null;

  // Duplicate enough cards to make the loop feel endless even while the on-chain
  // forged set is still small. The animation translates by exactly half of this
  // track, so the two halves must be identical.
  const baseLoop = cards.length >= 4 ? cards : Array.from({ length: Math.ceil(4 / cards.length) }, () => cards).flat();
  const marqueeCards = [...baseLoop, ...baseLoop];
  const animationClass = cards.length >= 2 ? "forged-marquee-track" : "";

  return (
    <section className="forged-marquee-section bevel-in-thin relative mt-5 overflow-hidden bg-[#061512]" aria-label="Auto-moving forged Identity Cards">
      <div className="forged-marquee-header relative z-[2] flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-display text-[11px] font-extrabold uppercase tracking-[0.22em] text-aqua">
            <Sparkles size={12} /> Top Forged Cards
          </p>
          <p className="font-mono text-[10px] text-iceaccent/55">live on-chain identity cards · auto moving</p>
        </div>
        <button type="button" onClick={onOpenGallery} className="win-btn !px-2 !py-1 text-[10px]">
          View all
        </button>
      </div>

      <div className="forged-marquee-viewport">
        <div className={`${animationClass} flex w-max gap-3 py-2`}>
          {marqueeCards.map((item, i) => (
            <div key={`forged-marquee-${item.wallet ?? item.tokenId ?? "card"}-${i}`} className="forged-marquee-card w-[150px] shrink-0">
              <AnthemCard item={item} snapshot={snapshotForItem(item)} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
