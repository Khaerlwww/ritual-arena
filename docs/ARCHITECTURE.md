# Architecture

Ritual Arena is a React + Solidity dApp on Ritual Chain testnet. The app talks directly to on-chain contracts through viem and uses Vercel serverless functions only for metadata, images, avatar proxying, IPFS helper routes, and forge attestations.

## High-Level Flow

```txt
Wallet
  → React/Vite frontend
  → viem RPC calls to Ritual Chain
  → Vercel API routes for metadata/image/forge helpers
```

## Core Systems

| System | Main files | Purpose |
|---|---|---|
| Identity | `IdentityCard.sol`, `IdentityRegistry.sol` | Mint identity, store score snapshot and rank |
| Training | `RitualTraining.sol` | XP, training score, power/rarity progression |
| Arena | `RitualArena.sol` | Battle creation, voting, settlement, arena score |
| Packs | `RitualPackNFT.sol`, `PackManager.sol` | Pack opening and card minting |
| Marketplace | `RitualMarketplace.sol` | NFT listing, escrow, AP fee |
| Staking | `RitualStaking.sol` | RITUAL staking and AP yield |
| Burn sink | `CardBurnerV2.sol` | Burn eligible cards for AP rewards |
| Automation | `ArenaAutomation.sol` | Optional automation helper |

## Identity Score

```txt
Training Score
+ Achievement Score
+ Arena Score
+ Collection Score
= Total Identity Score
```

Current target cap: `1000`.

Collection score is based on current RitualPackNFT card count and can be resynced by keeper.

## Frontend Layout

```txt
src/components/      UI windows and cards
src/hooks/           contract reads/writes
src/lib/             chain config, score helpers, time helpers
src/abi/             ABI slices used by hooks
api/                 public serverless routes
contracts/           active Solidity sources
```

## Contract Address Source

`src/lib/chains.ts` is the canonical frontend address source. It contains verified V11 addresses and avoids stale Vercel env-cache issues.

## Public Mirror Scope

This public repo intentionally keeps only current runtime source and public-safe docs. Historical contracts, private deploy scripts, local env files, seed wallets, and operational credentials are excluded.
