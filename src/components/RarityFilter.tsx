// src/components/RarityFilter.tsx
// CLI-style rarity/grade filter for Identity Cards.
// Updated: 2026-06-10T12:50:00Z

const RARITIES = ["ALL", "INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT"] as const;
export type RarityFilter = (typeof RARITIES)[number];

export function RarityFilter({
  value,
  onChange,
  label = "grade",
}: {
  value: RarityFilter;
  onChange: (r: RarityFilter) => void;
  label?: string;
}) {
  return (
    <div className="bevel-in bg-coal p-2 font-mono">
      <p className="mb-1 text-[9px] uppercase tracking-[0.2em] text-aqua/60">
        Filter {label}:
      </p>
      <div className="flex flex-wrap gap-1">
        {RARITIES.map((r) => {
          const active = value === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => onChange(r)}
              className={`bevel-in-thin px-2 py-0.5 text-[10px] ${
                active
                  ? "bg-[#06231d] text-aqua shadow-[0_0_8px_rgba(28,199,68,0.25)]"
                  : "bg-[#0b0b0b] text-iceaccent/50 hover:text-iceaccent/80"
              }`}
            >
              {r}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function matchesRarity(
  itemRarity: string | number | undefined,
  filter: RarityFilter
): boolean {
  if (filter === "ALL") return true;
  if (itemRarity === undefined || itemRarity === null) return false;
  const r = typeof itemRarity === "number"
    ? (["INITIATE", "BITTY", "RITTY", "RITUALIST", "RADIANT"][itemRarity] || "INITIATE")
    : String(itemRarity).toUpperCase();
  return r === filter;
}
