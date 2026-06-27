// src/hooks/useMarketplaceActions.ts
// Actions on the marketplace: list / cancel / buy.
// The buy flow is fully on-chain and atomic:
//   1. Buyer approves AP for the marketplace (if not already).
//   2. Buyer calls marketplace.buy(listingId).
//   3. AP and NFT move in the same tx, or both revert. If the user
//      rejects the wallet signature, no AP moves.

import { useCallback, useState } from "react";
import { type Address, type Hash } from "viem";
import { RITUAL_MARKETPLACE_ABI } from "../lib/marketplaceAbi";
import { RITUAL_PACK_NFT_ABI } from "../lib/packNftAbi";
import { RITUAL_AP_ABI } from "../lib/apAbi";
import { envAddress, apAddress, marketplaceAddress } from "../lib/chains";
import { publicClient } from "./useAnthem";
import { ensureReadyForWrite, getSharedWalletClient } from "../lib/wallet";
import { emit } from "../lib/eventBus";
import { RITUAL_GAS } from "../lib/gasDefaults";
import { shortTxError } from "../lib/shortTxError";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

function getMarketplaceAddress(): Address {
  return marketplaceAddress;
}

function getAPAddress(): Address | null {
  return apAddress;
}

export interface UseMarketplaceActionsResult {
  list: (nft: Address, tokenId: bigint, priceAp: bigint, expiry: number) => Promise<Hash>;
  cancel: (listingId: bigint) => Promise<Hash>;
  buy: (listingId: bigint, priceAp: bigint) => Promise<Hash>;
  loading: boolean;
  error: string | undefined;
}

export function useMarketplaceActions(): UseMarketplaceActionsResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const list = useCallback(
    async (nft: Address, tokenId: bigint, priceAp: bigint, expiry: number): Promise<Hash> => {
      setLoading(true);
      setError(undefined);
      try {
        const account = await ensureReadyForWrite();
        const walletClient = getSharedWalletClient();
        if (!walletClient) throw new Error("Wallet not connected");

        const mkt = getMarketplaceAddress();
        const apAddr = getAPAddress();
        if (!apAddr) throw new Error("Marketplace is unavailable right now.");

        // 1) Read the listing fee from the marketplace (1e18 = 1 AP).
        //    Burned inside `list()` — seller must approve at least this
        //    much AP for the marketplace before listing.
        const listingFee = (await publicClient.readContract({
          address: mkt,
          abi: RITUAL_MARKETPLACE_ABI,
          functionName: "LISTING_FEE",
          args: [],
        })) as bigint;

        // 2) Approve marketplace to move the NFT (escrow).
        const approved = (await publicClient.readContract({
          address: nft,
          abi: RITUAL_PACK_NFT_ABI,
          functionName: "isApprovedForAll",
          args: [account, mkt],
        })) as boolean;
        if (!approved) {
          const tx = await walletClient.writeContract({
            account,
            chain: null,
            address: nft,
            abi: RITUAL_PACK_NFT_ABI,
            functionName: "setApprovalForAll",
            args: [mkt, true],
            maxFeePerGas: RITUAL_GAS.maxFeePerGas,
            maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
          });
          await publicClient.waitForTransactionReceipt({ hash: tx });
        }

        // 3) Approve the marketplace to pull the listing fee (1 AP).
        //    If existing allowance < fee, bump it up to the fee amount.
        //    (We don't approve priceAp here — the buyer approves
        //    priceAp separately when buying, not the seller.)
        const feeAllow = (await publicClient.readContract({
          address: apAddr,
          abi: RITUAL_AP_ABI,
          functionName: "allowance",
          args: [account, mkt],
        })) as bigint;
        if (feeAllow < listingFee) {
          const approveTx = await walletClient.writeContract({
            account,
            chain: null,
            address: apAddr,
            abi: RITUAL_AP_ABI,
            functionName: "approve",
            args: [mkt, listingFee],
            maxFeePerGas: RITUAL_GAS.maxFeePerGas,
            maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveTx });
        }

        // 4) List — marketplace pulls the NFT + 1 AP fee (burned).
        const tx = await walletClient.writeContract({
          account,
          chain: null,
          address: mkt,
          abi: RITUAL_MARKETPLACE_ABI,
          functionName: "list",
          args: [nft, tokenId, priceAp, BigInt(expiry)],
          maxFeePerGas: RITUAL_GAS.maxFeePerGas,
          maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        // Cross-hook invalidation: AP burned (fee), NFT moved to escrow,
        // listings changed.
        emit({ type: 'ap-changed', reason: 'marketplace-list' });
        emit({ type: 'nft-changed', reason: 'marketplace-list' });
        emit({ type: 'listing-changed', reason: 'list' });
        emit({ type: 'tx-success', source: 'useMarketplaceActions', action: 'list', hash: tx });
        return tx;
      } catch (e) {
        const msg = shortTxError(e, "List");
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const cancel = useCallback(
    async (listingId: bigint): Promise<Hash> => {
      setLoading(true);
      setError(undefined);
      try {
        const account = await ensureReadyForWrite();
        const walletClient = getSharedWalletClient();
        if (!walletClient) throw new Error("Wallet not connected");
        const tx = await walletClient.writeContract({
          account,
          chain: null,
          address: getMarketplaceAddress(),
          abi: RITUAL_MARKETPLACE_ABI,
          functionName: "cancel",
          args: [listingId],
          maxFeePerGas: RITUAL_GAS.maxFeePerGas,
          maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        // Cross-hook invalidation: NFT returned to seller, listing closed.
        emit({ type: 'nft-changed', reason: 'marketplace-cancel' });
        emit({ type: 'listing-changed', reason: 'cancel' });
        emit({ type: 'tx-success', source: 'useMarketplaceActions', action: 'cancel', hash: tx });
        return tx;
      } catch (e) {
        const msg = shortTxError(e, "Cancel");
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const buy = useCallback(
    async (listingId: bigint, priceAp: bigint): Promise<Hash> => {
      setLoading(true);
      setError(undefined);
      try {
        const account = await ensureReadyForWrite();
        const walletClient = getSharedWalletClient();
        if (!walletClient) throw new Error("Wallet not connected");

        const mkt = getMarketplaceAddress();
        const apAddr = getAPAddress();
        if (!apAddr) throw new Error("Marketplace is unavailable right now.");

        // 1) Approve AP for the marketplace
        const allow = (await publicClient.readContract({
          address: apAddr,
          abi: RITUAL_AP_ABI,
          functionName: "allowance",
          args: [account, mkt],
        })) as bigint;
        if (allow < priceAp) {
          const approveTx = await walletClient.writeContract({
            account,
            chain: null,
            address: apAddr,
            abi: RITUAL_AP_ABI,
            functionName: "approve",
            args: [mkt, priceAp],
            maxFeePerGas: RITUAL_GAS.maxFeePerGas,
            maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveTx });
        }

        // 2) Atomic buy on-chain
        const tx = await walletClient.writeContract({
          account,
          chain: null,
          address: mkt,
          abi: RITUAL_MARKETPLACE_ABI,
          functionName: "buy",
          args: [listingId],
          maxFeePerGas: RITUAL_GAS.maxFeePerGas,
          maxPriorityFeePerGas: RITUAL_GAS.maxPriorityFeePerGas,
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        // Cross-hook invalidation: AP paid (price), NFT moved to buyer,
        // listing is no longer active.
        emit({ type: 'ap-changed', reason: 'marketplace-buy' });
        emit({ type: 'nft-changed', reason: 'marketplace-buy' });
        emit({ type: 'listing-changed', reason: 'buy' });
        emit({ type: 'tx-success', source: 'useMarketplaceActions', action: 'buy', hash: tx });
        return tx;
      } catch (e) {
        const msg = shortTxError(e, "Buy");
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { list, cancel, buy, loading, error };
}
