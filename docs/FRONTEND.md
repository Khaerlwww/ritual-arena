# Frontend

The frontend is a React 18 + TypeScript single-page application built with Vite 6. State management uses React hooks (no Redux/Zustand) and a typed event bus for cross-hook invalidation. All blockchain interactions go through `viem` (no wagmi).

## Entry Point

`src/main.tsx` mounts `<RitualAnthemApp />` into `#root`.

## Main Shell

`src/components/RitualAnthemApp.tsx` contains:
- The win2k retro desktop shell + window manager
- Onboarding wizard (3 steps)
- Boot sequence (loading milestones)
- All top-level state (address, chainId, gallery, attestation, forge state, share modal, etc.)
- Forge flow orchestration (mint, attest, success modal, share on X)
- The About, Identity Cards, Profile, Training, Arena, Marketplace, Packs, Staking, Docs, and System Info windows

Heavy components (AnthemArenaWindow, TrainingWindow, MarketWindow, PackWindow, IdentityProfileWindow, RitualDocsWindow) are lazy-loaded via `React.lazy()` for code-splitting.

## Hooks

| Hook | Purpose |
|---|---|
| `useAnthem.ts` | Wallet connect, Identity Card reads, `mintAnthem` write |
| `useArena.ts` | Match reads (battles, leaderboard, activity, profile), writes (voteAP, settle, claim) |
| `useIdentityLeaderboard.ts` | Global leaderboard from `IdentityRegistry` (30s poll) |
| `useIdentityRegistry.ts` | Profile reads (totalScore, rank, components) |
| `useTraining.ts` | Training reads + `train` write (with event bus refetch) |
| `useStaking.ts` | Stake positions + `stake` / `unstake` / `claimAP` / `claimAllAP` writes |
| `useStakingActivity.ts` | Global staking event feed (Staked / RewardsClaimed / Unstaked, last 50) |
| `usePacks.ts` | Pack inventory + metadata |
| `useOpenPack.ts` | Pack open write (AP approve + `initiatePack` / `ritualPack` + parse `PackOpenedBatch` event) |
| `useOwnedPackNFTs.ts` | My RitualPackNFT holdings via multicall (`cardData` + `mintedByCardId` + `maxSupplyOf`) |
| `usePackCardDataMap.ts` | Batched card data lookup for any list of tokenIds |
| `useMarketplaceListings.ts` | All on-chain listings + watch all marketplace events |
| `useMarketplaceActions.ts` | `list` / `buy` / `cancel` writes (with AP approve + escrow) |
| `useAchievements.ts` | Achievement reads + writes |
| `useAPBalance.ts` | AP balance + on-chain Transfer watch (event bus refetch) |
| `usePower.ts` | Power / rarity calculation helpers |
| `usePublicCardSnapshots.ts` | Public CardSnapshot reads |

The shared wallet controller in `src/lib/wallet.ts` provides:
- `getSharedWalletClient()` — singleton, one `eth_requestAccounts` per session
- `ensureAccount()` — returns account, prompts only if not connected
- `ensureRitualChain()` — single `wallet_switchEthereumChain` per session
- `subscribeSharedWallet()` / `resetSharedWallet()`

## Library

| File | Purpose |
|---|---|
| `lib/chains.ts` | Chain config + contract address constants (canonical source — overrides env vars) |
| `lib/wallet.ts` | Shared wallet controller |
| `lib/eventBus.ts` | Typed event bus for cross-hook invalidation (`emit` / `on` / `ap-changed` / `nft-changed` / `position-changed` / `identity-changed` / `listing-changed` / `tx-success`) |
| `lib/cardImage.ts` | Canvas card renderer (also used by `/api/card-image`) |
| `lib/anthem.ts` | Anthem generation (mood → genre/archetype/gradient/etc.) |
| `lib/attestation.ts` | EIP-712 forge attestation client helpers |
| `lib/ipfs.ts` | IPFS upload proxy + read |
| `lib/audio.ts` | Beat WAV synthesis |
| `lib/identityEngine.ts` | Identity Score breakdown (mirrors `IdentityRegistry` formulas) |
| `lib/achievementEngine.ts` | Achievement definitions + scoring |
| `lib/visualEvolution.ts` | Card-level visual unlocks driven by `trainingLevel` |
| `lib/forgeSnapshot.ts` | Forge snapshot shape + builder |
| `lib/rarity.ts` | Rarity labels + rank-to-rarity conversion |
| `lib/ritualTime.ts` | ms-vs-sec timestamp helper (auto-detect via `> 1e12`) |
| `lib/dailyStreakEngine.ts` | Daily streak calculation |
| `lib/streakEngine.ts` | Streak helpers |
| `lib/xpEngine.ts` | XP/level calculation |
| `lib/powerEngine.ts` | Power calculation |
| `lib/packPool.ts` | 254-card pack pool loader |
| `lib/walletConnect.ts` | Wallet connection helpers |
| `lib/apFormat.ts` | AP wei ↔ human units formatter |

## State Management

Top-level state lives in `RitualAnthemApp.tsx` and is passed down via props. No global state library. Hooks own their domain state (cards, battles, snapshots). Cross-hook invalidation flows through the typed event bus.

### Event bus

After a write tx confirms, the write hook emits a domain event. Listening read hooks refetch automatically — no manual `refetch()` plumbing at call sites, no polling, no global state.

| Event type | Emitted by | Listened by |
|---|---|---|
| `ap-changed` | stake, claim, unstake, pack open, list, buy, mint | `useAPBalance` |
| `nft-changed` | pack open, buy, cancel | `useOwnedPackNFTs`, `usePackCardDataMap` |
| `position-changed` | stake, claim, unstake, emergency withdraw | `useStaking` |
| `identity-changed` | train, arena settlement | `useIdentityRegistry`, `useTraining` |
| `listing-changed` | list, buy, cancel | `useMarketplaceListings` |
| `tx-success` | any write | (available for future toast/notifications) |

Plus on-chain `watchContractEvent` in read hooks for changes from other users (admin mint, someone buying your listing, etc.).

## Wallet Flow

1. User clicks "Connect Wallet" in the title bar.
2. Shared wallet controller calls `eth_requestAccounts` (one popup per session).
3. `subscribeSharedWallet()` listens for `accountsChanged` and `chainChanged`.
4. All write hooks share the same `walletClient`; ensureAccount/ensureRitualChain guarantee one connect + one switchChain per session.

## Forge Flow

1. User enters handle, mood, lyrics, prompt in the forge form.
2. App calls `POST /api/attestation` → server returns EIP-712 `{ signature, expiry, nonce }`. Expiry and nonce are in **milliseconds** (Ritual Chain block.timestamp is MS).
3. App calls `mintAnthem` via shared `walletClient` (one popup).
4. IdentityCard auto-pushes `updateCollection()` to IdentityRegistry.
5. Receipt is parsed, gallery is refetched, **ForgeSuccessModal** appears with download + share-on-X buttons.

## Arena Flow

1. User opens Arena window.
2. `useArena` reads active battles via multicall, filters by `endTime > Date.now()` (MS-aware auto-detect).
3. If a match exists, it displays the match (cards, countdown, pools).
4. User backs a card → `useArena.voteAP` (one popup).
5. After 24h, anyone can call `settle` (no keeper required).
6. Winning supporters call `claimVotedAP`.

## Pack Open Flow

1. User opens a pack from PackWindow.
2. `useOpenPack.open()` calls `AP.approve(PackManager, apCost)` once per (user, PM) pair.
3. `PackManager.initiatePack()` or `ritualPack()` — pack cost settled via `AP.transferFrom(user → PackManager)` + on-chain RNG mints 1–5 cards.
4. `PackOpenedBatch` event decoded from the receipt gives the 3 tokenIds + cardIds.
5. `useOwnedPackNFTs` + `usePackCardDataMap` refetch via the event bus (`nft-changed` + `ap-changed`).
6. PackWindow shows the new cards in the open animation.

## Marketplace Flow

1. User opens MarketWindow Marketplace tab.
2. `useMarketplaceListings` lists all active listings via multicall + watches all marketplace events.
3. To list: user picks card + price → `AP.approve(Marketplace, 1e18)` → `Marketplace.list()` (burns 1 AP fee, escrows NFT).
4. To buy: user confirms → `AP.approve(Marketplace, priceAp)` → `Marketplace.buy()` (atomic AP transfer + NFT escrow release).
5. UI updates instantly via event bus (`ap-changed` + `nft-changed` + `listing-changed`).

## Identity Score Display

The `useIdentityRegistry` hook reads the canonical `IdentitySnapshot` for the connected wallet and provides `totalScore`, `rank`, and component scores. The leaderboard hook reads `indexedLength()` + `getIndexedWallets()` + `getIdentity()` from the same registry. **No client-side ranking logic.**

## Gas Headroom

Heavy transactions (pack open with up to 5 mints, training with auto-evolve) add +30% headroom on top of viem's `estimateContractGas`:

```ts
const gas = await publicClient.estimateContractGas(...).catch(() => 9_000_000n);
const hash = await walletClient.writeContract({ ..., gas: (gas * 130n) / 100n });
```

Without this, viem's tight estimate can cause OOG reverts with no error reason on the testnet.

## Styling

Tailwind CSS + a small set of custom utility classes (`bevel-out`, `bevel-in`, `bevel-in-thin`, `title-grad`, `win-btn`, etc.) for the win2k retro theme. Component-level classes via `className` props. No CSS modules.

## Build

```bash
npm run build
```

Produces:
- `dist/index.html`
- `dist/assets/*.js` (chunked by Vite)
- `dist/assets/*.css`

Vercel serves `dist/` as the production build. Serverless functions live in `api/`.

## Conventions

- **No external deps without a clear reason** — discuss new deps in the PR.
- **No reformatting of unrelated lines** in a focused PR.
- **No new CSS frameworks** — use the existing `bevel-*` / `title-grad` / `win-btn` classes.
- **No `any`** — the build runs `tsc --noEmit` and fails on `any`.
- **No external analytics, no marketing SDKs, no tracking pixels.**
- **English-only UI copy and comments** — no Indonesian in user-facing text or code comments.
- **All ms-aware timestamps** via the auto-detect pattern in `ritualTime.ts` (or `raw > 1e12 ? raw : raw * 1000` inline).
