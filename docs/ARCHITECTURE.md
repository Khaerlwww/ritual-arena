# Architecture

## Overview

Ritual Arena is a single-page React app that talks directly to onchain contracts on Ritual Chain testnet. Vercel serverless functions serve NFT metadata, card images, and forge attestation.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                        │
│  src/components/RitualAnthemApp.tsx                          │
└──────────────────┬──────────────────────────┬───────────────┘
                   │                          │
       viem (direct RPC)              fetch (JSON)
                   │                          │
         ┌─────────▼─────────┐      ┌────────▼────────┐
         │  Public Client     │      │  Vercel API     │
         │  (reads, simulate) │      │  /api/*         │
         └─────────┬─────────┘      └────────┬────────┘
                   │                          │
         ┌─────────▼──────────────────────────▼────────┐
         │  Ritual Chain testnet (chainId 1979)         │
         │  RPC: https://rpc.ritualfoundation.org       │
         │  + Smart Contracts (Solidity 0.8.24)         │
         └──────────────────────────────────────────────┘
```

## Active Systems

| System | Path | Purpose |
|---|---|---|
| RitualAP | `contracts/RitualAP.sol` | Single canonical AP ERC-20. Minter/burner roles wired to Training, Arena, Staking, PackManager, Marketplace. |
| IdentityCard | `contracts/identity/IdentityCard.sol` | NFT, forge flow, identity snapshot, Collection Score source. |
| Training | `contracts/training/RitualTraining.sol` | Train Identity Card, earn AP + XP, auto-evolve power and rarity. |
| Arena | `contracts/arena/RitualArena.sol` | Timed match, AP voting, settlement, payout. |
| AchievementRegistry | `contracts/registry/AchievementRegistry.sol` | One-time achievements, Achievement Score source. |
| IdentityRegistry | `contracts/registry/IdentityRegistry.sol` | Canonical store of 4 score components + derived totalScore + rank. |
| RitualStaking | `contracts/staking/RitualStaking.sol` | RITUAL staking, AP yield (no impact on ranking). ms-aware timestamps via `_now()`. |
| RitualPackNFT | `contracts/pack/RitualPackNFT.sol` | Card NFT with 6-field cardData + per-card maxSupply. |
| PackManager | `contracts/pack/PackManager.sol` | Pack sales + on-chain RNG mint. Drives Collection Score through pack ownership. |
| RitualMarketplace | `contracts/marketplace/RitualMarketplace.sol` | On-chain marketplace for RitualPackNFT. 1 AP burned on list. |

## Data Flow

### Forge

```
1. User fills forge form
   └─> src/components/RitualAnthemApp.tsx

2. POST /api/attestation
   └─> api/attestation.js
       └─> EIP-712 sign with ATTESTATION_PRIVATE_KEY
       └─> returns { signature, expiry, nonce }
       └─> expiry + nonce must be in MS (Ritual Chain block.timestamp is MS)

3. walletClient.writeContract(mintAnthem)
   └─> src/hooks/useAnthem.ts
       └─> ensureAccount() + ensureRitualChain() (one prompt each)
       └─> publicClient.simulateContract (sanity)
       └─> writeContract (one popup)

4. Receipt parsed
   └─> IdentityCard._pushCollectionScore()  →  IdentityRegistry.updateCollection()
   └─> IdentityRegistry auto-derives totalScore + rank
   └─> emit IdentityScoreUpdated
   └─> frontend refetches gallery + leaderboard
```

### Train

```
1. User clicks Train
   └─> useTraining.train()
       └─> writeContract (gas estimate × 1.3 for OOG headroom)
       └─> Training reads XP, awards AP
       └─> Training calls autoEvolveSnapshot() on IdentityCard
       └─> IdentityCard._pushCollectionScore()
       └─> Training pushes updateTraining() to IdentityRegistry
       └─> IdentityRegistry auto-derives totalScore + rank
       └─> emit { type: 'ap-changed' } + { type: 'identity-changed' } via event bus
```

### Arena

```
1. Keeper calls scheduleBatch
   └─> Arena creates Match { walletA, walletB, powerA, powerB }

2. Users back sides with AP
   └─> Arena.voteAP(id, forA, amount)
       └─> AP deducted from voter
       └─> Pool increases
       └─> Arena._addArenaScore()  →  IdentityRegistry.updateArena()

3. After BATTLE_DURATION, anyone settles
   └─> Arena.settle(id)
       └─> Determine winner (AP-weighted power handicap)
       └─> Mark settled

4. Backers claim AP
   └─> Arena.claimVotedAP(id)
```

### Pack open

```
1. User clicks "Open Pack"
   └─> useOpenPack.open()
       └─> AP.approve(PackManager, cost) — one-time per (user, PM) pair
       └─> PackManager.initiatePack() or ritualPack()
       └─> Internal RNG rolls 1–5 cards, each with rarity from on-chain BPS
       └─> RitualPackNFT.mintBatch() — packs 3 cards into tokens
       └─> AP.transferFrom(user → treasury or burn) — pack cost settled

2. Receipt parsed
   └─> emit PackOpenedBatch event with tokenIds + cardIds
   └─> useOwnedPackNFTs + usePackCardDataMap refetch via on-chain watch
```

### Marketplace list / buy

```
LIST:
1. User picks card + price
   └─> useMarketplaceActions.list(packNft, tokenId, priceAp, 0)
       └─> AP.approve(Marketplace, 1e18) — for the 1 AP listing fee
       └─> Marketplace.list(packNft, tokenId, priceAp, expiry=0)
           └─> AP.transferFrom(seller → 0xdead) — burn 1 AP fee
           └─> NFT.transferFrom(seller → marketplace escrow)
       └─> emit { type: 'listing-changed' } + { type: 'ap-changed' }

BUY:
1. User confirms buy
   └─> useMarketplaceActions.buy(listingId, priceAp)
       └─> AP.approve(Marketplace, priceAp)
       └─> Marketplace.buy(listingId)
           └─> AP.transferFrom(buyer → seller)
           └─> NFT.transferFrom(escrow → buyer) — atomic
       └─> emit { type: 'listing-changed' } + { type: 'nft-changed' } + { type: 'ap-changed' }
```

### Identity Score (canonical, auto-derived)

```
                       ┌──────────────────────────────┐
Training        ───────┤                              │
Arena           ───────┤  IdentityRegistry (canonical)│
Achievement     ───────┤  ─ totalScore = sum          │ ← Frontend (30s poll + event bus)
Collection      ───────┤  ─ rank = rankForScore(...)  │
                       │  ─ indexedWallets[]          │
                       └──────────────────────────────┘
```

Read paths in the frontend use `indexedLength()` + `getIndexedWallets(0, N)` + `getIdentity(wallet)` only. No local ranking.

## Frontend Layout

```
src/
├── components/
│   ├── AnthemCard.tsx                # canonical card display (Profile, Forge, Marketplace)
│   ├── RitualAnthemApp.tsx           # main shell, desktop UI, onboarding, forge orchestration
│   ├── RitualDocsWindow.tsx          # in-app player docs
│   ├── OnboardingOverlay.tsx         # first-time onboarding modal
│   ├── StatusHUD.tsx                 # system status pill
│   ├── SystemInfo.tsx                # System Info window
│   ├── RetentionNotifications.tsx    # retention notifications
│   ├── desktop.tsx                   # win2k retro desktop chrome
│   ├── win2k.tsx                     # window chrome primitives
│   ├── Logo.tsx                      # RitualMark SVG
│   ├── ForgeSuccessModal.tsx         # post-forge success modal
│   ├── card/
│   │   └── VisualEvolutionEffects.tsx # card-level visual unlocks
│   ├── pack/
│   │   ├── PackCard.tsx
│   │   ├── PackOpeningAnimation.tsx
│   │   └── CollectionCard.tsx
│   └── progress/
│       ├── AnthemArenaWindow.tsx
│       ├── CollectionGalleryWindow.tsx
│       ├── IdentityProfileWindow.tsx
│       ├── MarketWindow.tsx          # Marketplace + Staking tabs
│       ├── PackWindow.tsx
│       ├── TrainingWindow.tsx
│       └── XPControlPanelWindow.tsx
├── hooks/
│   ├── useAnthem.ts                  # Identity Card reads + writes (mint, attest)
│   ├── useArena.ts                   # Arena reads + writes (vote, settle, claim)
│   ├── useTraining.ts                # Training reads + writes
│   ├── useStaking.ts                 # Staking reads + writes + position management
│   ├── useStakingActivity.ts         # Global staking event feed (Staked/Claim/Unstaked)
│   ├── usePacks.ts                   # Pack inventory + metadata
│   ├── useOpenPack.ts                # Pack open write (approve + initiatePack + parse events)
│   ├── useOwnedPackNFTs.ts           # My RitualPackNFT holdings (multicall read)
│   ├── usePackCardDataMap.ts         # Batched card data for any tokenId list
│   ├── useMarketplaceListings.ts     # All on-chain listings + watch events
│   ├── useMarketplaceActions.ts      # List / buy / cancel writes
│   ├── useAchievements.ts            # Achievement reads + writes
│   ├── useAPBalance.ts               # AP balance + on-chain Transfer watch
│   ├── usePower.ts                   # Power/rarity reads
│   ├── usePublicCardSnapshots.ts     # public CardSnapshot reads
│   ├── useIdentityRegistry.ts        # IdentityRegistry reads (profile source)
│   └── useIdentityLeaderboard.ts     # IdentityRegistry-based global leaderboard
├── lib/
│   ├── chains.ts                     # chain config + contract addresses (canonical)
│   ├── wallet.ts                     # shared wallet controller (one connect per session)
│   ├── eventBus.ts                   # typed event bus for cross-hook invalidation
│   ├── cardImage.ts                  # canvas-based card renderer (used by /api/card-image too)
│   ├── ipfs.ts                       # IPFS upload proxy
│   ├── attestation.ts                # EIP-712 forge signing client
│   ├── identityEngine.ts             # frontend-side Identity Score breakdown
│   ├── achievementEngine.ts          # achievement definitions + scoring
│   ├── visualEvolution.ts            # card-level visual unlocks (driven by trainingLevel)
│   ├── forgeSnapshot.ts              # forge snapshot shape + build
│   ├── rarity.ts                     # grade labels
│   ├── ritualTime.ts                 # ms-vs-sec timestamp helper (auto-detect)
│   └── ...                           # audio, dailyStreak, xpEngine, powerEngine, etc.
├── abi/                              # auto-generated contract ABIs (committed for stable imports)
└── vite-env.d.ts                     # Vite env var type defs
```

## Smart Contract Layout

```
contracts/
├── RitualAP.sol                     # AP ERC-20 (single canonical token)
├── identity/IdentityCard.sol        # NFT, forge flow, identity snapshot, Collection Score
├── arena/RitualArena.sol            # timed match, AP voting, settlement, payout
├── training/RitualTraining.sol      # train → XP, AP, auto-evolve power and rarity
├── staking/RitualStaking.sol        # RITUAL stake → AP yield (no ranking impact)
├── pack/RitualPackNFT.sol           # card NFT (6-field cardData, per-card maxSupply)
├── pack/PackManager.sol             # pack sales, on-chain RNG mint, BPS rarity
├── marketplace/RitualMarketplace.sol # on-chain marketplace, 1 AP burn on list
├── registry/IdentityRegistry.sol    # canonical: 4 score components, totalScore, rank
├── registry/AchievementRegistry.sol # one-time achievements
├── archive/                         # deprecated contracts (NOT IMPORTED by active code)
│   ├── imprint/                     # legacy CardImprint (Collection Score pre-V9)
│   └── ...
├── mocks/                           # test helpers
└── test/                            # in-source contract tests
```

> **Contract name preservation**: The Solidity `contract X is` declarations are kept as-is (e.g. `contract RitualAnthem is`, `contract AnthemArenaV4 is`). Renaming would change the compiled bytecode hash and break deployed addresses. The public-facing product names are "Identity Card", "Arena", "Pack"; the in-source contract identifier remains for bytecode stability.

## API Layer (Vercel serverless)

```
api/
├── attestation.js    # POST: EIP-712 forge signing (expiry/nonce in MS)
├── card-image.js     # GET:  dynamic PNG via canvas renderer
├── card-image/
│   └── [tokenId].js  # GET:  same as above with tokenId path param
├── ipfs.js           # POST: IPFS upload proxy (Pinata)
├── metadata.js       # GET:  ERC-721 OpenSea metadata
├── metadata/
│   └── [tokenId].js  # GET:  same as above with tokenId path param
├── pack/             # GET:  pack metadata helpers
└── proxy-avatar.js   # GET:  Discord avatar CORS proxy
```

`vercel.json` routes `/api/*` to serverless functions, `/*` to the SPA.

## Build Pipeline

```
Source (.ts/.tsx, .sol)
    ↓
npm run build
  ├── tsc (type check via prebuild hook)
  └── vite build
    ↓
dist/ (HTML + JS chunks)
    ↓
npx vercel --prod
    ↓
https://ritual-arenav0.vercel.app
```

## Network

- **Ritual Chain testnet** (chainId 1979)
- RPC: `https://rpc.ritualfoundation.org`
- Explorer: `https://explorer.ritualfoundation.org`
- Faucet: `https://faucet.ritualfoundation.org`
- Native token: RITUAL

> **Timestamp quirk**: `block.timestamp` on Ritual Chain is in **milliseconds**, not seconds. All onchain time math uses a `_now() = block.timestamp / 1000` helper in contracts that store timestamps for later comparison (e.g. RitualStaking). Frontend reads ms-aware values via auto-detect: `raw > 1e12 ? raw : raw * 1000` — see `src/lib/ritualTime.ts` and the `_now()` helper in `contracts/staking/RitualStaking.sol`.
