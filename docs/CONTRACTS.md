# Contracts

All active contracts are deployed on **Ritual Chain testnet** (`chainId 1979`).

Canonical frontend source: `src/lib/chains.ts`.

## Active V11 Addresses

| Contract | Source | Address |
|---|---|---|
| RitualAP | `contracts/RitualAP.sol` | `0x1d24252bf89557c6Da4293a94Bfa6F69f85B407D` |
| IdentityRegistry | `contracts/registry/IdentityRegistry.sol` | `0x8f4Cb00142979A19997fF90d39FE7839335186bC` |
| IdentityCard / RitualAnthem | `contracts/identity/IdentityCard.sol` | `0xe189382845FF8C938E85ce7E25eB5c89F339ff5E` |
| AchievementRegistry | `contracts/registry/AchievementRegistry.sol` | `0xa0BE4F8091b0bF3F170a643890c330274465E225` |
| RitualTraining | `contracts/training/RitualTraining.sol` | `0xFcD88A76c6147c527c88FBD48d0f97733A96567A` |
| RitualArena | `contracts/arena/RitualArena.sol` | `0x003cf5a69920Db892BFe6Eb2154f5CE76bF5060E` |
| RitualStaking | `contracts/staking/RitualStaking.sol` | `0xcF2c42076219c2CD426Befe982D6abFE6402ad78` |
| RitualPackNFT | `contracts/pack/RitualPackNFT.sol` | `0x2939c908C456f794cD3eB3c5f5197831a497e9A9` |
| PackManager | `contracts/pack/PackManager.sol` | `0x8D6bDcD293C856D3ACf6c82a5E0Fd54536293A5B` |
| RitualMarketplace | `contracts/marketplace/RitualMarketplace.sol` | `0x75dfe1430237269eC6b575F43595B4e565443e22` |
| CardBurnerV2 | `contracts/burner/CardBurnerV2.sol` | `0x99144aebBF3042493e85B5BEb9bBdddf84d138EC` |

## Score Model

`IdentityRegistry` stores four score components:

```txt
trainingScore + achievementScore + arenaScore + collectionScore = totalScore
```

Caps:

| Component | Cap |
|---|---:|
| Training | 400 |
| Achievement | 300 |
| Arena | 200 |
| Collection | 100 |
| Total | 1000 |

Collection score is card-count based:

```txt
collectionScore = RitualPackNFT.balanceOf(wallet), capped by IdentityRegistry
```

A keeper can resync collection score from inventory when legacy writers or stale data create drift.

## Runtime Notes

- Ritual Chain timestamps may be millisecond-style. Frontend uses `src/lib/ritualTime.ts` to normalize raw timestamps.
- `Multicall3` is not relied on by the frontend; hooks use direct reads.
- Public repo keeps active source only. Historical/archive contracts live outside this mirror.
