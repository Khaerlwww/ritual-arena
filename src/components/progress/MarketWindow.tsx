// src/components/progress/MarketWindow.tsx
//
// Market window. Two tabs:
//   1. Marketplace  — on-chain marketplace for RitualPackNFT tokens.
//                     Listings are escrowed on-chain by RitualMarketplace
//                     (RitualMarketplace.list → NFT.transferFrom into
//                     escrow). The buy flow (RitualMarketplace.buy) is
//                     fully on-chain: AP.transferFrom(buyer→seller) +
//                     NFT.transferFrom(escrow→buyer) atomic in one tx.
//                     No backend, no off-chain ledger, no localStorage.
//   2. Staking      — Utility Staking tab. Unchanged.
//
// The legacy V4 Imprint marketplace has been superseded by this V5
// marketplace and lives in contracts/archive/imprint/ (not imported).

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { Lock, Store, Tag, X, ShoppingCart, ListPlus, ShieldCheck, ArrowDownToLine, Coins, ArrowUpFromLine } from "lucide-react";
import { useStaking, useStakingWrites } from "../../hooks/useStaking";
import { useStakingActivity, shortAddress, timeAgo } from "../../hooks/useStakingActivity";
import { CollectionCard } from "../pack/CollectionCard";
import { type PackResultCard } from "../../types/packCard";
import { loadCollectionPool, type CollectionPool } from "../../lib/packPool";
import {
  internalToVisualRarity,
  INTERNAL_RARITIES,
  roleToInternalRarity,
  type InternalRarity,
} from "../../lib/rarity";
import { useOwnedPackNFTs, type OwnedPackCard } from "../../hooks/useOwnedPackNFTs";
import { usePackCardDataMap } from "../../hooks/usePackCardDataMap";
import {
  useMarketplaceListings,
  type MarketplaceListing,
} from "../../hooks/useMarketplaceListings";
import { useMarketplaceActions } from "../../hooks/useMarketplaceActions";
import { useAPBalance } from "../../hooks/useAPBalance";
import { formatAp } from "../../lib/apFormat";
import { packNftAddress } from "../../lib/chains";

type Tab = "market" | "staking";

function txError(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string; code?: number };
  if (e?.code === 4001 || /rejected/i.test(e?.message || "")) return "Transaction cancelled in wallet.";
  return e?.shortMessage || (e?.message ? e.message.split("\n")[0] : "Transaction failed.");
}

function safeParseRitual(value: string) {
  try {
    return parseEther(value || "0");
  } catch {
    return 0n;
  }
}

/** On-chain Marketplace for RitualPackNFT tokens (V5).
 *  Listings are escrowed on-chain by RitualMarketplace. AP is the
 *  on-chain RitualAP ERC-20 — paid via approve + transferFrom in the
 *  same tx as the NFT move. No localStorage, no backend signature. */
function MarketplaceView({ address }: { address?: Address }) {
  const ownerKey = address ? address.toLowerCase() : null;

  // 1) on-chain listings + event-driven refresh
  const { listings, refetch: refetchListings } = useMarketplaceListings();
  const actions = useMarketplaceActions();

  // 2) my owned NFTs (to know what I can list)
  const owned = useOwnedPackNFTs(address);

  // AP balance refetch hook (display lives in <APBadge/> top-right)
  const ap = useAPBalance(address);

  // 3) pool JSON for card display enrichment
  const [pool, setPool] = useState<CollectionPool | null>(null);
  useEffect(() => {
    void loadCollectionPool().then(setPool).catch(() => setPool(null));
  }, []);

  // 5) listing form state
  const [listTokenId, setListTokenId] = useState<string>("");
  const [priceInput, setPriceInput] = useState<string>("0.1");
  const [msg, setMsg] = useState<string>();
  const [err, setErr] = useState<string>();

  // Owned cards: use the on-chain data + pool for display.
  const myCards: PackResultCard[] = useMemo(
    () => owned.cards.map((c) => toDisplayCard(c, pool, ownerKey ?? "guest")),
    [owned.cards, pool, ownerKey],
  );

  // Cards already listed = those whose tokenId is currently in an
  // active listing by the current wallet.
  const myActiveListingTokenIds = useMemo(() => {
    if (!ownerKey) return new Set<string>();
    return new Set(
      listings
        .filter((l) => l.active && l.seller.toLowerCase() === ownerKey)
        .map((l) => l.tokenId.toString()),
    );
  }, [listings, ownerKey]);

  const listableCards = useMemo(
    () => myCards.filter((c) => !myActiveListingTokenIds.has(c.instanceId.replace(/^nft-/, ""))),
    [myCards, myActiveListingTokenIds],
  );

  useEffect(() => {
    if (listTokenId && !listableCards.some((c) => c.instanceId === `nft-${listTokenId}`)) {
      setListTokenId("");
    }
  }, [listableCards, listTokenId]);

  if (!address) {
    return (
      <div className="bevel-in bg-coal p-6 text-center font-mono text-[12px] text-iceaccent/60">
        <Store size={32} className="mx-auto mb-3 text-aqua/40" />
        <p>Marketplace connect a wallet to browse, list, and buy cards.</p>
      </div>
    );
  }

  async function onList(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    setMsg(undefined);
    if (!ownerKey) {
      setErr("Connect a wallet to list cards.");
      return;
    }
    const card = listableCards.find((c) => c.instanceId === `nft-${listTokenId}`);
    if (!card) {
      setErr("Pick a card from your collection first.");
      return;
    }
    let priceWei: bigint;
    try {
      priceWei = parseEther(priceInput || "0");
    } catch {
      setErr("Invalid price.");
      return;
    }
    if (priceWei <= 0n) {
      setErr("Price must be greater than 0.");
      return;
    }
    try {
      const tx = await actions.list(packNftAddress, BigInt(listTokenId), priceWei, 0);
      setMsg(
        `Listed @${card.username} (${card.rarity} #${card.serialNumber}) for ${priceInput} AP — tx ${tx.slice(0, 6)}…${tx.slice(-4)}`,
      );
      setListTokenId("");
      void refetchListings();
    } catch (e) {
      setErr((e as Error).message || "List failed.");
    }
  }

  async function onCancel(listing: MarketplaceListing) {
    setErr(undefined);
    setMsg(undefined);
    try {
      const tx = await actions.cancel(listing.listingId);
      setMsg(`Cancelled listing #${listing.listingId.toString()} — tx ${tx.slice(0, 6)}…${tx.slice(-4)}`);
      void refetchListings();
    } catch (e) {
      setErr((e as Error).message || "Cancel failed.");
    }
  }

  async function onBuy(listing: MarketplaceListing) {
    setErr(undefined);
    setMsg(undefined);
    const seller = listing.seller.toLowerCase();
    const ok = window.confirm(
      `Buy token #${listing.tokenId.toString()} from ${seller.slice(0, 6)}…${seller.slice(-4)} for ${formatEther(listing.priceAp)} AP?\n\nAtomic on-chain: AP and NFT will move in the same transaction. If you reject the wallet signature, no AP moves.`,
    );
    if (!ok) return;
    try {
      const tx = await actions.buy(listing.listingId, listing.priceAp);
      setMsg(`Bought token #${listing.tokenId.toString()} — tx ${tx.slice(0, 6)}…${tx.slice(-4)}`);
      void refetchListings();
      void ap.refetch();
    } catch (e) {
      setErr((e as Error).message || "Buy failed.");
    }
  }

  const myListings = useMemo(
    () => listings.filter((l) => l.seller.toLowerCase() === ownerKey),
    [listings, ownerKey],
  );
  const buyableListings = useMemo(
    () => listings,
    [listings],
  );
  // For active listings we don't own (buyable side), look up the
  // underlying RitualPackNFT.cardData(tokenId) on-chain via Multicall3
  // so we can render the actual CollectionCard, not just a placeholder
  // label. We cover BOTH sides — our own listings (which sit in the
  // marketplace escrow and are no longer in our wallet's balance) AND
  // other people's listings — using a single batched call.
  const allListingTokenIds = useMemo(
    () => listings.map((l) => l.tokenId),
    [listings],
  );
  const listingCardMap = usePackCardDataMap(allListingTokenIds);
  const buildCardFromListing = useCallback(
    (l: MarketplaceListing): PackResultCard | null => {
      const ownedCard = listingCardMap.cards[l.tokenId.toString()];
      if (!ownedCard) return null;
      // Display the NFT as belonging to the seller wallet (visual only).
      return toDisplayCard(
        ownedCard,
        pool,
        l.seller.toLowerCase() as `0x${string}`,
      );
    },
    [listingCardMap.cards, pool],
  );
  const myListingCards: PackResultCard[] = useMemo(
    () => myListings.map(buildCardFromListing).filter((c): c is PackResultCard => c !== null),
    [myListings, buildCardFromListing],
  );
  const buyableCards: PackResultCard[] = useMemo(
    () => buyableListings.map(buildCardFromListing).filter((c): c is PackResultCard => c !== null),
    [buyableListings, buildCardFromListing],
  );

  return (
    <div className="grid gap-3">
      {/* HEADER + AP BALANCE + TESTNET BANNER */}
      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          Market
        </div>
        <div className="bevel-in grid gap-1.5 bg-coal p-2 font-mono text-[10px] text-iceaccent/70">
          <p className="flex items-center gap-1.5">
            <ShieldCheck size={11} className="text-aqua" />
            <span className="text-aqua">on-chain marketplace</span>
            <span className="text-iceaccent/40">
              — NFTs escrowed by RitualMarketplace on Ritual testnet.
            </span>
          </p>
          <p className="text-iceaccent/40">
            Prices are denominated in <span className="text-aqua">AP</span> (RitualAP ERC-20).
            Approve + buy settles the on-chain transfer atomically.
          </p>
        </div>
      </div>

      {/* LIST A CARD */}
      <form onSubmit={onList} className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          <ListPlus size={11} className="inline -mt-0.5 mr-1" /> List a card
        </div>
        <div className="bevel-in grid gap-2 bg-coal p-3 font-mono text-[11px]">
          {listableCards.length === 0 ? (
            <p className="text-iceaccent/50">
              no listable cards — open a pack from Collection Packs first
              (mints a RitualPackNFT to your wallet).
            </p>
          ) : (
            <>
              <div className="grid gap-1.5 sm:grid-cols-[1fr_120px_auto] sm:items-center">
                <select
                  value={listTokenId}
                  onChange={(e) => setListTokenId(e.target.value)}
                  className="bevel-in-thin bg-[#061512] px-2 py-1.5 text-[11px] text-ice outline-none"
                >
                  <option value="">— pick a RitualPackNFT from your wallet —</option>
                  {listableCards.map((c) => (
                    <option key={c.instanceId} value={c.instanceId.replace(/^nft-/, "")}>
                      #{c.instanceId.replace(/^nft-/, "")} · {c.rarity} · @{c.username} · pow {c.power}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 bevel-in-thin bg-[#061512] px-2 py-1.5">
                  <Tag size={10} className="text-iceaccent/50" />
                  <input
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    inputMode="decimal"
                    placeholder="100"
                    className="w-full bg-transparent text-[12px] text-aqua outline-none"
                  />
                  <span className="text-[10px] text-iceaccent/50">AP</span>
                </label>
                <button
                  type="submit"
                  disabled={!listTokenId || actions.loading}
                  className="win-btn win-btn-emerald inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <ListPlus size={12} /> List
                </button>
              </div>
              {listTokenId && (
                <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-start">
                  <div className="w-40 shrink-0">
                    {(() => {
                      const c = listableCards.find((x) => x.instanceId === `nft-${listTokenId}`);
                      return c ? <CollectionCard card={c} /> : null;
                    })()}
                  </div>
                  <p className="text-[10px] text-iceaccent/40">
                    the NFT will be escrowed on-chain by RitualMarketplace.
                    Listing costs a flat <span className="text-aqua">1 AP
                    fee (burned)</span> — you&apos;ll be prompted to
                    approve AP for the marketplace before listing. When
                    a buyer pays the price, RitualMarketplace.buy()
                    settles the entire trade on-chain in a single
                    transaction — AP.transferFrom(buyer→seller) and
                    NFT.transferFrom(escrow→buyer) happen atomically.
                    No backend, no off-chain step.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </form>

      {/* MY LISTINGS */}
      {myListings.length > 0 && (
        <div className="bevel-out bg-wgray p-[2px]">
          <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
            My Listings ({myListings.length})
          </div>
          <div className="bevel-in grid gap-2 bg-coal p-2 sm:grid-cols-2 lg:grid-cols-3">
            {myListings.map((l, idx) => {
              const visual = myListingCards[idx];
              const isV10 = l.nftContract.toLowerCase() === packNftAddress.toLowerCase();
              const badge = isV10 ? "V10" : "V9 stranded";
              return (
                <div key={l.listingId.toString()} className="flex flex-col gap-1">
                  {visual ? (
                    <CollectionCard card={visual} versionBadge={badge} />
                  ) : (
                    <div className="bevel-in bg-[#080808] p-3 font-mono text-[10px] text-iceaccent/60">
                      token #{l.tokenId.toString()}
                      {listingCardMap.loading ? " (loading…)" : ""}
                    </div>
                  )}
                  {!isV10 && (
                    <div className="bevel-in-thin bg-[#1f0a0a] border border-[#ff8a8a]/40 px-2 py-1 font-mono text-[9px] text-[#ff8a8a]">
                      references V9 contract — cancel to release
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-1 font-mono text-[10px]">
                    <span className="text-aqua">{formatAp(l.priceAp)} AP</span>
                    <button
                      onClick={() => onCancel(l)}
                      disabled={actions.loading}
                      className="bevel-in-thin bg-[#1a0f2e] px-1.5 py-0.5 text-[8px] text-[#c9b8ff] hover:bg-[#2a174e] disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ACTIVE LISTINGS (buyable) */}
      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          Active Listings ({buyableListings.length})
        </div>
        <div className="bevel-in bg-coal p-2">
          {buyableListings.length === 0 ? (
            <p className="p-4 text-center font-mono text-[11px] text-iceaccent/50">
              no active listings right now. be the first to list a card.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {buyableListings.map((l) => {
                const sellerShort = `${l.seller.slice(0, 6)}…${l.seller.slice(-4)}`;
                const visual = buyableCards.find(
                  (c) => c.instanceId === `nft-${l.tokenId.toString()}`,
                );
                const isV10 = l.nftContract.toLowerCase() === packNftAddress.toLowerCase();
                const badge = isV10 ? "V10" : "V9 stranded";
                return (
                  <div key={l.listingId.toString()} className="flex flex-col gap-1">
                    {visual ? (
                      <CollectionCard card={visual} versionBadge={badge} />
                    ) : (
                      <div className="bevel-in bg-[#080808] p-3 font-mono text-[10px] text-iceaccent/60">
                        RitualPackNFT #{l.tokenId.toString()}
                        {listingCardMap.loading ? " (loading…)" : ""}
                      </div>
                    )}
                    <div className="grid gap-1 font-mono text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="text-aqua font-bold">
                          {formatAp(l.priceAp)} AP
                        </span>
                        <span className="text-iceaccent/40">seller {sellerShort}</span>
                      </div>
                      <button
                        onClick={() => onBuy(l)}
                        disabled={actions.loading}
                        className="win-btn win-btn-emerald inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <ShoppingCart size={12} /> Buy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* STATUS */}
      {msg && (
        <p className="bevel-in-thin bg-[#061512] px-2 py-1.5 font-mono text-[11px] text-aqua">
          {msg}
        </p>
      )}
      {err && (
        <p className="bevel-in-thin bg-[#2a0f0f] px-2 py-1.5 font-mono text-[11px] text-[#ff8080] inline-flex items-center gap-1.5">
          <X size={11} /> {err}
        </p>
      )}
    </div>
  );
}

// ─── Helper: OwnedPackCard + pool → PackResultCard (display only) ───
function toDisplayCard(
  c: OwnedPackCard,
  pool: CollectionPool | null,
  ownerKey: string,
): PackResultCard {
  const poolCard = pool?.byId?.[Number(c.cardId)];
  // Resolve rarity safely: contract returns uint8 (0..5), but
  // RARITY_TIER_CONFIG is keyed by string. Use the canonical index map
  // first, fall back to the role string, last resort BITTY.
  const rarityName: InternalRarity =
    (typeof c.rarity === "number" && INTERNAL_RARITIES[c.rarity]) ||
    roleToInternalRarity(c.role) ||
    "BITTY";
  const visual = internalToVisualRarity(rarityName);
  return {
    cardId: Number(c.cardId),
    userId: poolCard?.userId ?? `chain-${c.cardId.toString()}`,
    username: poolCard?.username ?? c.role.toLowerCase() ?? "anonymous",
    avatarUrl: poolCard?.avatarUrl ?? "",
    rarity: rarityName,
    visualRarity: visual,
    power: c.power,
    role: c.role,
    traits: [],
    generation: 1,
    serial: `${c.cardId.toString()} / on-chain`,
    serialNumber: Number(c.cardId),
    mintedSerial: Number(c.cardId),
    owner: ownerKey,
    acquiredAt: c.mintedAt,
    instanceId: `nft-${c.tokenId.toString()}`,
  };
}

/** Utility Staking — preserved unchanged from the previous build.
 *  Self-contained: uses useStaking / useStakingWrites only. The legacy
 *  Imprint system is archived under contracts/archive/imprint/ and is
 *  not imported. */
function StakingView({
  address,
  staking,
  stakingW,
  activity,
  setMsg,
  onChanged,
}: {
  address?: Address;
  staking: ReturnType<typeof useStaking>;
  stakingW: ReturnType<typeof useStakingWrites>;
  activity: ReturnType<typeof useStakingActivity>;
  setMsg: (s?: string) => void;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("0.1");
  const amountWei = safeParseRitual(amount);
  // RATE is read live from the on-chain apPerRitualPerDay() view (V5
  // exposes it as a pure function returning AP_PER_RITUAL_PER_DAY = 150e18).
  // No client-side hardcoding.
  // Falls back to 150 if the protocol read hasn't completed yet — the
  // contract constant is AP_PER_RITUAL_PER_DAY = 150 * 10**18 (see
  // RitualStaking.sol). This guarantees the rate/preview UI never
  // displays 0 just because the global stats call was still in flight
  // or hit a transient RPC error.
  const RATE_PER_RITUAL =
    staking.protocol.apPerRitualPerDay > 0
      ? staking.protocol.apPerRitualPerDay
      : 150;
  const LOCK_DAYS = 14;
  const WALLET_CAP_RITUAL = 2;

  const stakeAmount = Number(amount) || 0;
  // Stake estimate: 14-day projection read directly from the contract's
  // estimatedAP(amount) view. Avoids the off-by-one that happens when the
  // client does fractional multiplication and then truncates.
  const [est14d, setEst14d] = useState<bigint>(0n);
  useEffect(() => {
    if (!stakeAmount || stakeAmount <= 0) {
      setEst14d(0n);
      return;
    }
    // parseEther() uses the exact decimal string to avoid the precision
    // loss of BigInt(Math.round(stakeAmount * 1e18)).
    const wei = parseEther(amount || "0");
    let cancelled = false;
    void staking.estimatedAPForAmount(wei).then((ap) => {
      if (!cancelled) setEst14d(ap);
    });
    return () => { cancelled = true; };
  }, [amount, stakeAmount, staking.estimatedAPForAmount]);
  // 7-day projection derived from the on-chain 14-day value (same integer
  // math the contract uses per-day). AP_PER_RITUAL_PER_DAY is constant.
  const est7d = (est14d * 7n) / 14n;
  const onChainPerDay = est14d / 14n;
  const activePositions = staking.positions.filter((p) => !p.withdrawn);
  // Canonical per-wallet values are read directly from the on-chain
  // contract (totalClaimedByWallet, pendingRewards, totalStaked,
  // lastClaimedAt). No client-side recomputation from event logs.
  //
  // RITUAL amounts come from chain as 18-decimal native-coin wei. Convert
  // via formatEther (a string) then Number() so toFixed(4) formatting
  // works without precision loss.
  const walletStaked = Number(formatEther(staking.totalStaked));
  const walletPendingAP = staking.totalPendingAP; // sum from pendingRewards()
  const walletTotalClaimedAP = staking.walletTotalClaimedAP; // from totalClaimed(wallet)
  const walletLastClaimedAtSec = staking.walletLastClaimedAt;
  const lastClaimDisplay =
    walletLastClaimedAtSec > 0
      ? new Date(walletLastClaimedAtSec * 1000).toLocaleString()
      : "—";
  // Global canonical values
  const totalStakedAll = Number(formatEther(staking.protocol.totalProtocolStaked));
  const totalClaimedGlobal = staking.protocol.totalClaimedGlobal;
  const totalClaimedGlobalRemaining = staking.protocol.totalClaimedGlobalRemaining;
  const activeStakers = staking.protocol.activeStakerCount;

  if (!address) {
    return (
      <div className="bevel-in bg-coal p-4 font-mono text-[12px] text-iceaccent/70">
        Staking connect a wallet to view staking analytics
      </div>
    );
  }

  if (!staking.supported) {
    return (
      <div className="bevel-in bg-coal p-6 text-center font-mono text-[12px] text-iceaccent/60">
        <Lock size={32} className="mx-auto mb-3 text-aqua/40" />
        <p>Staking contract not configured</p>
      </div>
    );
  }

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="bevel-in-thin bg-[#061512] p-2">
      <p className="text-[9px] uppercase tracking-[0.15em] text-iceaccent/50">{label}</p>
      <p className="mt-0.5 font-display text-lg font-bold text-aqua">{value}</p>
    </div>
  );

  return (
    <div className="grid gap-3">
      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">Staking Analytics</div>
        <div className="bevel-in bg-coal p-3 font-mono text-[10px] text-iceaccent/70">
          <p>fixed ap reward module initialized</p>
          <p>reward rate: <span className="text-aqua">{RATE_PER_RITUAL} AP / RITUAL / DAY</span></p>
          <p>lock: <span className="text-aqua">14 days</span></p>
          <p>wallet cap: <span className="text-aqua">2 RITUAL</span></p>
        </div>
      </div>

      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          Per-Wallet Staking (on-chain)
        </div>
        <div className="bevel-in grid grid-cols-2 gap-2 bg-coal p-3 font-mono text-[10px] sm:grid-cols-3">
          <Stat label="Staked (you)"   value={`${walletStaked.toFixed(4)} RITUAL`} />
          <Stat label="Pending AP (you)" value={walletPendingAP.toLocaleString()} />
          <Stat label="Claimed AP (you)" value={walletTotalClaimedAP.toLocaleString()} />
          <Stat label="Last Claim"      value={lastClaimDisplay} />
          <Stat label="Active Positions" value={activePositions.length.toString()} />
        </div>
      </div>

      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          Global Staking Stats (on-chain)
        </div>
        <div className="bevel-in grid grid-cols-2 gap-2 bg-coal p-3 font-mono text-[10px] sm:grid-cols-3">
          <Stat label="Total Staked"           value={`${totalStakedAll.toFixed(4)} RITUAL`} />
          <Stat label="Total AP Claimed"        value={totalClaimedGlobal.toLocaleString()} />
          <Stat label="AP Remaining (cap)"      value={totalClaimedGlobalRemaining.toLocaleString()} />
          <Stat label="Active Stakers"         value={activeStakers.toLocaleString()} />
          <Stat label="Reward Rate"            value={`${RATE_PER_RITUAL} AP / RITUAL / DAY`} />
          <Stat label="Protocol Wallet Cap"    value={`${Number(formatEther(staking.protocol.maxStakePerWallet)).toFixed(2)} RITUAL`} />
        </div>
      </div>

      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">Stake</div>
        <div className="bevel-in grid gap-2 bg-coal p-3 font-mono text-[11px]">
          <div className="flex items-center gap-2">
            <label className="w-16 text-iceaccent/60">Amount</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="flex-1 bevel-in-thin bg-[#061512] px-2 py-1.5 text-[12px] text-aqua"
              placeholder="0.1"
            />
            <span className="text-iceaccent/50">RITUAL</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {["0.1", "0.5", "1", "2"].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                className={`bevel-in-thin px-2 py-0.5 text-[10px] ${
                  amount === v
                    ? "bg-[#06231d] text-aqua"
                    : "bg-[#0b0b0b] text-iceaccent/50 hover:text-iceaccent/80"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {stakeAmount > 0 && stakeAmount <= WALLET_CAP_RITUAL && (
            <div className="bevel-in-thin bg-[#061512] p-2 text-[10px]">
              <div className="flex justify-between">
                <span>On-chain Claim Rate</span>
                <span className="text-aqua">{formatAp(onChainPerDay)} AP/day</span>
              </div>
              <div className="flex justify-between">
                <span>7-Day Estimate</span>
                <span className="text-aqua">{formatAp(est7d)} AP</span>
              </div>
              <div className="flex justify-between">
                <span>14-Day Estimate</span>
                <span className="text-aqua">{formatAp(est14d)} AP</span>
              </div>
              <div className="flex justify-between">
                <span>Unlock Date</span>
                <span className="text-aqua">{new Date(Date.now() + LOCK_DAYS * 86400000).toLocaleDateString()}</span>
              </div>
              <div className="mt-1 border-t border-iceaccent/10 pt-1 text-[9px] text-iceaccent/40">
                {stakeAmount} RITUAL × {RATE_PER_RITUAL} AP/RITUAL/day × 14 days = {formatAp(est14d)} AP (on-chain estimatedAP)
              </div>
            </div>
          )}
          <div className="bevel-in bg-coal p-2 font-mono text-[9px] text-iceaccent/50">
            AP Precision ap rewards are calculated from exact stake amount. fractional ap is rounded down when claimed on-chain.
          </div>
          <button
            onClick={async () => {
              setMsg(undefined);
              try {
                await stakingW.stake(amount);
                setMsg(`${amount} RITUAL locked for ${LOCK_DAYS} days.`);
                onChanged();
              } catch (e) {
                setMsg(txError(e));
              }
            }}
            disabled={
              stakingW.isPending || stakeAmount <= 0 || stakeAmount > WALLET_CAP_RITUAL
            }
            className="win-btn win-btn-emerald inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Lock size={12} /> {stakingW.isPending ? "Staking..." : "Stake RITUAL"}
          </button>
        </div>
      </div>

      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad flex items-center justify-between px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          <span>Positions</span>
          <span className="font-mono text-[10px] text-aqua">{activePositions.length} active</span>
        </div>
        <div className="bevel-in bg-coal p-2">
          {activePositions.length === 0 ? (
            <div className="grid place-items-center p-4 font-mono text-[11px] text-iceaccent/50">
              <p>Staking no active positions</p>
              <p className="mt-1 text-[10px]">stake ritual to begin earning ap</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[10px]">
                <thead>
                  <tr className="border-b border-iceaccent/10 text-left text-iceaccent/50">
                    <th className="pb-1 pr-2">#</th>
                    <th className="pb-1 pr-2">Amount</th>
                    <th className="pb-1 pr-2" title="On-chain pending AP for this position (accruedAP() result)">Pending</th>
                    <th className="pb-1 pr-2">Claimed</th>
                    <th className="pb-1 pr-2">Unlock</th>
                    <th className="pb-1 pr-2">Status</th>
                    <th className="pb-1">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activePositions.map((p) => {
                    const amt = Number(formatEther(p.amount));
                    const unlockDate = new Date(p.unlocksAt * 1000).toLocaleDateString();
                    const remainingDays = Math.max(0, Math.ceil(p.secondsLeft / 86400));
                    const isReady = p.canUnstake;
                    return (
                      <tr key={p.id} className="border-b border-iceaccent/5 text-iceaccent/75">
                        <td className="py-1 pr-2 text-aqua">#{p.id}</td>
                        <td className="py-1 pr-2">{amt.toFixed(2)}</td>
                        <td className="py-1 pr-2 text-aqua">{p.pendingAP.toLocaleString()}</td>
                        <td className="py-1 pr-2">{p.claimedAP.toLocaleString()}</td>
                        <td className="py-1 pr-2">{isReady ? "READY" : `${remainingDays}d`}</td>
                        <td className="py-1 pr-2">
                          <span
                            className={`inline-block bevel-in-thin px-1 py-0.5 text-[8px] ${
                              isReady
                                ? "bg-[#06231d] text-[#1CC744]"
                                : "bg-[#1a0f2e] text-[#c9b8ff]"
                            }`}
                          >
                            {isReady ? "READY" : "ACTIVE"}
                          </span>
                        </td>
                        <td className="py-1">
                          <div className="flex gap-1">
                            <button
                              onClick={async () => {
                                setMsg(undefined);
                                try {
                                  await stakingW.claimAP(p.id);
                                  setMsg(`Claimed ${p.pendingAP} AP from #${p.id}.`);
                                  onChanged();
                                } catch (e) {
                                  setMsg(txError(e));
                                }
                              }}
                              disabled={stakingW.isPending || p.pendingAP <= 0}
                              className="bevel-in-thin bg-[#06231d] px-1 py-0.5 text-[8px] text-[#1CC744] disabled:opacity-40"
                            >
                              Claim
                            </button>
                            <button
                              onClick={async () => {
                                setMsg(undefined);
                                try {
                                  await stakingW.unstake(p.id);
                                  setMsg(`Withdrew ${amt} RITUAL from #${p.id}.`);
                                  onChanged();
                                } catch (e) {
                                  setMsg(txError(e));
                                }
                              }}
                              disabled={stakingW.isPending || !p.canUnstake}
                              className="bevel-in-thin bg-[#1a0f2e] px-1 py-0.5 text-[8px] text-[#c9b8ff] disabled:opacity-40"
                            >
                              Unstake
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* GLOBAL AP ANALYTICS — chart of totalClaimedGlobal over the last
          50 RewardsClaimed events, sorted by blockNumber asc (oldest
          left, newest right). Each bar's height = totalClaimedGlobalAfter
          for that event. Header shows the latest totalClaimedGlobal. */}
      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          Global AP Analytics
        </div>
        <div className="bevel-in bg-coal p-3">
          {(() => {
            const claimEvents = activity.events
              .filter((e) => e.kind === "claim" && e.totalClaimedGlobalAfter !== undefined)
              .slice()
              .reverse(); // oldest first for the chart
            const latest = claimEvents[claimEvents.length - 1];
            // Numeric scale factor for the chart — relative ratios are
            // preserved by the symmetric lossy conversion, so bar heights
            // are correct. The displayed value uses formatAp to render AP
            // (not raw wei).
            const maxVal = latest
              ? Number(latest.totalClaimedGlobalAfter)
              : 0;
            return (
              <>
                <div className="mb-2 flex items-center gap-4 font-mono text-[10px]">
                  <span className="text-iceaccent/50">Total Claimed (all wallets)</span>
                  <span className="text-aqua font-bold">
                    {formatAp(latest?.totalClaimedGlobalAfter)} AP
                  </span>
                  <span className="text-iceaccent/40">({claimEvents.length} recent claims)</span>
                </div>
                <div className="relative h-20 border-b border-l border-iceaccent/10">
                  {claimEvents.length === 0 ? (
                    <div className="grid h-full place-items-center font-mono text-[10px] text-iceaccent/40">
                      no global claims yet
                    </div>
                  ) : (
                    claimEvents.map((ev, i) => {
                      const heightPct = maxVal > 0
                        ? (Number(ev.totalClaimedGlobalAfter ?? 0n) / maxVal) * 100
                        : 0;
                      const leftPct = claimEvents.length > 1
                        ? (i / (claimEvents.length - 1)) * 100
                        : 50;
                      return (
                        <div
                          key={`${ev.txHash}-${i}`}
                          className="absolute bottom-0 w-1.5 bg-teal2/80 rounded-t"
                          style={{ left: `${leftPct}%`, height: `${Math.max(4, heightPct)}%` }}
                          title={`Block #${ev.blockNumber.toString()} • +${formatAp(ev.apAmount)} AP • Global total: ${formatAp(ev.totalClaimedGlobalAfter)} AP`}
                        />
                      );
                    })
                  )}
                </div>
                <p className="mt-1 font-mono text-[9px] text-iceaccent/40">
                  totalClaimedGlobal trajectory (each RewardsClaimed event · all wallets · last 50)
                </p>
              </>
            );
          })()}
        </div>
      </div>

      {/* STAKING ACTIVITY LOG — last 50 on-chain events (Staked,
          RewardsClaimed, Unstaked) from any wallet. Per-wallet rows
          are highlighted "you". Replaces the single-kind "Global
          Claim Log" with a unified view of the whole staking cycle. */}
      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad flex items-center justify-between px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          <span>Staking Activity Log</span>
          <span className="font-mono text-[9px] text-iceaccent/50">
            {activity.loading
              ? "loading…"
              : `${activity.events.length} recent events · all wallets · stake / claim / unstake`}
          </span>
        </div>
        <div className="bevel-in bg-coal p-2">
          {activity.loading && activity.events.length === 0 ? (
            <p className="p-2 font-mono text-[10px] text-iceaccent/50">loading recent staking activity…</p>
          ) : activity.events.length === 0 ? (
            <p className="p-2 font-mono text-[10px] text-iceaccent/50">
              no on-chain staking activity yet — first stake / claim / unstake will appear here
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[9px]">
                <thead>
                  <tr className="border-b border-iceaccent/10 text-left text-iceaccent/50">
                    <th className="pb-1 pr-2">When</th>
                    <th className="pb-1 pr-2">Kind</th>
                    <th className="pb-1 pr-2">Wallet</th>
                    <th className="pb-1 pr-2">Amount</th>
                    <th className="pb-1 pr-2">#</th>
                    <th className="pb-1">TX</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.events.map((ev, i) => {
                    const isYou =
                      address && ev.wallet.toLowerCase() === address.toLowerCase();
                    const kindMeta =
                      ev.kind === "stake"
                        ? { Icon: ArrowDownToLine, label: "STAKE", color: "text-aqua" }
                        : ev.kind === "claim"
                          ? { Icon: Coins, label: "CLAIM", color: "text-[#1CC744]" }
                          : { Icon: ArrowUpFromLine, label: "UNSTAKE", color: "text-[#c9b8ff]" };
                    const amountStr =
                      ev.kind === "claim"
                        ? `+${formatAp(ev.apAmount)} AP`
                        : ev.amount !== undefined
                          ? `${formatEther(ev.amount)} RITUAL`
                          : "—";
                    return (
                      <tr
                        key={`${ev.txHash}-${i}`}
                        className={`border-b border-iceaccent/5 ${isYou ? "bg-[#06231d]/40" : "text-iceaccent/75"}`}
                      >
                        <td className="py-1 pr-2 text-iceaccent/50" title={ev.timestampMs ? new Date(ev.timestampMs).toISOString() : ""}>
                          {timeAgo(ev.timestampMs)}
                        </td>
                        <td className="py-1 pr-2">
                          <span className={`inline-flex items-center gap-1 font-bold ${kindMeta.color}`}>
                            <kindMeta.Icon size={9} />
                            {kindMeta.label}
                          </span>
                        </td>
                        <td className="py-1 pr-2">
                          <span className={isYou ? "text-aqua font-bold" : ""}>
                            {isYou ? "you" : shortAddress(ev.wallet)}
                          </span>
                        </td>
                        <td className={`py-1 pr-2 ${kindMeta.color} font-bold`}>{amountStr}</td>
                        <td className="py-1 pr-2 text-iceaccent/50">
                          {ev.posId !== undefined ? `#${ev.posId}` : "—"}
                        </td>
                        <td className="py-1 text-iceaccent/40">
                          {ev.txHash.slice(0, 6)}…{ev.txHash.slice(-4)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* GLOBAL CLAIM LOG — last 50 RewardsClaimed events from any wallet.
          Replaces the old per-wallet "Claim Log" (which showed only the
          connected wallet's own claims). */}
      <div className="bevel-out bg-wgray p-[2px]">
        <div className="title-grad flex items-center justify-between px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
          <span>Global Claim Log</span>
          <span className="font-mono text-[9px] text-iceaccent/50">
            {activity.loading ? "loading…" : `${activity.events.filter((e) => e.kind === "claim").length} recent claims · all wallets`}
          </span>
        </div>
        <div className="bevel-in bg-coal p-2">
          {activity.loading && activity.events.length === 0 ? (
            <p className="p-2 font-mono text-[10px] text-iceaccent/50">loading recent claims…</p>
          ) : activity.events.filter((e) => e.kind === "claim").length === 0 ? (
            <p className="p-2 font-mono text-[10px] text-iceaccent/50">
              no global claims yet — first on-chain claim will appear here
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[9px]">
                <thead>
                  <tr className="border-b border-iceaccent/10 text-left text-iceaccent/50">
                    <th className="pb-1 pr-2">When</th>
                    <th className="pb-1 pr-2">Wallet</th>
                    <th className="pb-1 pr-2">AP</th>
                    <th className="pb-1 pr-2">Wallet Total</th>
                    <th className="pb-1 pr-2">Global Total</th>
                    <th className="pb-1">TX</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.events
                    .filter((e) => e.kind === "claim")
                    .map((ev, i) => {
                      const isYou = address && ev.wallet.toLowerCase() === address.toLowerCase();
                      return (
                        <tr
                          key={`${ev.txHash}-${i}`}
                          className="border-b border-iceaccent/5 text-iceaccent/75"
                        >
                          <td className="py-1 pr-2 text-iceaccent/50" title={ev.timestampMs ? new Date(ev.timestampMs).toISOString() : ""}>
                            {timeAgo(ev.timestampMs)}
                          </td>
                          <td className="py-1 pr-2">
                            <span className={isYou ? "text-aqua font-bold" : ""}>
                              {isYou ? "you" : shortAddress(ev.wallet)}
                            </span>
                          </td>
                          <td className="py-1 pr-2 text-aqua">+{formatAp(ev.apAmount)}</td>
                          <td className="py-1 pr-2">{formatAp(ev.totalClaimedByWalletAfter)}</td>
                          <td className="py-1 pr-2 text-[#1CC744]">{formatAp(ev.totalClaimedGlobalAfter)}</td>
                          <td className="py-1 text-iceaccent/40">
                            {ev.txHash.slice(0, 6)}…{ev.txHash.slice(-4)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MarketWindow({ address }: { address?: Address; myTokenId?: number; myHandle?: string; myMood?: string }) {
  const [tab, setTab] = useState<Tab>("market");
  const staking = useStaking(address);
  const stakingW = useStakingWrites();
  const activity = useStakingActivity();
  const [msg, setMsg] = useState<string>();

  const refetchStaking = useCallback(async () => {
    await staking.refetch();
  }, [staking.refetch]);

  const tabs: { id: Tab; label: string; icon: typeof Store }[] = useMemo(
    () => [
      { id: "market", label: "Marketplace", icon: Store },
      { id: "staking", label: "Staking", icon: Lock },
    ],
    []
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 font-ui text-[11px] font-bold ${
              tab === t.id
                ? "title-grad text-ice"
                : "bevel-out bg-wgray text-coal hover:bg-[#cdcdcd]"
            }`}
          >
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "market" && <MarketplaceView address={address} />}
      {tab === "staking" && (
        <StakingView
          address={address}
          staking={staking}
          stakingW={stakingW}
          activity={activity}
          setMsg={setMsg}
          onChanged={refetchStaking}
        />
      )}

      {msg ? (
        <p className="bevel-in-thin mt-3 bg-[#061512] px-2 py-1.5 font-mono text-[11px] text-aqua">{msg}</p>
      ) : null}
    </div>
  );
}
