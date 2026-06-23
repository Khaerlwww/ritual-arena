// src/components/APBadge.tsx
// Single source of truth for the wallet's AP balance display.
// Reads on-chain RitualAP.balanceOf(connectedWallet) via useAPBalance.
// No localStorage. No off-chain fallback.
//
// Shows "AP —" when:
//   - no wallet connected
//   - VITE_RITUAL_AP_ADDRESS not configured
// Shows "AP <number>" when balance is available.
// Auto-refreshes on inbound AP Transfer events (mints, receives).
// Refresh can also be triggered explicitly via .refetch().

import { useAPBalance } from "../hooks/useAPBalance";
import { Sparkles } from "lucide-react";
import type { Address } from "viem";

export function APBadge({ address }: { address?: Address }) {
  const ap = useAPBalance(address);

  if (!address) {
    return (
      <span
        className="bevel-out inline-flex items-center gap-1 bg-wgray px-2 py-[3px] font-ui text-[11px] font-bold text-coal/60"
        title="AP — wallet not connected"
      >
        <Sparkles size={11} className="text-iceaccent/50" />
        <span className="font-mono">AP —</span>
      </span>
    );
  }

  const configured = ap.state?.source === "onchain";
  const display = configured
    ? ap.state!.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : "—";
  const title = configured
    ? `AP balance from RitualAP contract (${ap.state!.decimals} decimals, cap ${ap.state!.cap.toLocaleString()})`
    : "AP contract not deployed (chains.ts apAddress missing)";

  return (
    <span
      className="bevel-out inline-flex items-center gap-1 bg-wgray px-2 py-[3px] font-ui text-[11px] font-bold text-coal hover:bg-[#cdcdcd] cursor-default"
      title={title}
    >
      <Sparkles size={11} className="text-teal2" />
      <span className="font-mono">AP {display}</span>
    </span>
  );
}
