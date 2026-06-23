import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, formatEther, isAddress, parseAbiItem, type Address } from "viem";
import { identityCardAbi } from "../abi/identityCard";
import { anthemAddress, hasAnthemContract, identityCardAddress, ritualTestnet, transport, zeroAddress as chainZeroAddress } from "../lib/chains";
import { POWER_MODEL_VERSION } from "../lib/powerEngine";
import { RITUAL_GAS } from "../lib/gasDefaults";
import { shortTxError } from "../lib/shortTxError";
import {
  getConnectedAccountForWrite,
  getSharedWalletClient,
  ensureReadyForWrite,
  ensureRitualChain,
  setSharedAddress,
  setSharedChainId,
} from "../lib/wallet";
import type { EvolutionInput } from "../lib/powerEngine";
import { emit } from "../lib/eventBus";

export { anthemAddress, hasAnthemContract } from "../lib/chains";

export const zeroAddress = chainZeroAddress;
export const defaultAnthemAddress = zeroAddress;

export const publicClient = createPublicClient({
  chain: ritualTestnet,
  transport,
});

export async function fetchAnthemEvolutionInput(wallet: Address): Promise<EvolutionInput> {
  // Read on-chain CardSnapshot for current evolved power
  try {
    const snap = await publicClient.readContract({
      address: anthemAddress, abi: identityCardAbi,
      functionName: "getCardSnapshot", args: [wallet],
    }) as { currentPower: number; currentRarity: number };
    return {
      totalXp: 0, // Will be filled by Training contract
      wins: 0,
      longestStreak: 0,
      currentPower: Number(snap.currentPower),
    };
  } catch {
    return { totalXp: 0, wins: 0, longestStreak: 0, currentPower: 1 };
  }
}

export type Anthem = {
  tokenId: bigint;
  wallet: Address;
  xHandle: string;
  mood: string;
  lyrics: string;
  musicPrompt: string;
  audioURI: string;
  metadataURI: string;
  createdAt: bigint;
};

export type MintArgs = {
  xHandle: string;
  mood: string;
  lyrics: string;
  musicPrompt: string;
  audioURI: string;
  metadataURI: string;
  // Phase 6: attestation
  signature?: `0x${string}`;
  expiry?: bigint;
  nonce?: bigint;
};

export type Attestation = {
  signature: `0x${string}`;
  expiry: bigint;
  nonce: bigint;
};

export type CardSnapshot = {
  tokenId: bigint;
  initialPower: number;
  currentPower: number;
  initialRarity: number;
  currentRarity: number;
  initialSourceHash: `0x${string}`;
  currentSourceHash: `0x${string}`;
  forgedAt: bigint;
  lastRefreshed: bigint;
  snapshotVersion: number;
};

// Persisted across refreshes so an explicit disconnect is not auto-undone by eth_accounts.
const DISCONNECTED_KEY = "ritual-anthem:disconnected";

function getProvider() {
  return typeof window !== "undefined" ? (window as any).ethereum : undefined;
}

function isOptedOut() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(DISCONNECTED_KEY) === "1";
  } catch {
    return false;
  }
}

function setOptedOut(value: boolean) {
  try {
    if (typeof localStorage === "undefined") return;
    if (value) localStorage.setItem(DISCONNECTED_KEY, "1");
    else localStorage.removeItem(DISCONNECTED_KEY);
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

function parseChainId(raw: unknown): number | undefined {
  if (typeof raw === "string") return raw.startsWith("0x") ? parseInt(raw, 16) : Number(raw);
  if (typeof raw === "number") return raw;
  return undefined;
}

/** Compact native-balance label, e.g. "12.3456" or "0" (trailing zeros trimmed). */
export function formatBalance(wei?: bigint): string {
  if (wei === undefined) return "…";
  const full = formatEther(wei);
  const [whole, frac = ""] = full.split(".");
  const trimmed = frac.slice(0, 4).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function useInjectedWallet() {
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [error, setError] = useState<string>();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [balance, setBalance] = useState<bigint>();

  const refreshBalance = useCallback(async (who?: Address) => {
    const target = who ?? address;
    if (!target || !isAddress(target)) {
      setBalance(undefined);
      return;
    }
    try {
      // Always read the native RITUAL balance from the Ritual network, regardless of
      // the wallet's currently selected network.
      setBalance(await publicClient.getBalance({ address: target }));
    } catch {
      /* Network hiccup — keep the previous value */
    }
  }, [address]);

  // Keep the balance in sync with the connected account + poll periodically.
  useEffect(() => {
    if (!address) {
      setBalance(undefined);
      return;
    }
    void refreshBalance(address);
    const id = setInterval(() => void refreshBalance(address), 20_000);
    return () => clearInterval(id);
  }, [address, chainId, refreshBalance]);

  // Restore an existing connection + subscribe to wallet events.
  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;
    let active = true;

    (async () => {
      try {
        const cid = await provider.request({ method: "eth_chainId" });
        if (active) {
          const parsed = parseChainId(cid);
          setChainId(parsed);
          setSharedChainId(parsed);
        }
        // Honor an explicit disconnect: don't silently restore the session.
        if (isOptedOut()) return;
        const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
        if (active && accounts?.[0] && isAddress(accounts[0])) {
          setAddress(accounts[0]);
          setSharedAddress(accounts[0]);
        }
      } catch {
        /* wallet not ready / locked */
      }
    })();

    const onAccountsChanged = (accs: string[]) => {
      const next = accs?.[0];
      const parsed = next && isAddress(next) ? (next as Address) : undefined;
      setAddress(parsed);
      setSharedAddress(parsed);
    };
    const onChainChanged = (cid: string) => {
      const parsed = parseChainId(cid);
      setChainId(parsed);
      setSharedChainId(parsed);
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      setError("Wallet extension not found. Install MetaMask or Rabby, then refresh.");
      return undefined;
    }
    setIsConnecting(true);
    setError(undefined);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
      const next = accounts?.[0];
      if (!next || !isAddress(next)) throw new Error("Wallet did not return a valid address.");
      setAddress(next);
      setSharedAddress(next);
      setOptedOut(false);
      try {
        const parsed = parseChainId(await provider.request({ method: "eth_chainId" }));
        setChainId(parsed);
        setSharedChainId(parsed);
      } catch {
        /* ignore */
      }
      return next;
    } catch (err) {
      setError(shortTxError(err, "Wallet connect"));
      return undefined;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setAddress(undefined);
    setSharedAddress(undefined);
    setError(undefined);
    setOptedOut(true);
    // Best-effort: revoke the dApp permission in wallets that implement EIP-2255
    // (e.g. MetaMask). Wallets without support simply fall back to the local clear.
    const provider = getProvider();
    try {
      await provider?.request?.({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      /* unsupported method — local disconnect already applied */
    }
  }, []);

  const refetchWalletState = useCallback(async () => {
    const provider = getProvider();
    if (!provider) return;
    try {
      const [cid, accounts] = await Promise.all([
        provider.request({ method: "eth_chainId" }),
        provider.request({ method: "eth_accounts" }),
      ]);
      const parsedChainId = parseChainId(cid);
      const next = ((accounts as Address[])?.[0] && isAddress((accounts as Address[])[0]))
        ? (accounts as Address[])[0]
        : undefined;
      setChainId(parsedChainId);
      setSharedChainId(parsedChainId);
      setAddress(next);
      setSharedAddress(next);
      await refreshBalance(next);
    } catch {
      /* wallet temporarily unavailable */
    }
  }, [refreshBalance]);

  const switchToRitual = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      setError("Wallet extension not found.");
      return;
    }
    const hexId = "0x" + ritualTestnet.id.toString(16);
    setIsSwitching(true);
    setError(undefined);
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 4902 || code === -32603) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexId,
                chainName: ritualTestnet.name,
                nativeCurrency: ritualTestnet.nativeCurrency,
                rpcUrls: ritualTestnet.rpcUrls.default.http,
                blockExplorerUrls: [ritualTestnet.blockExplorers.default.url],
              },
            ],
          });
        } catch (addErr) {
          setError(shortTxError(addErr, "Add Ritual Chain"));
        }
      } else {
        setError(shortTxError(err, "Switch to Ritual Chain"));
      }
    } finally {
      await refetchWalletState();
      setIsSwitching(false);
    }
  }, [refetchWalletState]);

  const isWrongNetwork = Boolean(address) && chainId !== undefined && chainId !== ritualTestnet.id;

  return { address, chainId, isWrongNetwork, isSwitching, balance, refreshBalance, connect, disconnect, switchToRitual, error, isConnecting };
}

/** Onchain check: is this X handle already claimed by someone? */
export async function checkHandleTaken(xHandle: string): Promise<boolean> {
  const handle = xHandle?.trim();
  if (!handle || !hasAnthemContract) return false;
  try {
    return (await publicClient.readContract({
      address: anthemAddress,
      abi: identityCardAbi,
      functionName: "isHandleTaken",
      args: [handle],
    })) as boolean;
  } catch {
    return false; // old contract without the view — let the tx decide
  }
}

/** Read the next tokenId to be minted. */
export function useNextTokenId() {
  const [nextTokenId, setNextTokenId] = useState<number>();

  const refetch = useCallback(async () => {
    if (!hasAnthemContract) return undefined;
    try {
      const n = (await publicClient.readContract({
        address: anthemAddress,
        abi: identityCardAbi,
        functionName: "nextTokenId",
      })) as bigint;
      const num = Number(n);
      setNextTokenId(num);
      return num;
    } catch {
      return undefined; // old contract / network issue
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { nextTokenId, refetch };
}

/** Read the onchain mint fee (in wei) charged for a new anthem. */
export function useMintFee() {  const [fee, setFee] = useState<bigint>();
  const [recipient, setRecipient] = useState<Address>();

  useEffect(() => {
    if (!hasAnthemContract) return;
    let active = true;
    (async () => {
      try {
        const [feeRaw, recipientRaw] = await Promise.all([
          publicClient.readContract({ address: anthemAddress, abi: identityCardAbi, functionName: "mintFee" }),
          publicClient.readContract({ address: anthemAddress, abi: identityCardAbi, functionName: "feeRecipient" }),
        ]);
        if (!active) return;
        setFee(feeRaw as bigint);
        setRecipient(recipientRaw as Address);
      } catch {
        /* old contract without a fee, or network issue — treat as no fee */
        if (active) setFee(0n);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { fee, recipient, feeLabel: fee === undefined ? "…" : formatBalance(fee) };
}

export function useAnthemReads(wallet?: Address) {
  const [data, setData] = useState<Anthem>();
  const [hasMinted, setHasMinted] = useState<boolean>(false);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!wallet || !isAddress(wallet) || !hasAnthemContract) return undefined;
    setIsLoading(true);
    setError(undefined);
    try {
      // hasMinted(address) view — direct bool read of wallet state.
      // Independent of getAnthems() so it works even when the public RPC
      // is unreliable for large array reads.
      let minted = false;
      try {
        const flag = (await publicClient.readContract({
          address: anthemAddress,
          abi: identityCardAbi,
          functionName: "hasMinted",
          args: [wallet],
        })) as unknown as boolean;
        minted = Boolean(flag);
      } catch {
        minted = false;
      }
      setHasMinted(minted);
      if (!minted) {
        setData(undefined);
        return undefined;
      }
      // Wallet has minted — find their entry in getAnthems() (V4 signature, no args).
      const raw = (await publicClient.readContract({
        address: anthemAddress,
        abi: identityCardAbi,
        functionName: "getAnthems",
      })) as unknown as Array<{ tokenId: bigint; wallet: `0x${string}`; xHandle: string; mood: string; lyrics: string; musicPrompt: string; audioURI: string; metadataURI: string; createdAt: bigint; }>;
      const match = raw.find((x) => x && x.wallet && x.wallet.toLowerCase() === wallet.toLowerCase());
      if (!match) {
        // hasMinted says yes but array doesn't have it — RPC partial. Don't lie.
        setData(undefined);
        return undefined;
      }
      const anthem: Anthem = {
        tokenId: match.tokenId,
        wallet: match.wallet,
        xHandle: match.xHandle,
        mood: match.mood,
        lyrics: match.lyrics,
        musicPrompt: match.musicPrompt,
        audioURI: match.audioURI,
        metadataURI: match.metadataURI,
        createdAt: match.createdAt ?? 0n,
      };
      setData(anthem);
      return anthem;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read on-chain Anthem.");
      return undefined;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  return { data, hasMinted, refetch, error, isLoading };
}

export function useAnthemWrites() {
  const [isPending, setIsPending] = useState(false);
  const [txHash, setTxHash] = useState<string>();
  const walletClient = getSharedWalletClient();

  const ensureChain = useCallback(async () => {
    if (!walletClient) throw new Error("Wallet extension not found.");
    return ensureRitualChain();
  }, [walletClient]);

  const mintAnthem = useCallback(
    async (args: MintArgs, value?: bigint) => {
      if (!hasAnthemContract) {
        throw new Error("VITE_RITUAL_ANTHEM_ADDRESS is not configured. Deploy the contract to Ritual testnet first.");
      }
      if (!walletClient) throw new Error("Wallet extension not found.");

      // Phase 6: require attestation
      if (!args.signature || !args.expiry || !args.nonce) {
        throw new Error("Attestation required: request a signed attestation from the verifier before forging.");
      }

      setIsPending(true);
      setTxHash(undefined);
      try {
        const account = await ensureReadyForWrite();

        // Estimate gas first; fall back to a safe default if the chain's
        // eth_estimateGas is unreliable (Ritual Chain is new, MetaMask
        // often shows "Unavailable" for it). The fallback covers
        // mintAnthem + CardSnapshot mirror + IdentityRegistry update.
        const baseArgs = [
          args.xHandle, args.mood, args.lyrics, args.musicPrompt,
          args.audioURI, args.metadataURI,
          args.expiry as bigint, args.nonce as bigint, args.signature,
        ] as const;
        let gasEstimate: bigint;
        try {
          gasEstimate = await publicClient.estimateContractGas({
            account,
            address: anthemAddress,
            abi: identityCardAbi,
            functionName: "mintAnthem",
            args: baseArgs,
            value: value ?? 0n,
          });
        } catch {
          // Ritual Chain: eth_estimateGas is unreliable. Use 1.2M
          // (full mint + snapshot + registry mirror costs ~612k on testnet,
          // plus 100% buffer for cross-contract call overhead and future
          // V4 forge parameters).
          gasEstimate = 1_200_000n;
        }
        // 20% buffer so MetaMask doesn't reject the tx for OOG.
        const gasLimit = gasEstimate + gasEstimate / 5n;

        const hash = await walletClient.writeContract({
          account,
          chain: ritualTestnet,
          address: anthemAddress,
          abi: identityCardAbi,
          functionName: "mintAnthem",
          args: baseArgs,
          value: value ?? 0n,
          gas: gasLimit,
          // EIP-1559 defaults so MetaMask shows real numbers instead of
          // "Unavailable" (Ritual Chain has no MetaMask gas registry yet).
          maxFeePerGas: RITUAL_GAS.maxFeePerGas,
          maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
        });
        setTxHash(hash);

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") {
          // Try to fetch the revert reason. Ritual RPC often returns
          // "historical state may have been pruned" when it can't replay
          // the tx — fall back to a contract call simulation so the user
          // sees a meaningful error (e.g. "This wallet already forged its
          // card" instead of a generic revert blob).
          let reason = "Transaction reverted.";
          try {
            await publicClient.simulateContract({
              account,
              address: anthemAddress,
              abi: identityCardAbi,
              functionName: "mintAnthem",
              args: baseArgs,
              value: value ?? 0n,
            });
          } catch (simErr) {
            // Walk the cause chain to find the actual revert reason string.
            // viem wraps ContractFunctionExecutionError → ContractFunctionRevertedError →
            // ExecutionRevertedError → RpcRequestError. The "reason" lives
            // at varying depths; check all of them so users see a real
            // error instead of "reverted with the following reason:" (empty).
            const visited = new Set<unknown>();
            const findReason = (err: unknown): string => {
              if (!err || typeof err !== "object" || visited.has(err)) return "";
              visited.add(err);
              const e = err as Record<string, unknown>;
              if (typeof e.reason === "string" && e.reason.length > 0) return e.reason;
              if (typeof e.shortMessage === "string" && e.shortMessage.length > 0) {
                // viem shortMessage looks like:
                //   'The contract function "X" reverted with the following reason:\nREASON'
                // Strip the prefix when present so we keep just the reason.
                const m = e.shortMessage.match(/reverted with the following reason:\s*(.+)$/s);
                if (m && m[1]) return m[1].trim();
                return e.shortMessage;
              }
              if (e.cause) return findReason(e.cause);
              if (typeof e.message === "string" && e.message.length > 0) {
                const m = e.message.match(/reverted with the following reason:\s*(.+)$/s);
                if (m && m[1]) return m[1].trim();
                return e.message;
              }
              return "";
            };
            const r = findReason(simErr);
            if (r) reason = r;
          }
          throw new Error(reason);
        }
        // Cross-hook invalidation: anthem NFT minted, identity score pushed.
        emit({ type: 'nft-changed', reason: 'mint-anthem' });
        emit({ type: 'identity-changed', reason: 'mint-anthem' });
        emit({ type: 'tx-success', source: 'useAnthem', action: 'mintAnthem', hash: hash });
        return { hash, receipt };
      } finally {
        setIsPending(false);
      }
    },
    [walletClient],
  );

  const checkIn = useCallback(async () => {
    if (!hasAnthemContract) throw new Error("Contract not configured.");
    if (!walletClient) throw new Error("Wallet extension not found.");
    setIsPending(true);
    setTxHash(undefined);
    try {
      const account = await ensureReadyForWrite();
      const hash = await walletClient.writeContract({
        account,
        chain: ritualTestnet,
        address: anthemAddress,
        abi: identityCardAbi,
        functionName: "checkIn",
        args: [],
        maxFeePerGas: RITUAL_GAS.maxFeePerGas,
        maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
      });
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    } finally {
      setIsPending(false);
    }
  }, [walletClient]);

  const updateMetadata = useCallback(
    async (metadataURI: string, audioURI: string) => {
      if (!hasAnthemContract) throw new Error("Contract not configured.");
      if (!walletClient) throw new Error("Wallet extension not found.");
      setIsPending(true);
      setTxHash(undefined);
      try {
        const account = await ensureReadyForWrite();
        const hash = await walletClient.writeContract({
          account,
          chain: ritualTestnet,
          address: anthemAddress,
          abi: identityCardAbi,
          functionName: "updateMetadata",
          args: [metadataURI, audioURI],
          maxFeePerGas: RITUAL_GAS.maxFeePerGas,
          maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
        });
        setTxHash(hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        return { hash, receipt };
      } finally {
        setIsPending(false);
      }
    },
    [walletClient],
  );

  const dailyCheckIn = useCallback(async () => {
    if (!hasAnthemContract) throw new Error("Contract not configured.");
    if (!walletClient) throw new Error("Wallet extension not found.");
    setIsPending(true);
    setTxHash(undefined);
    try {
      const account = await ensureReadyForWrite();
      const hash = await walletClient.writeContract({
        account,
        chain: ritualTestnet,
        address: anthemAddress,
        abi: identityCardAbi,
        functionName: "dailyCheckIn",
        args: [],
        maxFeePerGas: RITUAL_GAS.maxFeePerGas,
        maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
      });
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    } finally {
      setIsPending(false);
    }
  }, [walletClient]);

  // ── Phase 6: attestation request ──
  // Calls backend API to get EIP-712 signature from authorized verifier.

  const requestAttestation = useCallback(
    async (
      type: "forge" | "refresh",
      params: { xHandle: string }
            | { tokenId: bigint; newPower: number; newRarity: number },
    ): Promise<Attestation> => {
      if (!walletClient) throw new Error("Wallet extension not found.");
      const account = await getConnectedAccountForWrite();

      const attestationUrl = import.meta.env.VITE_ATTESTATION_URL || "/api/forge";

      const nowMs = Date.now();
      const nonce = BigInt(nowMs);
      const expiry = BigInt(nowMs + 600000); // +10 minutes in ms
      // IMPORTANT: Ritual Chain block.timestamp is in milliseconds, not seconds.
      // All expiry/nonce values MUST be in milliseconds.
      // Use canonical sources so we don't depend on legacy env-var
      // names (VITE_RITUAL_ANTHEM_ADDRESS was a back-compat alias).
      const chainId = ritualTestnet.id;
      const contractAddress = identityCardAddress !== chainZeroAddress
        ? identityCardAddress
        : anthemAddress;

      let payload: Record<string, unknown>;

      if (type === "forge") {
        // Forge attestation: wallet, handle, chainId, contract, expiry, nonce
        // NO power/rarity — card always starts at Power 1 / INITIATE
        const p = params as { xHandle: string };
        payload = {
          type,
          wallet: account,
          xHandle: p.xHandle,
          chainId,
          contractAddress,
          expiry: expiry.toString(),
          nonce: nonce.toString(),
        };
      } else {
        // Refresh attestation: includes evolved power/rarity from CardSnapshot
        const p = params as { tokenId: bigint; newPower: number; newRarity: number };
        payload = {
          type,
          wallet: account,
          tokenId: Number(p.tokenId),
          newPower: p.newPower,
          newRarity: p.newRarity,
          chainId,
          contractAddress,
          expiry: expiry.toString(),
          nonce: nonce.toString(),
        };
      }

      let res: Response;
      try {
        res = await fetch(attestationUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        throw new Error("Forge verification service is not available. Try again later.");
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        // Re-throw backend error messages that are actionable
        if (errBody.error && (
          errBody.error.includes("signer is not configured") ||
          errBody.error.includes("attestation service is not configured") ||
          errBody.error.includes("not configured correctly")
        )) {
          throw new Error(errBody.error);
        }
        if (errBody.error) {
          throw new Error(errBody.error);
        }
        throw new Error("Forge verification service is not available. Try again later.");
      }

      const data = await res.json();
      return {
        signature: data.signature as `0x${string}`,
        expiry: BigInt(data.expiry),
        nonce: BigInt(data.nonce),
      };
    },
    [walletClient]
  );

  return { isPending, txHash, mintAnthem, checkIn, dailyCheckIn, ensureRitualChain, requestAttestation, hasWallet: Boolean(walletClient) };
}

export type OnchainStreak = {
  streakCount: number;
  lastCheckIn: number; // unix seconds (0 = never checked in)
  longestStreak: number;
  totalCheckIns: number;
};

/**
 * Read the wallet's on-chain streak + badge. Falls back gracefully (supported:false)
 * when the deployed contract predates the streak feature, so the UI can prompt to
 * deploy the updated contract instead of crashing.
 */
export function useStreak(wallet?: Address) {
  const [streak, setStreak] = useState<OnchainStreak>();
  const [badge, setBadge] = useState<number>(0);
  const [inWindow, setInWindow] = useState<boolean>(false);
  const [supported, setSupported] = useState<boolean>(true);

  const refetch = useCallback(async () => {
    if (!wallet || !isAddress(wallet) || !hasAnthemContract) return undefined;
    try {
      // rarityForPower(uint16) — pass the wallet's current power, or 1 if no card.
      // isCheckInWindow() — no args; reads msg.sender.
      const cur = (await publicClient.readContract({
        address: anthemAddress,
        abi: identityCardAbi,
        functionName: "getCurrentPower",
        args: [wallet],
      })) as unknown as bigint;
      const [s, b, w] = await Promise.all([
        publicClient.readContract({ address: anthemAddress, abi: identityCardAbi, functionName: "getStreakData", args: [wallet] }),
        publicClient.readContract({ address: anthemAddress, abi: identityCardAbi, functionName: "rarityForPower", args: [Number(cur === 0n ? 1n : cur)] as unknown as readonly [number] }),
        publicClient.readContract({ address: anthemAddress, abi: identityCardAbi, functionName: "isCheckInWindow", args: [wallet] }),
      ]);
      const t = s as unknown as { streakCount: bigint; lastCheckIn: bigint; longestStreak: bigint; totalCheckIns: bigint };
      const data: OnchainStreak = {
        streakCount: Number(t.streakCount),
        lastCheckIn: Number(t.lastCheckIn),
        longestStreak: Number(t.longestStreak),
        totalCheckIns: Number(t.totalCheckIns),
      };
      setStreak(data);
      setBadge(Number(b));
      setInWindow(Boolean(w));
      setSupported(true);
      return data;
    } catch {
      setSupported(false);
      setStreak({ streakCount: 0, lastCheckIn: 0, longestStreak: 0, totalCheckIns: 0 });
      return undefined;
    }
  }, [wallet]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { streak, badgeLevel: badge, inWindow, supported, refetch };
}


function normalize(a: Anthem): Anthem {
  return {
    tokenId: a.tokenId,
    wallet: a.wallet,
    xHandle: a.xHandle,
    mood: a.mood,
    lyrics: a.lyrics,
    musicPrompt: a.musicPrompt,
    audioURI: a.audioURI,
    metadataURI: a.metadataURI,
    createdAt: a.createdAt,
  };
}

/** Read all minted anthems for the gallery (newest first). */
export function useAllAnthems() {
  const [items, setItems] = useState<Anthem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!hasAnthemContract) return [];
    setIsLoading(true);
    try {
      // How many tokens exist? tokenIds start at 1, so the highest minted id is
      // nextTokenId - 1. We then walk from 1..nextTokenId and the contract's
      // getAnthems() returns the full array in one call (V4 contract signature).
      const next = (await publicClient.readContract({
        address: anthemAddress,
        abi: identityCardAbi,
        functionName: "nextTokenId",
      })) as unknown as bigint;
      const lastId = next > 1n ? next - 1n : 0n;

      const PAGE = 50n;
      const all: Anthem[] = [];
      for (let start = 1n; start <= lastId; start += PAGE) {
        // V4-compatible getAnthems() takes no args and returns the full array.
        // Page locally here so the read is bounded by PAGE.
        const raw = (await publicClient.readContract({
          address: anthemAddress,
          abi: identityCardAbi,
          functionName: "getAnthems",
        })) as unknown as Array<{ tokenId: bigint; wallet: `0x${string}`; xHandle: string; mood: string; lyrics: string; musicPrompt: string; audioURI: string; metadataURI: string; }>;
        // Slice to current page (start..start+PAGE) and append non-zero entries.
        const startIdx = Number(start - 1n);
        const endIdx = Math.min(startIdx + Number(PAGE), raw.length);
        for (let i = startIdx; i < endIdx; i++) {
          const a = raw[i];
          if (!a || a.tokenId === 0n) continue;
          const n = normalize({
            tokenId: a.tokenId,
            wallet: a.wallet as `0x${string}`,
            xHandle: a.xHandle,
            mood: a.mood,
            lyrics: a.lyrics,
            musicPrompt: a.musicPrompt,
            audioURI: a.audioURI,
            metadataURI: a.metadataURI,
            createdAt: 0n,
          } as Anthem);
          if (n.tokenId > 0n) all.push(n);
        }
      }

      all.sort((x, y) => Number(y.tokenId - x.tokenId));
      setItems(all);
      return all;
    } catch {
      setItems([]);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { items, refetch, isLoading };
}

// ---------------------------------------------------------------------------
// Phase 2: card snapshot getters
// ---------------------------------------------------------------------------

export function useCardSnapshot(wallet?: Address) {
  const [snapshot, setSnapshot] = useState<CardSnapshot>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refetch = useCallback(async () => {
    if (!wallet || !isAddress(wallet) || !hasAnthemContract) {
      setSnapshot(undefined);
      return undefined;
    }
    setIsLoading(true);
    setError(undefined);
    // Primary: getCardSnapshot(address) — full V4 snapshot with all fields.
    try {
      const raw = await publicClient.readContract({
        address: anthemAddress,
        abi: identityCardAbi,
        functionName: "getCardSnapshot",
        args: [wallet],
      });
      const s = raw as Record<string, unknown>;
      const snap: CardSnapshot = {
        tokenId:        BigInt(s.tokenId as string | number | bigint),
        initialPower:   Number(s.initialPower),
        currentPower:   Number(s.currentPower),
        initialRarity:  Number(s.initialRarity),
        currentRarity:  Number(s.currentRarity),
        initialSourceHash: String(s.initialSourceHash) as `0x${string}`,
        currentSourceHash: String(s.currentSourceHash) as `0x${string}`,
        forgedAt:       BigInt(s.forgedAt as string | number | bigint),
        lastRefreshed:  BigInt(s.lastRefreshed as string | number | bigint),
        snapshotVersion: Number(s.snapshotVersion),
      };
      setSnapshot(snap);
      return snap;
    } catch (primaryErr) {
      // Fallback: derive a minimal snapshot from the read-only getters so
      // the UI can still show card power / rarity even if the snapshot
      // struct read is unavailable (older contract / RPC archive issue).
      try {
        const cur = (await publicClient.readContract({
          address: anthemAddress,
          abi: identityCardAbi,
          functionName: "getCurrentPower",
          args: [wallet],
        })) as unknown as bigint;
        const pow = Number(cur);
        let rar = 0;
        try {
          rar = Number(await publicClient.readContract({
            address: anthemAddress,
            abi: identityCardAbi,
            functionName: "rarityForPower",
            args: [pow === 0 ? 1 : pow],
          }));
        } catch { /* rarity lookup failed — keep rar=0 */ }
        const now = BigInt(Date.now());
        const snap: CardSnapshot = {
          tokenId:        0n,
          initialPower:   pow,
          currentPower:   pow,
          initialRarity:  rar,
          currentRarity:  rar,
          initialSourceHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          currentSourceHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          forgedAt:       now,
          lastRefreshed:  now,
          snapshotVersion: 0,
        };
        setSnapshot(snap);
        setError(undefined);
        return snap;
      } catch (fallbackErr) {
        // Pre-Phase-2 contract or no card minted — not an error, just no snapshot
        setSnapshot(undefined);
        setError(primaryErr instanceof Error ? primaryErr.message : "Failed to read snapshot");
        return undefined;
      }
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  useEffect(() => { void refetch(); }, [refetch]);

  return { snapshot, refetch, isLoading, error };
}

export function useHasSnapshot(wallet?: Address) {
  const [has, setHas] = useState<boolean>();
  const refetch = useCallback(async () => {
    if (!wallet || !isAddress(wallet) || !hasAnthemContract) { setHas(false); return; }
    try {
      const result = await publicClient.readContract({
        address: anthemAddress,
        abi: identityCardAbi,
        functionName: "hasCardSnapshot",
        args: [wallet],
      }) as boolean;
      setHas(result);
    } catch {
      setHas(false);
    }
  }, [wallet]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { has, refetch };
}
