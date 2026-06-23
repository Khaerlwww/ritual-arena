import {
  CheckCircle2,
  Network,
  RefreshCw,
  Wallet,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { publicClient } from "../hooks/useAnthem";
import { ritualTestnet } from "../lib/chains";

/** Workflow phase for the Identity Card forge pipeline. Retained for backward compat. */
export type AnthemWorkflow = "Ready" | "Forge Preview" | "Forging" | "Forged";

const NETWORK_FALLBACK = "ritual-testnet-1";
const BLOCK_POLL_MS = 12_000;

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-[#1CC744] shadow-[0_0_6px_#1CC744]",
  warn: "bg-[#ffd27a] shadow-[0_0_6px_#ffd27a99]",
  error: "bg-[#ff5a5a] shadow-[0_0_6px_#ff5a5a]",
};

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-[#9be8c3]",
  warn: "text-[#ffd27a]",
  error: "text-[#ff8a8a]",
};

function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function networkLabel(chainId?: number) {
  if (chainId === ritualTestnet.id) return ritualTestnet.name;
  if (chainId != null) return `Unknown (chainId ${chainId})`;
  return NETWORK_FALLBACK;
}

type Tone = "ok" | "warn" | "error";

function ActionChip({
  label,
  icon: Icon,
  onClick,
  busy,
}: {
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  busy?: boolean;
}) {
  const cls =
    "win-btn inline-flex items-center gap-1 !px-2 !py-[2px] !text-[10px] disabled:opacity-60";
  return (
    <button type="button" onClick={onClick} disabled={busy} className={cls}>
      {Icon ? <Icon size={11} /> : null}
      {label}
    </button>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  tone,
  detail,
  action,
  first,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: Tone;
  detail?: string;
  action?: ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 py-2 ${
        first ? "" : "border-t border-dashed border-[#1d3a35]"
      }`}
    >
      <Icon size={14} className="shrink-0 text-teal2/90" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-ui text-[10px] font-bold uppercase tracking-[0.18em] text-aqua">{label}</p>
        {detail ? <p className="truncate font-mono text-[10px] text-iceaccent/55">{detail}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
        <span className={`font-mono text-[11px] font-bold ${TONE_TEXT[tone]}`}>{value}</span>
      </div>
    </div>
  );
}

export function SystemInfo({
  address,
  chainId,
  isWrongNetwork,
  isConnecting,
  onConnect,
  onSwitchNetwork,
}: {
  address?: Address;
  chainId?: number;
  isWrongNetwork: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onSwitchNetwork: () => void;
}) {
  const connected = Boolean(address) && !isWrongNetwork;

  // ---- Live block height (polled from the Ritual network) ----
  const [block, setBlock] = useState<bigint>();
  const [blockOk, setBlockOk] = useState(true);
  const [pinging, setPinging] = useState(false);

  const readBlock = useCallback(async () => {
    setPinging(true);
    try {
      const n = await publicClient.getBlockNumber();
      setBlock(n);
      setBlockOk(true);
    } catch {
      setBlockOk(false);
    } finally {
      setPinging(false);
    }
  }, []);

  const readBlockRef = useRef(readBlock);
  readBlockRef.current = readBlock;
  useEffect(() => {
    void readBlockRef.current();
    const id = setInterval(() => void readBlockRef.current(), BLOCK_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const connectChip = (
    <ActionChip label={isConnecting ? "Connecting…" : "Connect Wallet"} icon={Wallet} onClick={onConnect} busy={isConnecting} />
  );

  // WALLET
  const wallet: { value: string; tone: Tone; detail?: string; action?: ReactNode } = address
    ? { value: "Connected", tone: "ok", detail: shortAddr(address) }
    : { value: "Not connected", tone: "warn", action: connectChip };

  // BLOCK HEIGHT
  const blockValue = !blockOk ? "--" : block != null ? `#${block.toLocaleString("en-US")}` : "…";
  const blockTone: Tone = !blockOk ? "warn" : pinging ? "warn" : "ok";

  // NETWORK
  const network: { value: string; tone: Tone } = !address
    ? { value: NETWORK_FALLBACK, tone: "warn" }
    : isWrongNetwork
      ? { value: networkLabel(chainId), tone: "error" }
      : { value: networkLabel(chainId), tone: "ok" };

  return (
    <div className="font-ui text-[12px]">
      <div className="bevel-in-thin bg-[#061512] px-3 py-1.5">
        <Row
          icon={Wallet}
          label="Connect Wallet"
          value={address ? "Connected" : "Disconnected"}
          tone={address ? "ok" : "warn"}
          first
        />
        <Row
          icon={Wallet}
          label="Wallet"
          value={address ? "Connected" : "Not connected"}
          tone={address ? "ok" : "warn"}
          detail={address ? shortAddr(address) : undefined}
          action={address ? undefined : connectChip}
        />
        <Row icon={Network} label="Block Height" value={blockValue} tone={blockTone} />
        <Row icon={Wifi} label="Network" value={network.value} tone={network.tone} />
      </div>

      <div className="mt-2 flex items-center gap-2 bevel-in-thin bg-coal px-2.5 py-1.5">
        <CheckCircle2 size={13} className={connected && blockOk ? "text-[#1CC744]" : "text-[#ffd27a]"} aria-hidden />
        <span className={`font-mono text-[11px] ${connected && blockOk ? "text-iceaccent/85" : "text-[#ffd27a]"}`}>
          {connected ? "Ritual Chain connected" : "Connect wallet and switch network"}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void readBlock()}
          className="win-btn inline-flex items-center gap-1 !px-2 !py-[2px] !text-[10px]"
        >
          <RefreshCw size={11} className={pinging ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
    </div>
  );
}
