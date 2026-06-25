# Ritual Arena

> A self-sovereign identity protocol for community-driven NFT collections.

Ritual Arena is a complete on-chain identity system that lets users forge a personal
identity card, train it through community interaction, and compete in a peer-driven
arena — all powered by ERC-721 NFTs and an ERC-20 reputation token.

## Features

- **Forge identity** — Mint a unique identity NFT tied to your wallet
- **Train** — Stake RITUAL to earn XP, level up, and evolve power
- **Open packs** — Spend AP to mint NFT editions from a rarity-weighted pool
- **Burn** — Sacrifice editions for AP based on rarity
- **Arena** — Match into battles, vote with AP, climb the leaderboard
- **Staking** — Stake RITUAL to earn AP passively

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Web3**: viem (no ethers.js), EIP-712 signed forge attestations
- **Smart Contracts**: Solidity 0.8.24, Hardhat, OpenZeppelin
- **Backend**: 9 Vercel serverless functions (Node 22)
- **Styling**: Tailwind CSS

## Quick Start

```bash
# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your contract addresses

# Develop
npm run dev

# Build
npm run build
```

## Project Structure

```
ritual-arena/
├── src/                 # React frontend
│   ├── components/      # UI components
│   ├── hooks/           # Web3 React hooks
│   ├── lib/             # Helpers (chains, ABI, power engine, etc.)
│   ├── abi/             # Contract ABIs
│   ├── types/           # TypeScript types
│   └── shared/          # Shared code (worker, etc.)
│
├── api/                 # Vercel serverless functions
│   ├── forge.js         # EIP-712 forge attestation signer
│   ├── card-image.js    # NFT card image renderer
│   ├── metadata.js      # ERC-721 metadata
│   ├── pack/            # Pack NFT endpoints
│   ├── ipfs.js          # IPFS upload proxy
│   └── proxy-avatar.js  # Discord avatar proxy
│
├── contracts/           # Solidity sources
│   ├── identity/        # IdentityCard (forge, snapshot)
│   ├── pack/            # PackManager, RitualPackNFT
│   ├── arena/           # RitualArena (battle system)
│   ├── staking/         # RitualStaking (AP rewards)
│   ├── registry/        # IdentityRegistry (score snapshot)
│   ├── burner/          # CardBurner (NFT → AP sink)
│   ├── marketplace/     # RitualMarketplace
│   └── training/        # RitualTraining (XP, level)
│
├── public/              # Static FE assets
│
├── docs/                # User-facing documentation
│
├── test/                # Test suites
│
├── hardhat.config.cjs   # Hardhat config
├── vercel.json          # Vercel build config
├── vite.config.ts       # Vite config
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── postcss.config.cjs
```

## Smart Contracts (11 total)

| Contract | Purpose |
|----------|---------|
| `RitualAnthem` (IdentityCard) | Soulbound identity NFT, snapshot evolution |
| `RitualAP` | Reputation token, mintable by stakers/keepers |
| `IdentityRegistry` | Score snapshot, trusted updaters |
| `AchievementRegistry` | On-chain achievements |
| `RitualTraining` | XP/level per tokenId, 20h cooldown |
| `RitualArena` | Battle creation, voting, settlement |
| `RitualStaking` | Stake RITUAL, earn AP |
| `RitualPackNFT` | Pack NFT (ERC-721) |
| `PackManager` | Pack open, rarity-weighted RNG |
| `RitualMarketplace` | Listings, escrow, fees |
| `CardBurner` / `CardBurnerV2` | Burn NFT → AP (per-rarity rewards) |

## How to Deploy

This repository is the **runtime** — for production deployment, you'll need:

1. A deployer EOA with ETH/RITUAL for gas
2. Set up `.env.admin.local` with `PRIVATE_KEY=...` (never commit)
3. Run Hardhat scripts to deploy contracts to your target chain
4. Update `.env` with the deployed contract addresses
5. Deploy frontend to Vercel (or any static host)

For operational tooling (admin scripts, seed scripts, deployment records),
see the separate private repository.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — System design
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — Smart contract reference
- [`docs/IDENTITY.md`](docs/IDENTITY.md) — Identity card mechanics
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — How to deploy
- [`docs/API.md`](docs/API.md) — Serverless function reference
- [`docs/SECURITY.md`](docs/SECURITY.md) — Security model

## License

MIT — see [LICENSE](LICENSE).

## Contributing

PRs welcome. For security issues, please email directly (not via public issue tracker).
