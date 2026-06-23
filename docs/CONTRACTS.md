# Smart Contracts

All active contracts are deployed on **Ritual Chain testnet** (chainId 1979). The canonical source of truth for addresses is `deployments/ritual-1979-v9-fresh.json` (V9 fresh redeploy + staking ms-timestamp fix + marketplace correct-AP redeploy).

| Contract | Path | Address |
|---|---|---|
| RitualAP (V9 ERC-20) | `contracts/RitualAP.sol` | `0x38EB5dB7cDc3571d767f42a51897298146Acb346` |
| IdentityCard | `contracts/identity/IdentityCard.sol` | `0xeb6dF756e604Eda802b046dE3A904C143cB0f322` |
| RitualTraining (V9) | `contracts/training/RitualTraining.sol` | `0xfB08024373208a572B518190B05c5EF4c200B4AD` |
| RitualArena | `contracts/arena/RitualArena.sol` | `0xbb22d8c3EF60bf1E0Dd5500826c6baaEfE112f02` |
| RitualStaking (ms-fix) | `contracts/staking/RitualStaking.sol` | `0x5E6c13eDCAbbcdA301F8310Ec3aFe2B3fA15F886` |
| AchievementRegistry | `contracts/registry/AchievementRegistry.sol` | `0x90120eeF2d9A5D03fD310f47f615b8a406943774` |
| IdentityRegistry | `contracts/registry/IdentityRegistry.sol` | `0xe04669f070764934708a91E1C0A24Fe5D06db586` |
| RitualPackNFT (V10) | `contracts/pack/RitualPackNFT.sol` | `0xc381fCd8f673E673Bd0927b2dd33B6C189570342` |
| PackManager (V10) | `contracts/pack/PackManager.sol` | `0xAd96175CaA412C3D42BCcF6C59eC2Fc8ee2c8CCb` |
| CardBurner (V10) | `contracts/burner/CardBurner.sol` | `0xf81F27A5eCC14227C8f5b0E0941896cFDe04ff16` |
| RitualMarketplace (V5+listing-fee) | `contracts/marketplace/RitualMarketplace.sol` | `0x55Bab06C434866a38E6d241b45aF21283A482CDe` |

> **Contract name preservation**: The Solidity source `contract X is` declarations keep the original onchain names (e.g. `contract RitualAnthem is`, `contract AnthemArenaV4 is`) so that compiled bytecode hashes match deployed addresses. The public-facing product names are "Identity Card", "Arena", "Pack".

## Common Patterns

All active contracts share:

- **Solidity 0.8.24** with OpenZeppelin v5
- **Ownable2Step** for safe ownership transfer
- **Pausable** for emergency stops (where applicable)
- **ms-aware timestamps** via `_now() = block.timestamp / 1000` helper in `RitualStaking`. Other contracts read `block.timestamp` directly; the frontend auto-detects ms vs sec via `raw > 1e12 ? raw : raw * 1000` (see `src/lib/ritualTime.ts`).
- **EIP-712 forge attestation** for identity-creating actions
- **`simulateContract` before broadcast** in all frontend write paths (saves a wasted user signature if the tx would revert)
- **+30% gas headroom** in the frontend for heavy txs (pack open, training) — viem's tight estimate is prone to OOG with no revert reason

## RitualAP

**Purpose**: Single canonical ERC-20 token. Every flow references this address.

**Key state**:
- `balances[wallet]` — AP balance (18 decimals, wei)
- `minters[address]`, `burners[address]` — role-based access (OpenZeppelin `AccessControl`)
- `cap` — maximum total supply

**Roles wired**:
- `MINTER_ROLE` — Training, Arena, Staking, PackManager (and owner)
- `BURNER_ROLE` — RitualMarketplace (and owner)

## IdentityCard

**Purpose**: NFT that represents a user's presence in Ritual Arena. Source of identity state. Pushes Collection Score to IdentityRegistry.

**Key state**:
- `anthemsByWallet[wallet]` — Anthem data (xHandle, mood, lyrics, prompt, audioURI, etc.)
- `cardSnapshots[wallet]` — CardSnapshot (tokenId, currentPower, currentRarity, snapshotVersion, lastRefreshed)
- `handleUsed[handleHash]` — one X handle per wallet

**Key events**:
- `AnthemMinted(tokenId, wallet, mood, handle, power, rarity)`
- `SnapshotAutoEvolved(tokenId, wallet, oldPower, newPower, oldRarity, newRarity)`
- `MetadataBaseURIUpdated(tokenId, wallet, uri)`

**Write functions**:
- `mintAnthem(handle, mood, lyrics, prompt, audioURI, metadataURI, expiry, nonce, signature)` — EIP-712-gated forge
- `autoEvolveSnapshot(wallet, newPower)` — only callable by Training
- `setIdentityRegistry(registry)` — owner-only
- `setTrustedUpdater(updater, trusted)` — owner-only
- `setVerifier(newVerifier)` — owner-only
- `setMetadataBaseURI(uri)` — owner-only

**Read functions**:
- `hasAnthem(wallet) → bool`
- `getAnthem(wallet) → Anthem`
- `getCardSnapshot(wallet) → CardSnapshot`
- `getCurrentPower(wallet) → uint16`
- `getCurrentRarity(wallet) → uint8`
- `tokenURI(tokenId) → string`

**Dependencies**: IdentityRegistry (Collection Score push).

## RitualTraining

**Purpose**: Train Identity Card to earn AP and XP. Auto-evolves power and rarity on-chain.

**Key state**:
- `players[wallet]` — Player (totalXp, level, apEarned, lastTrainedAt, trainCount, streak)
- `dailyStreaks[wallet]` — DailyStreak
- `LEVEL_SIZE = 500`, `XP_PER_TRAIN = 25`, `AP_PER_TRAIN = 25`
- `TRAINING_COOLDOWN_MS = 72_000_000` (20h in ms, matches Ritual Chain's MS timestamp quirk)

**Key events**:
- `CardTrained(tokenId, wallet, xpGained, apGained, totalXp, levelAfter)`

**Write functions**:
- `train()` — 20h cooldown (ms-aware); mints AP to caller, updates XP+level, calls `autoEvolveSnapshot()` on IdentityCard, pushes `updateTraining()` to IdentityRegistry. Reads msg.sender's token from IdentityCard directly.
- `setIdentityRegistry(registry)` — owner-only
- `awardAP(wallet, amount, reason)` — only callable by Arena (trusted) for daily check-in

**Read functions**:
- `getCardProgress(tokenId) → CardProgress`
- `trainingHistoryCount(tokenId) → uint256`
- `getTrainingRecord(tokenId, i) → TrainingRecord`

**Dependencies**: IdentityCard (autoEvolve), IdentityRegistry (push), RitualAP (mint).

## RitualArena

**Purpose**: Timed match between two Identity Cards. Holders back their card with AP. Highest AP wins (with power handicap).

**Key state**:
- `battles[id]` — Battle (wallets, pools, status, start/end timestamps in MS)
- `arenaStats[wallet]` — Player (wins, losses, arenaScore, settled)
- `lastOpponentMatch[a][b]` — repeat-opponent cooldown
- `BATTLE_DURATION = 86400` sec (24h), `CYCLE_INTERVAL = 86400` sec, `REPEAT_COOLDOWN`

> **Arena stores time in MS** (uses `block.timestamp` directly). Frontend compares against `Date.now()` (MS) — see `useArena.ts`.

**Key events**:
- `BattleCreated(id, walletA, walletB, endTime)`
- `APBacked(id, backer, forA, amount)`
- `BattleSettled(id, winner, poolA, poolB)`
- `VotedAPClaimed(id, backer, amount)`
- `MatchmakingCycleComplete(timestamp, created, skipped)`
- `ArenaScoreUpdated(wallet, newScore, delta)`
- `BattleStatsUpdated(wallet, wins, losses, settled)`

**Write functions**:
- `scheduleBatch(wallets[], powers[])` — onlyKeeper; creates matches for eligible pairs
- `createBattle(a, b, pa, pb)` — onlyOwner (admin)
- `voteAP(battleId, forA, amount)` — back a card; reduces AP from voter, adds to pool, updates `arenaStats`, pushes to IdentityRegistry
- `settle(battleId)` — anyone after duration; determines winner
- `claimVotedAP(battleId)` — backer claims AP if their side won
- `setArenaOptOut(bool)` — opt in/out matchmaking
- `setIdentityRegistry(registry)` — owner-only
- `setKeeper(address)` — owner-only
- `addTrustedCaller(address)` / `removeTrustedCaller(address)` — owner-only

**Read functions**:
- `getActiveBattles() → Battle[]`
- `effectiveWeights(id) → (a, b, pa, pb)` — power handicap
- `getArenaStats(wallet) → Player`
- `getRecentBattles(wallet) → uint256[]`
- `timeLeft(id) → uint256`
- `isSettleable(id) → bool`
- `isMatchmakingEligible(wallet) → (bool, string)`

**Dependencies**: IdentityCard (for `hasAnthem` / `getCurrentPower` / `getCurrentRarity`), IdentityRegistry (push), RitualAP (mint/burn).

## AchievementRegistry

**Purpose**: One-time achievement unlocks. Tracks which achievements each wallet has earned.

**Key state**:
- `achievements[wallet]` — list of `bytes32` achievement IDs
- `achievementScores[wallet]` — uint32 cumulative score

**Key events**:
- `AchievementUnlocked(wallet, achievementId, points, sourceHash, timestamp)`

**Write functions**:
- `unlockAchievement(wallet, achievementId, points, sourceHash)` — onlyUpdater
- `batchUnlockAchievements(wallet, ids[], points[], sourceHash)` — onlyUpdater
- `setIdentityRegistry(registry)` — owner-only
- `setTrustedUpdater(updater, trusted)` — owner-only

**Read functions**:
- `hasAchievement(wallet, achievementId) → bool`
- `getAchievementIds(wallet) → bytes32[]`
- `getAchievement(wallet, achievementId) → (id, points, sourceHash, unlockedAt)`
- `getAchievementScore(wallet) → uint256`
- `getAchievementCount(wallet) → uint256`

**Dependencies**: IdentityRegistry (push via `updateAchievement`).

## IdentityRegistry

**Purpose**: Canonical store of 4 score components + derived `totalScore` + `rank`. **Single source of truth for the leaderboard.**

**Key state** (per wallet, `IdentitySnapshot`):
- `trainingScore` (≤ 4000)
- `achievementScore` (≤ 3000)
- `arenaScore` (≤ 2000)
- `collectionScore` (≤ 1000)
- `totalScore` (≤ 10000) — auto-derived, sum of 4 components
- `rank` (0..5) — auto-derived, normalized rank score
- `trainingLevel`, `totalXp`, `currentPower`, `currentRarity` — for display
- `version` (monotonic) and `updatedAt`

**Key events**:
- `IdentityScoreUpdated(wallet, trainingScore, achievementScore, arenaScore, collectionScore, totalScore, rank, version, updatedAt)`
- `TrustedUpdaterSet(updater, trusted)`

**Write functions** (onlyUpdater — owner OR trusted updaters):
- `updateTraining(wallet, score, level, xp)`
- `updateAchievement(wallet, score)`
- `updateArena(wallet, score)`
- `updateCollection(wallet, score)`
- `updateAll(...)` — bulk update
- `setTrustedUpdater(updater, trusted)` — owner-only
- `pause()` / `unpause()` — owner-only

**Read functions**:
- `getIdentity(wallet) → IdentitySnapshot` — full snapshot
- `getTotalScore(wallet) → uint256`
- `getRank(wallet) → uint8` — 0..5
- `indexedLength() → uint256`
- `getIndexedWallets(offset, limit) → address[]` — paginated leaderboard source
- `rankForScore(score) → uint8` — pure normalization

**Trusted updaters** (set via `setTrustedUpdater(true)`):
- RitualTraining, RitualArena, AchievementRegistry, IdentityCard, PackManager

## RitualStaking

**Purpose**: Lock RITUAL for AP yield. **Does NOT affect ranking.**

**ms-aware time math**: uses `_now() = block.timestamp / 1000` because Ritual Chain returns `block.timestamp` in milliseconds, not seconds. Without this division, `LOCK_DURATION = 1209600 sec` would resolve in ~20 minutes of real wall-clock time.

**Reward rate**: `150 AP / RITUAL / DAY` linear accrual. 14-day lock. 0 RITUAL minimum stake. 2 RITUAL wallet cap. 1,000,000 AP global reward emission cap.

**Key state**:
- `positions[posId]` — StakePosition (staker, amount, stakedAt, unlocksAt, lastClaimAt, claimedAP, withdrawn)
- `positionIds[wallet]` — list of positionIds
- `totalStaked`, `totalClaimedByWallet`, `totalClaimedGlobal` (V2+)
- `lastClaimedAtByWallet` (V2+ aggregator)
- `protocol limits` (maxTotalStaked, maxStakePerWallet, rewardEmissionCap)

> `unlocksAt`, `lastClaimAt`, `lastClaimedAtByWallet` are all stored in **SECONDS** (via `_now()`). Frontend compares against `Math.floor(Date.now() / 1000)`.

**Key events**:
- `Staked(posId, wallet, amount, unlocksAt, projectedTotalAP)`
- `RewardsClaimed(staker, reward, totalClaimedByWalletAfter, totalClaimedGlobalAfter)`
- `Unstaked(posId, wallet, amount)`
- `ProtocolLimitsUpdated(...)`

**Write functions**:
- `stake()` — payable; lock native RITUAL; V3+: any `msg.value > 0` accepted (no minimum)
- `unstake(posId)` — withdraw principal + unclaimed yield
- `claimAP(posId)` — claim yield only
- `claimAllAP()` — claim all wallet positions
- `emergencyWithdraw(posId)` — owner-only; escape hatch
- `setProtocolLimits(...)` — owner-only
- `setTreasuryWallet(...)` — owner-only
- `setAP(newAP)` — owner-only; update the AP token reference

**Read functions**:
- `getPositionIds(wallet) → uint256[]`
- `getPosition(posId) → StakePosition`
- `pendingRewards(wallet) → uint256`
- `estimatedAP(amount) → uint256`
- `getPositionIds(wallet) / getPosition(posId)`
- `totalStaked() / totalClaimedGlobal() / totalClaimed(wallet) → uint256`
- `lastClaimedAt(wallet) → uint256` (in seconds, via `_now()`)
- `apPerRitualPerDay()` / `apyPerRitualPerDay() → uint256` (150)
- `globalStakingStats() → (totalStaked, totalClaimedGlobal, rewardEmissionCap, totalClaimedGlobalRemaining, activeStakers)`
- `activeStakerCount() → uint256`

**Dependencies**: RitualAP (mint to staker on claim).

## RitualPackNFT + PackManager

**Purpose**: On-chain pack system. PackManager sells packs (Initiate 50 AP / Ritual 75 AP), uses on-chain RNG to mint 1–5 RitualPackNFT cards per pack.

**RitualPackNFT state** (6-field cardData per tokenId):
- `cardId` (uint16) — points into the 254-card pool
- `rarity` (uint8) — 0..5 (Initiate / Ascendant / Bitty / Ritty / Ritualist / Radiant Ritualist)
- `serial` (uint16) — per-card serial number (1..maxSupplyOf(cardId))
- `role` (uint8) — INITIATE / RITUAL
- `season` (uint8)
- `mintedAt` (uint64, in MS)

**Per-card supply**: `maxSupplyOf(cardId)` — caps how many of each card can ever exist.

**Key events**:
- `CardMinted(tokenId, cardId, rarity, serial, minter)` — single-card mint
- `PackOpenedBatch(opener indexed, packType indexed, tokenIds, rarities, serials)` — batch mint from a pack open
- `Transfer(...)` — ERC-721 standard

**PackManager state**:
- `packConfigs[Initiate|Ritual]` — PackConfig (apCost, rarityBps, maxSupply)
- `totalMinted[cardId]` — current supply per card

**Key events**:
- `InitiatePackOpened(opener, tokenIds)`
- `RitualPackOpened(opener, tokenIds)`

**Write functions** (PackManager):
- `initiatePack()` — buy + open an Initiate pack (50 AP)
- `ritualPack()` — buy + open a Ritual pack (75 AP)
- `genesisAdminMint(wallet, cardId)` — owner-only; mint a specific card bypassing pack sale

**Rarity BPS** (deterministic on-chain RNG):
- Initiate pack (50 AP): 70% Initiate, 20% Ascendant, 7% Bitty, 2.5% Ritty, 0.5% Ritualist
- Ritual pack (75 AP): 0% Initiate, 50% Ascendant, 30% Bitty, 15% Ritty, 5% Ritualist

**Dependencies**: RitualAP (transferFrom for pack cost), RitualPackNFT (mintBatch).

## RitualMarketplace

**Purpose**: On-chain marketplace for trading RitualPackNFT cards. Atomic AP+NFT settlement.

**Listing fee**: 1 AP burned on every new listing. Net effect: discourages spam listings, sends AP to dead address.

**Key state**:
- `listings[listingId]` — Listing (seller, nftContract, tokenId, priceAp, expiry, active)
- `nextListingId` — counter

**Key events**:
- `Listed(listingId, seller, nftContract, tokenId, priceAp)`
- `Bought(listingId, buyer, priceAp)`
- `Cancelled(listingId)`

**Write functions**:
- `list(nftContract, tokenId, priceAp, expiryDays)` — caller must `AP.approve(Marketplace, 1e18)` first; `AP.transferFrom(seller → 0xdead)` burns 1 AP; `NFT.transferFrom(seller → escrow)`
- `buy(listingId)` — caller must `AP.approve(Marketplace, priceAp)` first; atomic `AP.transferFrom(buyer → seller) + NFT.transferFrom(escrow → buyer)`
- `cancel(listingId)` — seller removes listing, NFT returns to seller

**Read functions**:
- `getListing(listingId) → Listing`
- `getActiveListings() → uint256[]`

**Dependencies**: RitualAP (burn fee + payment), RitualPackNFT (escrow).

## CardBurner (NFT Deflation Sink)

**Purpose**: NFT deflation mechanism. Players burn unwanted RitualPackNFT cards in exchange for fresh AP. Removes low-value cards from circulation, gives every card a floor value, and creates a positive gameplay loop (open pack → burn trash → earn AP → play more).

**Default burn rates** (AP wei per card, by internal rarity):
- INITIATE (0, COMMON) → `5e18` (5 AP)
- BITTY (1, RARE) → `15e18` (15 AP)
- RITTY (2, EPIC) → `50e18` (50 AP)
- RITUALIST (3, LEGENDARY) → `150e18` (150 AP)
- RADIANT_RITUALIST (4, MYTHIC) → `500e18` (500 AP)
- GENESIS (5) → **non-burnable** (rejected at both packNFT and burner layer to preserve scarcity)

**Key state**:
- `burnRates[uint8 rarity]` — AP wei paid per burn, mutable by owner via `setBurnRate()`

**Key events**:
- `CardBurnFinished(address indexed player, uint256 indexed tokenId, uint8 indexed rarity, uint256 apEarned)` — emitted per card burned

**RitualPackNFT surface** (added in V10 alongside the burner deploy):
- `function burn(uint256 tokenId) external` — owner or approved only; rejects GENESIS (rarity 5) with `GenesisNotBurnable`
- `event CardBurned(uint256 indexed tokenId, address indexed owner, uint8 rarity)` — emitted on each burn
- `delete cardData[tokenId]` clears on-chain card metadata

**Write functions** (CardBurner):
- `burnCard(uint256 tokenId)` — single burn; non-reentrant; checks-effects-interactions (burn first, then mint AP)
- `burnCards(uint256[] tokenIds)` — batch burn; atomic on revert (reverts whole batch if any card fails)
- `setBurnRate(uint8 rarity, uint256 amount)` — owner only; rejects setting GENESIS rate

**Read functions**:
- `burnRates(uint8 rarity) → uint256` — current rate (wei AP per card of that rarity)
- `packNFT()` / `ap()` — immutable contract references

**Dependencies**: RitualPackNFT (calls `burn()`), RitualAP (calls `mint()` — needs `MINTER_ROLE`).

**Deflation semantics**: Burning does NOT decrement `PackManager.serialByRarity`. The serial slot is permanently destroyed — true scarcity. This is the key design choice that distinguishes "sink" (burn cards forever) from "recycle" (re-mint same serial). The owner-set `defaultMaxByRarity[rarity]` already caps total minted count, so the loop is naturally bounded.

**User flow** (one-time + recurring):
1. Player opens Recycle Bin window → lists all owned RitualPackNFTs
2. Selects cards to recycle → preview shows total AP earned
3. One-time: click "Approve Burner" → `RitualPackNFT.setApprovalForAll(CardBurner, true)`
4. Click "Recycle Selected" → `CardBurner.burnCards([ids])` → atomic batch burn + AP mint
5. UI updates via event bus (`ap-changed` + `nft-changed`) — gallery refreshes automatically

## Trusted Updaters (IdentityRegistry)

The following contracts can call `update*()` on IdentityRegistry:

| Contract | Pushes |
|---|---|
| RitualTraining | `updateTraining(wallet, score, level, xp)` |
| RitualArena | `updateArena(wallet, score)` |
| AchievementRegistry | `updateAchievement(wallet, score)` |
| IdentityCard | `updateCollection(wallet, score)` |
| PackManager | `updateCollection(wallet, score)` (when cards minted from packs) |

All pushes are **automatic on every relevant action** — there is no manual sync script. The frontend only needs an event bus refetch to display the new state.
