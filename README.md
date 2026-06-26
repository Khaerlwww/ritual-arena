# Ritual Arena

> On-chain identity game on Ritual Chain testnet: forge an identity, train it, collect cards, battle in Arena, stake RITUAL, and grow Identity Score.

## Features

- **Forge Identity** — Mint a Ritual Anthem / Identity Card.
- **Train** — Earn XP and Training Score.
- **Open Packs** — Spend AP to mint RitualPackNFT cards.
- **Collection Score** — Card-count score from PackNFT ownership.
- **Arena** — Battle, vote with AP, and climb the leaderboard.
- **Staking** — Stake RITUAL to earn AP.
- **Recycle Cards** — Burn eligible cards for AP rewards.

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Web3**: viem, direct Ritual Chain RPC reads/writes
- **Contracts**: Solidity 0.8.24, Hardhat, OpenZeppelin
- **API**: Vercel serverless functions for forge, metadata, images, IPFS, and avatar proxy
- **Styling**: Tailwind CSS

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
npm run build
```

The frontend uses canonical V11 fallback addresses in `src/lib/chains.ts`. Env vars are optional overrides/documentation; do not commit real secrets.

## Active V11 Contracts

| Contract | Purpose |
|---|---|
| `RitualAP` | AP token used across training, arena, packs, marketplace, staking, and burner flows |
| `IdentityRegistry` | Canonical score snapshot: training, achievement, arena, collection, total, rank |
| `RitualAnthem` / `IdentityCard` | Identity NFT and snapshot surface |
| `AchievementRegistry` | Achievement score updates |
| `RitualTraining` | XP, training score, power/rarity progression |
| `RitualArena` | Battle creation, AP voting, settlement, arena score |
| `RitualStaking` | Stake RITUAL and earn AP |
| `RitualPackNFT` | NFT card contract |
| `PackManager` | Pack opening and card minting |
| `RitualMarketplace` | Listings, escrow, AP listing fee |
| `CardBurnerV2` | Burn eligible cards for AP rewards |
| `ArenaAutomation` | Optional automation helper contract |

Current canonical addresses are documented in [`docs/CONTRACTS.md`](docs/CONTRACTS.md).

## Project Structure

```txt
src/                  React frontend
api/                  Vercel serverless functions
contracts/            Current Solidity sources only
deployments/current/  Public-safe deployment metadata
docs/                 Public docs
public/               Static assets
```

This public repo intentionally excludes private ops files, seed wallets, local env files, and historical/debug contracts.

## Scripts

```bash
npm run lint       # TypeScript check
npm run build      # Production build
npm run compile    # Hardhat compile
npm run test       # Contract tests
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md)
- [`docs/IDENTITY.md`](docs/IDENTITY.md)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/API.md`](docs/API.md)
- [`SECURITY.md`](SECURITY.md)

## Security

Never commit real secrets, private keys, seed wallet files, or API tokens. Use local-only env files for private deployments.

## License

MIT — see [LICENSE](LICENSE).
