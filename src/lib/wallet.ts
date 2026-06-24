import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { ritualTestnet } from "./chains";

// Single shared wallet controller.
// Important: do NOT blindly use window.ethereum for every tx. In browsers with
// multiple injected wallets (MetaMask + Rabby + OKX + Coinbase), window.ethereum
// can be a broker/default provider and may reopen the wallet selector before
// every tx. We resolve and persist one selected provider, then all writes use it.

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (event: string, listener: (...args: any[]) => void) => void;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: Eip1193Provider[];
};

type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon?: string;
  rdns: string;
};

type Eip6963ProviderDetail = {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
};

type WalletProviderEntry = Eip6963ProviderDetail & {
  source: "eip6963" | "legacy";
};

const SELECTED_WALLET_KEY = "ritual:wallet:selected-rdns";

let _client: WalletClient | undefined;
let _provider: Eip1193Provider | undefined;
let _providerKey: string | undefined;
let _subscribedProvider: Eip1193Provider | undefined;
let _address: Address | undefined;
let _chainId: number | undefined;
let _listeners: Array<() => void> = [];
let _providers: WalletProviderEntry[] = [];
let _discoveryStarted = false;

function notify() {
  for (const l of _listeners) {
    try { l(); } catch {}
  }
}

function providerKey(entry: WalletProviderEntry): string {
  return entry.info.rdns || entry.info.uuid || entry.info.name;
}

function readSelectedWalletKey(): string | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(SELECTED_WALLET_KEY) || undefined : undefined;
  } catch {
    return undefined;
  }
}

function persistSelectedWalletKey(key: string | undefined) {
  try {
    if (typeof localStorage === "undefined") return;
    if (key) localStorage.setItem(SELECTED_WALLET_KEY, key);
    else localStorage.removeItem(SELECTED_WALLET_KEY);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function upsertProvider(detail: Eip6963ProviderDetail, source: WalletProviderEntry["source"] = "eip6963") {
  const key = detail.info.rdns || detail.info.uuid || detail.info.name;
  const existing = _providers.findIndex((p) => providerKey(p) === key);
  const entry: WalletProviderEntry = { ...detail, source };
  if (existing >= 0) _providers[existing] = entry;
  else _providers.push(entry);
}

function getLegacyProviderEntry(): WalletProviderEntry | undefined {
  const eth = typeof window !== "undefined" ? (window as any).ethereum as Eip1193Provider | undefined : undefined;
  if (!eth) return undefined;
  const name = eth.isRabby ? "Rabby" : eth.isCoinbaseWallet ? "Coinbase Wallet" : eth.isMetaMask ? "MetaMask" : "Injected Wallet";
  const rdns = eth.isRabby ? "io.rabby" : eth.isCoinbaseWallet ? "com.coinbase.wallet" : eth.isMetaMask ? "io.metamask" : "injected";
  return {
    source: "legacy",
    info: { uuid: rdns, name, rdns },
    provider: eth,
  };
}

export function discoverInjectedWallets(): WalletProviderEntry[] {
  if (typeof window === "undefined") return _providers;

  if (!_discoveryStarted) {
    _discoveryStarted = true;
    window.addEventListener("eip6963:announceProvider" as any, ((event: CustomEvent<Eip6963ProviderDetail>) => {
      if (event?.detail?.provider && event.detail.info) {
        upsertProvider(event.detail, "eip6963");
      }
    }) as EventListener);
  }

  // Ask EIP-6963 wallets to announce themselves. Safe to call repeatedly.
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // Fallback for older injected wallets and non-standard provider arrays.
  const eth = (window as any).ethereum as Eip1193Provider | undefined;
  if (eth?.providers?.length) {
    for (const provider of eth.providers) {
      const name = provider.isRabby ? "Rabby" : provider.isCoinbaseWallet ? "Coinbase Wallet" : provider.isMetaMask ? "MetaMask" : "Injected Wallet";
      const rdns = provider.isRabby ? "io.rabby" : provider.isCoinbaseWallet ? "com.coinbase.wallet" : provider.isMetaMask ? "io.metamask" : `injected:${_providers.length}`;
      upsertProvider({ info: { uuid: rdns, name, rdns }, provider }, "legacy");
    }
  } else {
    const legacy = getLegacyProviderEntry();
    if (legacy) upsertProvider(legacy, "legacy");
  }

  return _providers;
}

export function getAvailableWallets(): Array<{ key: string; name: string; rdns: string; source: string }> {
  return discoverInjectedWallets().map((entry) => ({
    key: providerKey(entry),
    name: entry.info.name,
    rdns: entry.info.rdns,
    source: entry.source,
  }));
}

export function getSelectedWalletProvider(): Eip1193Provider | undefined {
  if (_provider) return _provider;

  const providers = discoverInjectedWallets();
  const selected = readSelectedWalletKey();

  const entry =
    (selected ? providers.find((p) => providerKey(p) === selected || p.info.rdns === selected) : undefined) ||
    providers[0] ||
    getLegacyProviderEntry();

  if (!entry) return undefined;
  _provider = entry.provider;
  _providerKey = providerKey(entry);
  subscribeProviderEvents(_provider);
  return _provider;
}

export function setSelectedWalletProvider(key?: string): Eip1193Provider | undefined {
  const providers = discoverInjectedWallets();
  const entry = key ? providers.find((p) => providerKey(p) === key || p.info.rdns === key) : providers[0];
  if (!entry) return getSelectedWalletProvider();

  _provider = entry.provider;
  _providerKey = providerKey(entry);
  _client = undefined;
  persistSelectedWalletKey(_providerKey);
  subscribeProviderEvents(_provider);
  notify();
  return _provider;
}

async function rememberProviderIfAccountMatches(account: Address) {
  const providers = discoverInjectedWallets();
  for (const entry of providers) {
    try {
      const accounts = (await entry.provider.request({ method: "eth_accounts" })) as string[];
      if (accounts?.some((acc) => acc?.toLowerCase() === account.toLowerCase())) {
        _provider = entry.provider;
        _providerKey = providerKey(entry);
        _client = undefined;
        persistSelectedWalletKey(_providerKey);
        subscribeProviderEvents(_provider);
        return;
      }
    } catch {
      /* locked / unavailable provider — ignore */
    }
  }
}

function subscribeProviderEvents(provider: Eip1193Provider | undefined) {
  if (!provider || _subscribedProvider === provider || !provider.on) return;

  const onAccountsChanged = (accs: string[]) => {
    _address = (accs?.[0] as Address) || undefined;
    if (_address) void rememberProviderIfAccountMatches(_address);
    notify();
  };
  const onChainChanged = (cid: string) => {
    _chainId = typeof cid === "string" ? parseInt(cid, 16) : Number(cid);
    notify();
  };

  provider.on("accountsChanged", onAccountsChanged);
  provider.on("chainChanged", onChainChanged);
  _subscribedProvider = provider;
}

export function getSharedWalletClient(): WalletClient | undefined {
  if (_client) return _client;
  const eth = getSelectedWalletProvider();
  if (!eth) return undefined;
  _client = createWalletClient({ chain: ritualTestnet, transport: custom(eth as any) });
  return _client;
}

export function getSharedAddress(): Address | undefined {
  return _address;
}

export function setSharedAddress(addr: Address | undefined) {
  _address = addr;
  if (addr) void rememberProviderIfAccountMatches(addr);
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
 * Get the active account, requesting it from the selected wallet if not already
 * known. Use this only for connect flows. Transaction buttons should use
 * getConnectedAccountForWrite()/ensureReadyForWrite() to avoid account prompts.
 */
export async function ensureAccount(): Promise<Address> {
  if (_address) return _address;
  const client = getSharedWalletClient();
  if (!client) throw new Error("Wallet extension not found. Install MetaMask or Rabby.");
  const accounts = await client.requestAddresses();
  const acc = accounts?.[0];
  if (!acc || !acc.startsWith("0x")) throw new Error("Wallet did not return a valid address.");
  _address = acc as Address;
  await rememberProviderIfAccountMatches(_address);
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
  const eth = getSelectedWalletProvider();
  if (!eth) throw new Error("Wallet extension not found. Install MetaMask or Rabby.");
  const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
  const acc = accounts?.[0];
  if (!acc || !acc.startsWith("0x")) {
    throw new Error("Connect wallet before starting this transaction.");
  }
  _address = acc as Address;
  await rememberProviderIfAccountMatches(_address);
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
 * Ensure the selected wallet is on Ritual Chain.
 * If on wrong chain, prompt the wallet to switch (one prompt only).
 * Returns true if ready to write, false if user rejected.
 */
export async function ensureRitualChain(): Promise<boolean> {
  const eth = getSelectedWalletProvider();
  if (!eth) throw new Error("Wallet extension not found.");
  const cid = await eth.request({ method: "eth_chainId" });
  const current = typeof cid === "string" ? parseInt(cid, 16) : Number(cid);
  _chainId = current;
  if (current === ritualTestnet.id) return true;
  const hexId = "0x" + ritualTestnet.id.toString(16);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    const cid2 = await eth.request({ method: "eth_chainId" });
    _chainId = typeof cid2 === "string" ? parseInt(cid2, 16) : Number(cid2);
    notify();
    return _chainId === ritualTestnet.id;
  } catch (err: any) {
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
 * Reset wallet state. Keeps the selected wallet provider so reconnect/tx flows
 * keep using the same extension instead of reopening the multi-wallet selector.
 */
export function resetSharedWallet() {
  _address = undefined;
  _chainId = undefined;
  _client = undefined;
  notify();
}
