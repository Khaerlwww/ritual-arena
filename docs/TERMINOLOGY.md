# Terminology

## Product Terms

| Term | Meaning |
|---|---|
| Ritual Chain | Testnet chain used by Ritual Arena (`chainId 1979`) |
| Identity Card / Ritual Anthem | User identity NFT minted by the forge flow |
| AP | In-game ERC-20 reputation/action token |
| Training Score | Score earned through training XP |
| Arena Score | Score earned through battle participation and settlement |
| Collection Score | Score from RitualPackNFT card count |
| Achievement Score | Score from on-chain achievements |
| RitualPackNFT | NFT card contract for pack cards |
| PackManager | Contract that opens packs and mints cards |
| CardBurnerV2 | Contract that burns eligible cards and mints AP rewards |
| RitualMarketplace | Contract for listings and escrow |

## Rarity Names

Use the current in-game rarity names everywhere in UI/docs:

```txt
INITIATE
BITTY
RITTY
RITUALIST
RADIANT
GENESIS
```

Do not use legacy rarity labels like Common/Rare/Epic/Legendary/Mythic in public UI.

## Source Names

Some Solidity contract identifiers are preserved for bytecode/source continuity, while public UI labels are cleaner.

| Source | Public label |
|---|---|
| `contracts/identity/IdentityCard.sol` | Identity Card / Ritual Anthem |
| `contracts/arena/RitualArena.sol` | Arena |
| `contracts/training/RitualTraining.sol` | Training |
| `contracts/staking/RitualStaking.sol` | Staking |
| `contracts/pack/RitualPackNFT.sol` | Card NFT |
| `contracts/pack/PackManager.sol` | Pack Manager |
| `contracts/marketplace/RitualMarketplace.sol` | Marketplace |
| `contracts/burner/CardBurnerV2.sol` | Card Recycler / Burner |
| `contracts/registry/IdentityRegistry.sol` | Identity Registry |
| `contracts/registry/AchievementRegistry.sol` | Achievement Registry |
| `contracts/RitualAP.sol` | AP Token |

## Public Repo Scope

This mirror contains active runtime source only. Deprecated prototypes and private operational files are intentionally excluded.
