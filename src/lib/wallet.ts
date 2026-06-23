import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { ritualTestnet } from "./chains";

// Single shared wallet client — memoized at module level.
// All write hooks MUST use this client instead of creating their own.
// This ensures one connect prompt, one switch network prompt.

let _client: WalletClient | undefined;
let _address: Address | undefined;
let _chainId: number | undefined;
let _listeners: Array<() => void> = [];

function notify() {
  for (const l of _listeners) {
    try { l(); } catch {}
  }
}

export function getSharedWalletClient(): WalletClient | undefined {
  if (_client) return _client;
  const eth = typeof window !== "undefined" ? (window as any).ethereum : undefined;
  if (!eth) return undefined;
  _client = createWalletClient({ chain: ritualTestnet, transport: custom(eth) });
  // Subscribe to wallet events once
  if (eth.on) {
    eth.on("accountsChanged", (accs: string[]) => {
      _address = (accs?.[0] as Address) || undefined;
      notify();
    });
    eth.on("chainChanged", (cid: string) => {
      _chainId = typeof cid === "string" ? parseInt(cid, 16) : Number(cid);
      notify();
    });
  }
  return _client;
}

export function getSharedAddress(): Address | undefined {
  return _address;
}

export function setSharedAddress(addr: Address | undefined) {
  _address = addr;
  notify();
}

export function getSharedChainId(): number | undefined {
  return _chainId;
}

export function setSharedChainId(cid: number | undefined) {
  _chainId = cid;
  notify();
}

export function subscribeSharedWallet(fn: () => void): () => void {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter((l) => l !== fn);
  };
}

/**
 * Get the active account, requesting it from the wallet if not already known.
 * Use this in connect/switch flows. Do NOT call inside write transactions —
 * pass the shared address directly to writeContract instead.
 */
export async function ensureAccount(): Promise<Address> {
  if (_address) return _address;
  const client = getSharedWalletClient();
  if (!client) throw new Error("Wallet extension not found. Install MetaMask or Rabby.");
  const accounts = await client.requestAddresses();
  const acc = accounts?.[0];
  if (!acc || !acc.startsWith("0x")) throw new Error("Wallet did not return a valid address.");
  _address = acc as Address;
  notify();
  return _address;
}

/**
 * Resolve the already-connected account for write flows without opening a
 * wallet account prompt. Connect buttons are the only place that should request
 * accounts; transaction buttons should produce exactly one tx prompt.
 */
export async function getConnectedAccountForWrite(): Promise<Address> {
  if (_address) return _address;
  const eth = typeof window !== "undefined" ? (window as any).ethereum : undefined;
  if (!eth) throw new Error("Wallet extension not found. Install MetaMask or Rabby.");
  const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
  const acc = accounts?.[0];
  if (!acc || !acc.startsWith("0x")) {
    throw new Error("Connect wallet before starting this transaction.");
  }
  _address = acc as Address;
  notify();
  return _address;
}

export async function ensureReadyForWrite(): Promise<Address> {
  const account = await getConnectedAccountForWrite();
  const ready = await ensureRitualChain();
  if (!ready) throw new Error("Please switch to Ritual Chain in your wallet.");
  return account;
}

/**
 * Ensure the connected chain is Ritual Chain.
 * If on wrong chain, prompt the wallet to switch (one prompt only).
 * Returns true if ready to write, false if user rejected.
 */
export async function ensureRitualChain(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("Wallet extension not found.");
  const cid = await eth.request({ method: "eth_chainId" });
  const current = typeof cid === "string" ? parseInt(cid, 16) : Number(cid);
  _chainId = current;
  if (current === ritualTestnet.id) return true;
  const hexId = "0x" + ritualTestnet.id.toString(16);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    // Re-read after switch
    const cid2 = await eth.request({ method: "eth_chainId" });
    _chainId = typeof cid2 === "string" ? parseInt(cid2, 16) : Number(cid2);
    notify();
    return _chainId === ritualTestnet.id;
  } catch (err: any) {
    // 4902 = chain not added, try wallet_addEthereumChain
    if (err?.code === 4902) {
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: hexId,
            chainName: ritualTestnet.name,
            nativeCurrency: ritualTestnet.nativeCurrency,
            rpcUrls: ritualTestnet.rpcUrls.default.http,
            blockExplorerUrls: [ritualTestnet.blockExplorers?.default?.url].filter(Boolean),
          }],
        });
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
        const cid3 = await eth.request({ method: "eth_chainId" });
        _chainId = typeof cid3 === "string" ? parseInt(cid3, 16) : Number(cid3);
        notify();
        return _chainId === ritualTestnet.id;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/**
 * Reset the shared wallet state. Called on disconnect or hard error.
 */
export function resetSharedWallet() {
  _address = undefined;
  _chainId = undefined;
  notify();
}
