# Terminology

This document defines the official terminology for the Ritual Arena product. Use these terms consistently in code, docs, UI, and external communication.

## Official Terms

### Product
- **Ritual Arena** — The full product name. Never "Anthem Arena", "RPG", or any other variant.
- **Ritual Chain** — The L1 chain where contracts are deployed. (chainId 1979)

### Identity
- **Identity Card** — An onchain NFT that represents a user's presence in Ritual Arena. Created via forge.
- **Forge** — The act of creating an Identity Card.
- **Card Snapshot** — The onchain record of an Identity Card's `currentPower`, `currentRarity`, and version.
- **Identity Registry** — Onchain registry that is the **single source of truth** for Identity Score, rank, and component snapshots.
- **Pack** — An on-chain purchase that mints 1–5 RitualPackNFT cards to the buyer's wallet.

### Cards
- **RitualPackNFT** — The on-chain NFT contract that represents a single card. Each tokenId has a 6-field `cardData` struct (`cardId`, `rarity`, `serial`, `role`, `season`, `mintedAt`) and a per-card `maxSupply` cap.
- **Card Pool** — The 254-card pool indexed by `cardId`. Each pool entry has its own rarity, role, and serial range.
- **Initiate Pack** — 50 AP pack. Common drop (70% Initiate rarity). The entry-tier product.
- **Ritual Pack** — 75 AP pack. Higher rarity (5% Ritualist / 15% Ritty / 30% Bitty / 50% Ascendant).

### Progression
- **Training** — Train an Identity Card to gain XP, AP, and power.
- **AP (Arena Points)** — Currency earned through Training and Arena activity. Used to back cards in Arena and to buy packs.
- **Identity Score** — A composite number (0–10,000) derived from Training, Arena, Achievements, and Collection. Powers the leaderboard.
- **Identity Rank** — A categorical tier derived from the normalized Identity Score: `INITIATE` → `ASCENDANT` → `BITTY` → `RITTY` → `RITUALIST` → `RADIANT RITUALIST`.
- **Achievement** — A discrete milestone unlocked by onchain activity. Tracked in `AchievementRegistry`.

### Competition
- **Arena** — The competitive match system. The only place where AP is spent (as backing).
- **Match** — A single Arena competition between two Identity Cards. Lasts 24 hours (BATTLE_DURATION = 86400 sec).
- **Back** — The verb for supporting a card with AP. "Back Card A" = vote for Card A.
- **Pool A / Pool B** — The accumulated AP backing each side of a Match.
- **Settlement** — The act of resolving a Match after it expires. Determines the winner.
- **Claim** — Calling `claimVotedAP` to receive AP payout for backing the winning side.

### Economy
- **Staking** — Locking RITUAL tokens for AP yield (150 AP/RITUAL/day, 14-day lock). Staking does not affect Identity Score.
- **Marketplace** — On-chain venue for trading RitualPackNFT cards. Built on `RitualMarketplace`.
- **Listing** — An offer to sell a specific RitualPackNFT for a specific AP price. Costs 1 AP fee (burned) to create.
- **Escrow** — The Marketplace contract holds the seller's NFT during an active listing, releasing it atomically when a buyer pays.
- **Recycle Bin** — On-chain NFT deflation sink. Players burn unwanted cards to mint AP by rarity tier (Common → 5 AP up to Mythic → 500 AP). Card slots are permanently destroyed (true deflation).

## Banned Terms

The following terms must NOT appear in user-facing copy, code comments, or product documentation:

| Banned Term | Reason |
|---|---|
| RPG | Not a role-playing game |
| GameFi | Not positioned as GameFi |
| platform | Internal wording, not product copy |
| progression platform | Internal wording, not product copy |
| reads your wallet | Internal wording, not product copy |
| X identity | Internal wording, not product copy |
| prove your reputation | Internal wording, not product copy |
| Arena Match | Use "Match" (a single Arena competition) or "Arena" (the system) |
| climb Ritual Chain | Use "build your rank" or "build through Identity Ranks" |
| climb | Use "build" or "grow" |
| experimental | Production product |
| beta prototype | Production product |
| challenge-based Arena | Arena is match-based, not challenge-based |
| pack-based identity minting | Identity Cards are forged, not from packs |
| Card Imprint | Archived in V9. Use "RitualPackNFT" or "card" |
| Imprint Marketplace | Archived in V9. Use "Marketplace" or "RitualMarketplace" |
| Imprint Score | Archived. Use "Collection Score" |
| Indonesian text | Use English only (e.g. "h/m/s" not "j/m/d", "wallet" not "dompet") |

## File Naming (current)

| Filename | Notes |
|---|---|
| `contracts/identity/IdentityCard.sol` | contract name `RitualAnthem` (preserved for bytecode) |
| `contracts/arena/RitualArena.sol` | contract name `AnthemArenaV4` (preserved for bytecode) |
| `contracts/training/RitualTraining.sol` | contract name `RitualTraining` (preserved) |
| `contracts/staking/RitualStaking.sol` | contract name `RitualStaking` (preserved) |
| `contracts/pack/RitualPackNFT.sol` | contract name `RitualPackNFT` |
| `contracts/pack/PackManager.sol` | contract name `PackManager` |
| `contracts/marketplace/RitualMarketplace.sol` | contract name `RitualMarketplace` |
| `contracts/burner/CardBurner.sol` | contract name `CardBurner` |
| `contracts/registry/IdentityRegistry.sol` | contract name `IdentityRegistry` |
| `contracts/registry/AchievementRegistry.sol` | contract name `AchievementRegistry` |
| `contracts/RitualAP.sol` | contract name `RitualAP` |

> **Why contract names are NOT renamed**: Changing `contract X is` to `contract Y is` would produce different compiled bytecode, which would not match the deployed address. The bytecode hash of a deployed contract is determined by the Solidity source. We preserve deployed addresses by keeping the contract name. The **public-facing** name is "Identity Card" / "Arena" / "Pack"; the in-source contract identifier is just the bytecode-stable handle.
