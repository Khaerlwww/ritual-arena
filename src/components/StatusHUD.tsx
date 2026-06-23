// src/components/StatusHUD.tsx
// Bottom bar showing wallet, chain, and (canonical) Identity Score.
// The Identity Score is read from `useIdentityRegistry` — the same source
// the Profile, Leaderboard, and api/metadata read. No more arenaScore
// masquerading as Identity Score.

import { Wallet, Sparkles, type LucideIcon } from "lucide-react";
import { useIdentityRegistry } from "../hooks/useIdentityRegistry";
import { hasArenaContract } from "../lib/chains";
import type { Address } from "viem";

function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function HudItem({
  icon: Icon,
  tone,
  label,
  onClick,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono ${tone} ${onClick ? "cursor-pointer hover:underline" : ""}`}
      onClick={onClick}
    >
      <Icon size={11} className="opacity-80" />
      {label}
    </span>
  );
}

export function StatusHUD({ address, onNavigate }: { address?: Address; onNavigate?: (moduleId: string) => void }) {
  // Single source of truth: the registry. If the registry is reachable
  // AND canonical for this wallet, show the canonical Identity Score.
  // Otherwise show "—" — never a fake arenaScore fallback.
  const identity = useIdentityRegistry(address, {
    score: 0,
    rank: "INITIATE" as never,
    level: 0,
    totalXp: 0,
    nextRank: "INITIATE" as never,
    nextRankAt: 0,
    progressPct: 0,
    canonical: false,
    registryUpdatedAt: 0,
    registryVersion: 0,
    sources: [],
  });

  if (!address) return null;

  const chainOk = hasArenaContract;
  const identityLabel = identity.canonical
    ? identity.score.toLocaleString()
    : "—";

  return (
    <div className="h-8 border-t border-[#1a2e2b] bg-coal px-3 font-mono text-[11px] text-iceaccent/75">
      <div className="mx-auto flex h-full max-w-5xl items-center justify-center gap-3 overflow-hidden whitespace-nowrap">
        <HudItem
          icon={Wallet}
          tone="text-aqua"
          label={shortAddress(address)}
        />
        <span className="h-3 w-px bg-iceaccent/15" />
        <HudItem
          icon={Sparkles}
          tone={chainOk ? "text-[#1CC744]" : "text-[#E0C15A]"}
          label={chainOk ? "Ritual Chain" : "Wrong network"}
          onClick={() => onNavigate?.("sysinfo")}
        />
        <span className="h-3 w-px bg-iceaccent/15" />
        <HudItem
          icon={Sparkles}
          tone="text-ice"
          label={`Identity Score ${identityLabel}`}
          onClick={() => onNavigate?.("identity")}
        />
        {/* AP balance is shown in the top-right <APBadge/> — single source of truth. */}
      </div>
    </div>
  );
}
