# Identity System

Ritual Arena has a single canonical Identity Score model. The model is implemented identically in the `IdentityRegistry` contract and the frontend `lib/identityEngine.ts`. All component pushes, formulas, and rank thresholds are the same in both places.

## Identity Score

`totalScore` = sum of 4 components, capped at **10,000**.

| Component | Source | Max | Weight of total |
|---|---|---|---|
| Training Score | `RitualTraining.train()` | 4,000 | 40% |
| Achievement Score | `AchievementRegistry.unlockAchievement()` | 3,000 | 30% |
| Arena Score | `RitualArena.voteAP()` settlement flow | 2,000 | 20% |
| Collection Score | `IdentityCard._pushCollectionScore()` + `PackManager` mint pushes | 1,000 | 10% |
| **Total** | auto-derived | **10,000** | 100% |

Each component is independently **capped** to its max in the registry. The total is the sum of the (capped) components.

## Rank Score (normalized)

`rankScore = floor((totalScore * 1000) / 10000)` — always in `[0, 1000]`.

| Rank | rankScore range |
|---|---|
| INITIATE | 0–99 |
| ASCENDANT | 100–249 |
| BITTY | 250–449 |
| RITTY | 450–699 |
| RITUALIST | 700–899 |
| RADIANT RITUALIST | 900–1000 |

The rank is auto-derived by `rankForScore(totalScore)` in the registry.

## Example

A wallet that has forged an Identity Card (Collection Score 200 from power+rarity), trained (Power 50, level 5, 2500 XP, Training Score 2500), won 3 Arena matches (Arena Score 600), and unlocked 12 of 20 achievements (Achievement Score 1800):

| Component | Value |
|---|---|
| Training Score | 2,500 |
| Achievement Score | 1,800 |
| Arena Score | 600 |
| Collection Score | 200 |
| **Total** | **5,100** |
| Rank Score | `floor(5100 × 1000 / 10000) = 510` |
| **Rank** | **RITTY** (450–699) |

## Component Caps

| Component | Cap |
|---|---|
| Training | 4,000 |
| Achievement | 3,000 |
| Arena | 2,000 |
| Collection | 1,000 |
| Total | 10,000 |

`MAX_TRAINING_SCORE`, `MAX_ACHIEVEMENT_SCORE`, `MAX_ARENA_SCORE`, `MAX_COLLECTION_SCORE`, `MAX_TOTAL_SCORE` are public constants in `IdentityRegistry.sol`.

## Collection Score Formula

Implemented identically in `IdentityCard._calcCollectionScore()` and `PackManager._calcCollectionScoreForPackOwner()`:

```
powerComponent  = min(currentPower, 100) * 6        (max 600)
rarityComponent = min(currentRarity, 4) * 75        (max 300)
countComponent  = min(cardCount, 10) * 10           (max 100)
                ─────────────
total           = power + rarity + count, capped at 1000
```

## Where Each Value Comes From

| Field | Read from | Function |
|---|---|---|
| `totalScore` | IdentityRegistry | `getIdentity(wallet).totalScore` |
| `rank` (0..5) | IdentityRegistry | `getIdentity(wallet).rank` |
| `trainingLevel` | IdentityRegistry | `getIdentity(wallet).trainingLevel` |
| `currentPower` | IdentityRegistry | `getIdentity(wallet).currentPower` |
| `currentRarity` | IdentityRegistry | `getIdentity(wallet).currentRarity` |
| `totalXp` | IdentityRegistry | `getIdentity(wallet).totalXp` |

The frontend Profile, Leaderboard, Card Image API, and Metadata API all read from the same IdentityRegistry function (`getIdentity(wallet)`), so the values shown are guaranteed consistent.

## Leaderboard

```
indexedLength() → uint256
getIndexedWallets(offset, limit) → address[]
getIdentity(wallet) → IdentitySnapshot
```

Wallets are auto-indexed in `IdentityRegistry` on the first push. The leaderboard reads all indexed wallets, fetches each snapshot, and sorts by `totalScore` descending. No tie-breaking.

Leaderboard re-sorts automatically on:
- Forge (pushes Collection Score)
- Train (pushes Training Score)
- Arena settlement (pushes Arena Score)
- Achievement unlock (pushes Achievement Score)
- Pack open (pushes Collection Score)

The frontend polls every 30 seconds, so the leaderboard is at most 30 seconds behind the canonical onchain state.

## Staking is NOT in Identity Score

`RitualStaking` is intentionally not part of the Identity Score. The `stake` / `unstake` / `claimAP` functions only affect AP balance and yield. They do not modify `totalScore` and do not appear in the leaderboard. Per spec, "staking does not accidentally affect ranking".
