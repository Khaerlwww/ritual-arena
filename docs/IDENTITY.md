# Identity System

Ritual Arena uses **one canonical Identity Score scale: 0–1,000**.

The source of truth is `IdentityRegistry.sol`. The frontend must display the same values returned by:

```solidity
getIdentity(address wallet) → IdentitySnapshot
```

There is **no 10,000-point score model** in the live contracts.

---

## Identity Score

`totalScore` is the sum of 4 capped components:

| Component | Source | Max | Weight |
|---|---|---:|---:|
| Training Score | `RitualTraining.train()` | 400 | 40% |
| Achievement Score | `AchievementRegistry.unlockAchievement()` | 300 | 30% |
| Arena Score | `RitualArena` settlement flow | 200 | 20% |
| Collection Score | `IdentityCard` / `PackManager` / inventory sync | 100 | 10% |
| **Total** | auto-derived in `IdentityRegistry` | **1,000** | **100%** |

Each component is capped independently in `IdentityRegistry`:

```solidity
MAX_TRAINING_SCORE    = 400
MAX_ACHIEVEMENT_SCORE = 300
MAX_ARENA_SCORE       = 200
MAX_COLLECTION_SCORE  = 100
MAX_TOTAL_SCORE       = 1_000
```

---

## Rank Score

There is **no normalization step**.

```txt
rankScore = totalScore
```

`totalScore` is already in the 0–1,000 range.

| Rank Score | Rank |
|---:|---|
| 0–99 | INITIATE |
| 100–249 | ASCENDANT |
| 250–449 | BITTY |
| 450–699 | RITTY |
| 700–899 | RITUALIST |
| 900–1000 | RADIANT RITUALIST |

The registry derives rank through:

```solidity
rankForScore(totalScore)
```

---

## Example

Example wallet:

| Component | Value |
|---|---:|
| Training Score | 250 |
| Achievement Score | 180 |
| Arena Score | 60 |
| Collection Score | 23 |
| **Total** | **513** |
| **Rank Score** | **513** |
| **Rank** | **RITTY** |

Because:

```txt
250 + 180 + 60 + 23 = 513
513 is in 450–699 → RITTY
```

---

## Collection Score

Collection Score is capped at **100**.

There are two on-chain sources that can push collection score:

### 1. Pack inventory source — current primary behavior

`PackManager._pushCollectionScore(user)` uses current PackNFT inventory:

```solidity
score = min(PackNFT.balanceOf(user), 100)
```

The collection sync keeper uses the same inventory rule so registry state does not stay stale.

### 2. IdentityCard legacy forge/evolve source

`IdentityCard._calcCollectionScore(wallet)` remains in the contract for forge/evolve snapshot pushes and stays in the same 0–100 scale:

```txt
powerComponent  = min(currentPower * 0.6, 60)
rarityComponent = min(currentRarity * 7.5, 30)
countComponent  = min(identityCardBalance, 10)
total           = min(power + rarity + count, 100)
```

When PackManager/inventory sync runs, it can overwrite collection score with the current inventory score.

---

## Values Displayed by UI / APIs

All profile, leaderboard, metadata, and card image surfaces should read from the same registry snapshot:

| Field | Source |
|---|---|
| `totalScore` | `getIdentity(wallet).totalScore` |
| `rank` | `getIdentity(wallet).rank` |
| `trainingScore` | `getIdentity(wallet).trainingScore` |
| `achievementScore` | `getIdentity(wallet).achievementScore` |
| `arenaScore` | `getIdentity(wallet).arenaScore` |
| `collectionScore` | `getIdentity(wallet).collectionScore` |
| `trainingLevel` | `getIdentity(wallet).trainingLevel` |
| `currentPower` | `getIdentity(wallet).currentPower` |
| `currentRarity` | `getIdentity(wallet).currentRarity` |
| `totalXp` | `getIdentity(wallet).totalXp` |

---

## Leaderboard

Leaderboard reads indexed wallets from `IdentityRegistry`:

```solidity
indexedLength() → uint256
getIndexedWallets(offset, limit) → address[]
getIdentity(wallet) → IdentitySnapshot
```

Sorting rule:

```txt
sort by totalScore descending
```

There is no off-chain score formula and no staking multiplier.

Leaderboard can update after:

- forge / card snapshot push
- train
- arena settlement
- achievement unlock
- pack open
- inventory sync keeper

---

## Staking is NOT Identity Score

`RitualStaking` only affects AP yield/balance.

It does **not** modify:

```txt
totalScore
rank
leaderboard position
```
