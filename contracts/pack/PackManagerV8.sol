// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RitualPackNFTV2} from "./RitualPackNFTV2.sol";

enum InternalRarity {
    INITIATE,           // 0  visual COMMON
    BITTY,              // 1  visual RARE
    RITTY,              // 2  visual EPIC
    RITUALIST,          // 3  visual LEGENDARY
    RADIANT_RITUALIST,  // 4  visual MYTHIC
    GENESIS             // 5  visual GENESIS — admin-only
}

/// @dev One entry per card TYPE. Each mint of the same cardId yields a
///      new serial 1..maxSupply, until sold out.
struct PoolCard {
    uint256 cardId;
    uint8   rarity;     // InternalRarity (0..5)
    string  role;
    uint16  power;
    string  metadataURI;
    uint256 maxSupply;  // 0 means "use rarity default" (50/25/10/5/1)
}

interface IIdentityRegistryForPackManager {
    function updateCollection(address wallet, uint256 collectionScore) external;
}

/// @title  Ritual Pack Manager v8 — supply-tracked cardType pool
/// @notice Each cardId is a card TYPE. The pool is keyed by cardId; opening
///         a pack samples a cardId, checks `mintedSupplyByCardId[cardId] <
///         maxSupplyByCardId[cardId]`, then mints the next serial via
///         RitualPackNFT V2. Old single-mint-per-cardId model is replaced.
contract PackManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    RitualPackNFTV2 public immutable packNFT;

    enum PackType { INITIATE, RITUALIST }

    struct PackConfig {
        uint256 price;        // AP cost
        uint8   cardsPerPack; // typically 3
        // 5 bps fields, one per visible rarity (0..4). sum <= 10000.
        uint16  bpsCommon;
        uint16  bpsRare;
        uint16  bpsEpic;
        uint16  bpsLegendary;
        uint16  bpsMythic;
    }

    PackConfig public initiateConfig;
    PackConfig public ritualistConfig;

    // Per-rarity defaults for maxSupply when PoolCard.maxSupply == 0
    uint256 public constant MAX_COMMON    = 50;
    uint256 public constant MAX_RARE      = 25;
    uint256 public constant MAX_LEGENDARY = 10;
    uint256 public constant MAX_MYTHIC    = 5;
    uint256 public constant MAX_GENESIS   = 1;

    // Pools
    mapping(uint8 packType => PoolCard[]) private _pool;

    // Per-user guarantee state
    mapping(address => uint8)  public lastRarityInitiate;
    mapping(address => uint8)  public lastRarityRitualist;
    mapping(address => uint8)  public noRareStreakInitiate;
    mapping(address => uint8)  public noRareStreakRitualist;
    mapping(address => uint256) public lastOpenTimestamp;

    address public identityRegistry;
    address public apToken;
    address public trustedUpdater;

    bool public poolSealed; // once true, addPoolCard is disabled

    event PoolCardAdded(uint8 indexed packType, uint256 cardId, uint8 rarity, uint256 maxSupply);
    event PackOpened(address indexed user, uint8 packType, uint256[] tokenIds);
    event PackConfigUpdated(uint8 packType, uint256 price, uint8 cardsPerPack);
    event IdentityRegistrySet(address registry);
    event APTokenSet(address token);
    event TrustedUpdaterSet(address updater);
    event PoolSealed();
    event CollectionScoreUpdated(address indexed user, uint256 score);

    error PackSoldOut(uint256 cardId, uint256 maxSupply);
    error PoolEmpty();
    error PoolSealedAlready();
    error WrongValue(uint256 expected, uint256 actual);
    error NotTrusted();
    error RarityUnknown(uint8 rarity);

    constructor(
        address _packNFT,
        address _apToken,
        PackConfig memory _initiate,
        PackConfig memory _ritualist
    ) Ownable(msg.sender) {
        packNFT = RitualPackNFTV2(_packNFT);
        apToken = _apToken;
        initiateConfig  = _initiate;
        ritualistConfig = _ritualist;
    }

    // ---------- admin: config ----------

    function setIdentityRegistry(address registry) external onlyOwner {
        identityRegistry = registry;
        emit IdentityRegistrySet(registry);
    }

    function setAPToken(address token) external onlyOwner {
        apToken = token;
        emit APTokenSet(token);
    }

    function setTrustedUpdater(address updater) external onlyOwner {
        trustedUpdater = updater;
        emit TrustedUpdaterSet(updater);
    }

    function setPackConfig(uint8 packType, PackConfig calldata cfg) external onlyOwner {
        uint16 sum = cfg.bpsCommon + cfg.bpsRare + cfg.bpsEpic + cfg.bpsLegendary + cfg.bpsMythic;
        require(sum <= 10000, "bps sum > 10000");
        if (packType == 0) initiateConfig = cfg;
        else ritualistConfig = cfg;
        emit PackConfigUpdated(packType, cfg.price, cfg.cardsPerPack);
    }

    function sealPool() external onlyOwner {
        poolSealed = true;
        emit PoolSealed();
    }

    function rarityDefaultMaxSupply(uint8 rarity) public pure returns (uint256) {
        if (rarity == 0) return MAX_COMMON;
        if (rarity == 1) return MAX_RARE;
        if (rarity == 2) return MAX_LEGENDARY;
        if (rarity == 3) return MAX_MYTHIC;
        if (rarity == 4) return MAX_GENESIS;
        revert RarityUnknown(rarity);
    }

    /// @dev Seeds a cardId, sets maxSupply on the NFT contract (one-time),
    ///      and appends the card to the chosen pool.
    function _addPoolCard(uint8 packType, PoolCard calldata c) internal {
        if (c.rarity > 4) revert RarityUnknown(c.rarity);

        uint256 max = c.maxSupply == 0 ? rarityDefaultMaxSupply(c.rarity) : c.maxSupply;

        // Register on NFT contract (one-time per cardId)
        if (!packNFT.cardTypeExists(c.cardId)) {
            packNFT.setMaxSupply(c.cardId, max);
        }
        // Append to pool
        _pool[packType].push(c);
        emit PoolCardAdded(packType, c.cardId, c.rarity, max);
    }

    function addPoolCard(uint8 packType, PoolCard calldata c) external onlyOwner {
        if (poolSealed) revert PoolSealedAlready();
        _addPoolCard(packType, c);
    }

    function addPoolCardBatch(uint8 packType, PoolCard[] calldata cards) external onlyOwner {
        if (poolSealed) revert PoolSealedAlready();
        for (uint256 i = 0; i < cards.length; i++) {
            _addPoolCard(packType, cards[i]);
        }
    }

    function poolSize(uint8 packType) external view returns (uint256) {
        return _pool[packType].length;
    }

    function poolCardAt(uint8 packType, uint256 idx) external view returns (PoolCard memory) {
        return _pool[packType][idx];
    }

    function poolAll(uint8 packType) external view returns (PoolCard[] memory) {
        return _pool[packType];
    }

    // ---------- user: open pack ----------

    function openInitiatePack() external nonReentrant returns (uint256[] memory tokenIds) {
        return _openPack(0);
    }

    function openRitualistPack() external nonReentrant returns (uint256[] memory tokenIds) {
        return _openPack(1);
    }

    function _openPack(uint8 packType) internal returns (uint256[] memory tokenIds) {
        PackConfig memory cfg = packType == 0 ? initiateConfig : ritualistConfig;
        if (_pool[packType].length == 0) revert PoolEmpty();

        // Charge AP
        if (apToken != address(0) && cfg.price > 0) {
            IERC20(apToken).safeTransferFrom(msg.sender, address(this), cfg.price);
        }

        uint8  n        = cfg.cardsPerPack;
        uint256[] memory ids = new uint256[](n);

        // Track picked cardIds in this tx to prevent dupes within a single pack
        uint256[] memory usedCardIds = new uint256[](n);
        uint8 usedCount = 0;

        for (uint8 i = 0; i < n; i++) {
            uint8 rarity = _pickRarityWithGuarantee(packType, cfg);
            uint256 idx  = _pickAvailablePoolIndex(packType, rarity, usedCardIds, usedCount);
            PoolCard memory c = _pool[packType][idx];
            usedCardIds[usedCount] = c.cardId;
            usedCount++;

            // Mint next serial of this cardId
            (uint256 tokenId, ) = packNFT.mint(
                msg.sender,
                c.cardId,
                c.rarity,
                c.role,
                c.power,
                c.metadataURI
            );
            ids[i] = tokenId;
            _updateGuaranteeCounters(msg.sender, rarity, packType);
        }

        lastOpenTimestamp[msg.sender] = block.timestamp;
        _pushCollectionScore(msg.sender);
        emit PackOpened(msg.sender, packType, ids);
        return ids;
    }

    // ---------- rarity pick (with rarity guarantee logic kept from v7) ----------

    function _pickRarityWithGuarantee(uint8 packType, PackConfig memory cfg) internal view returns (uint8) {
        // Simplified: pick by bps weights, with up-rarity bump if no rare last 3 packs
        uint8  minRarity = 0;
        uint8  noRareStreak = packType == 0 ? noRareStreakInitiate[msg.sender] : noRareStreakRitualist[msg.sender];

        if (noRareStreak >= 3) minRarity = 1; // guarantee RARE or better

        uint256 r = _rand(10000);
        uint16 sum = 0;
        uint8 chosen = 0;

        // walk bps in order; skip rarities < minRarity
        // fields: bpsCommon(0), bpsRare(1), bpsEpic(2), bpsLegendary(3), bpsMythic(4)
        uint16[5] memory weights;
        weights[0] = cfg.bpsCommon;
        weights[1] = cfg.bpsRare;
        weights[2] = cfg.bpsEpic;
        weights[3] = cfg.bpsLegendary;
        weights[4] = cfg.bpsMythic;

        uint16 eligibleSum = 0;
        for (uint8 i = minRarity; i < 5; i++) eligibleSum += weights[i];
        if (eligibleSum == 0) return minRarity;

        uint256 target = (r * eligibleSum) / 10000;
        for (uint8 i = minRarity; i < 5; i++) {
            sum += weights[i];
            if (target < sum) { chosen = i; break; }
            if (i == 4) chosen = 4;
        }
        return chosen;
    }

    function _updateGuaranteeCounters(address user, uint8 rarity, uint8 packType) internal {
        if (packType == 0) {
            lastRarityInitiate[user] = rarity;
            noRareStreakInitiate[user] = (rarity >= 1) ? 0 : noRareStreakInitiate[user] + 1;
        } else {
            lastRarityRitualist[user] = rarity;
            noRareStreakRitualist[user] = (rarity >= 1) ? 0 : noRareStreakRitualist[user] + 1;
        }
    }

    function _pickAvailablePoolIndex(
        uint8 packType,
        uint8 rarity,
        uint256[] memory usedCardIds,
        uint8 usedCount
    ) internal view returns (uint256) {
        // Build list of candidates with this rarity + not sold out + not used this tx
        PoolCard[] storage p = _pool[packType];
        uint256 len = p.length;
        uint256 count = 0;
        for (uint256 i = 0; i < len; i++) {
            if (p[i].rarity != rarity) continue;
            if (_isCardIdInUsedList(p[i].cardId, usedCardIds, usedCount)) continue;
            uint256 max = p[i].maxSupply == 0 ? rarityDefaultMaxSupply(rarity) : p[i].maxSupply;
            if (packNFT.mintedSupplyByCardId(p[i].cardId) >= max) continue;
            count++;
        }
        require(count > 0, "no available card for rarity");
        uint256 r = _rand(count);
        uint256 seen = 0;
        for (uint256 i = 0; i < len; i++) {
            if (p[i].rarity != rarity) continue;
            if (_isCardIdInUsedList(p[i].cardId, usedCardIds, usedCount)) continue;
            uint256 max = p[i].maxSupply == 0 ? rarityDefaultMaxSupply(rarity) : p[i].maxSupply;
            if (packNFT.mintedSupplyByCardId(p[i].cardId) >= max) continue;
            if (seen == r) return i;
            seen++;
        }
        revert("unreachable");
    }

    function _isCardIdInUsedList(uint256 cardId, uint256[] memory usedCardIds, uint8 usedCount) internal pure returns (bool) {
        for (uint8 j = 0; j < usedCount; j++) {
            if (usedCardIds[j] == cardId) return true;
        }
        return false;
    }

    // ---------- helpers ----------

    function _pushCollectionScore(address user) internal {
        if (identityRegistry == address(0)) return;
        // simple score: number of NFTs owned (capped)
        uint256 score = packNFT.balanceOf(user);
        IIdentityRegistryForPackManager(identityRegistry).updateCollection(user, score);
        emit CollectionScoreUpdated(user, score);
    }

    function _rand(uint256 modulus) internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, lastOpenTimestamp[msg.sender]))) % modulus;
    }

    // ---------- rescue ----------

    function rescueAP(address to, uint256 amount) external onlyOwner {
        IERC20(apToken).safeTransfer(to, amount);
    }
}
