// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RitualPackNFT} from "./RitualPackNFT.sol";

/// @notice Internal pack rarity tiers. GENESIS (5) is admin-only and
///         excluded from both pack types. The 5 bps fields on PackConfig
///         map to INITIATE(0) → RADIANT(4); GENESIS is unreachable
///         through packs.
enum InternalRarity {
    INITIATE,           // 0  visual COMMON
    BITTY,              // 1  visual RARE
    RITTY,              // 2  visual EPIC
    RITUALIST,          // 3  visual LEGENDARY
    RADIANT_RITUALIST,  // 4  visual MYTHIC
    GENESIS             // 5  visual GENESIS — admin-only
}

struct PoolCard {
    uint256 cardId;
    uint8   rarity;     // InternalRarity (0..5)
    string  role;
    uint16  power;
    string  baseURI;
    uint256 maxSupply;  // V9: per-card supply cap (0 = use rarity default)
}

interface IIdentityRegistryForPackManager {
    function updateCollection(address wallet, uint256 collectionScore) external;
}

/// @title  Ritual Pack Manager v7 — Collection Pack System V5
/// @notice Per-rarity supply caps, serials (1/N per rarity), and per-user
///         guarantee counters. Each pack contains 3 cards (no duplicate
///         cardId inside one pack). GENESIS excluded from packs.
contract PackManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    RitualPackNFT public immutable card;
    IERC20 public immutable ap;

    IIdentityRegistryForPackManager public identityRegistry;
    uint256 public constant COLLECTION_CAP = 100;

    enum PackType { INITIATE, RITUALIST }

    struct PackConfig {
        uint256 apCost;
        uint16  bps0; // INITIATE
        uint16  bps1; // BITTY
        uint16  bps2; // RITTY
        uint16  bps3; // RITUALIST
        uint16  bps4; // RADIANT
    }

    struct PackResult {
        uint256 tokenId;
        uint8   rarity;
        uint256 serial;
        uint256 cardId;
        string  role;
        uint16  power;
    }

    PackConfig public initiatePack;
    PackConfig public ritualPack;

    PoolCard[] public initiatePool;
    PoolCard[] public ritualPool;

    // Per-rarity supply / serial counters
    mapping(uint8 => uint256) public mintedByRarity; // total minted of this rarity
    mapping(uint8 => uint256) public maxByRarity;     // cap (0 = unlimited, default from setter)
    mapping(uint8 => uint256) public serialByRarity;  // next serial for this rarity

    // V9: per-card supply tracking
    mapping(uint256 => uint256) public mintedByCardId; // cardId => count minted
    mapping(uint256 => uint256) public maxSupplyOf;    // cardId => max supply (set on add)
    mapping(uint8  => uint256) public defaultMaxByRarity; // rarity => default if card.maxSupply == 0

    // Per-user guarantee counters
    // - initGuaranteeCounter: increments on every card with rarity < RITUALIST
    //   triggers when ≥ 10: next card forced to RITUALIST+ (and counter reset)
    // - ritGuaranteeCounter: increments on every card with rarity < RADIANT
    //   triggers when ≥ 10: next card forced to RADIANT+ (and counter reset)
    mapping(address => uint256) public initGuaranteeCounter;
    mapping(address => uint256) public ritGuaranteeCounter;

    uint256 private _nonce;

    event PackOpened(
        address indexed opener,
        uint8   indexed packType,
        uint256 indexed tokenId,
        uint256 cardId,
        uint8   rarity,
        string  role,
        uint256 serial,
        uint256 apCost
    );
    event PackOpenedBatch(
        address indexed opener,
        uint8   indexed packType,
        uint256[] tokenIds,
        uint8[]  rarities,
        uint256[] serials
    );
    event PoolCardAdded(uint8 packType, uint256 cardId, uint8 rarity);
    event PackConfigUpdated(uint8 packType, uint256 apCost);
    event MaxByRarityUpdated(uint8 rarity, uint256 max);
    event RaritySoldOut(uint8 rarity);
    event GuaranteeTriggered(address indexed user, uint8 counter, uint8 forcedRarity);

    error PackFree();
    error InsufficientAPAllowance(uint256 needed, uint256 actual);
    error InsufficientAPBalance(uint256 needed, uint256 actual);
    error EmptyPool(uint8 packType);
    error UnknownPackType();
    error InvalidRarity();
    error RaritySoldOutAll();
    error BpsMustSum10000();
    error DuplicateCardIdInPack();

    constructor(address card_, address ap_, address owner_) Ownable(owner_) {
        require(card_ != address(0), "zero card");
        card = RitualPackNFT(card_);
        ap = IERC20(ap_);

        // Default per-rarity caps (V5 spec). Owner can override via setMaxByRarity.
        maxByRarity[0] = 200; // INITIATE
        maxByRarity[1] = 100; // BITTY
        maxByRarity[2] = 50;  // RITTY
        maxByRarity[3] = 10;  // RITUALIST
        maxByRarity[4] = 5;   // RADIANT
        maxByRarity[5] = 3;   // GENESIS

        initiatePack = PackConfig({
            apCost: 50 ether,   // V9: 50 AP
            bps0: 7000,         // INITIATE        70%
            bps1: 2000,         // BITTY           20%
            bps2: 700,          // RITTY           7%
            bps3: 250,          // RITUALIST       2.5%
            bps4: 50            // RADIANT         0.5%
        });
        ritualPack = PackConfig({
            apCost: 75 ether,   // V9: 75 AP
            bps0: 0,            // INITIATE        0% (no COMMON in ritual)
            bps1: 5000,         // BITTY           50%
            bps2: 3000,         // RITTY           30%
            bps3: 1500,         // RITUALIST       15%
            bps4: 500           // RADIANT         5%
        });

        // V9: per-rarity default max supply
        defaultMaxByRarity[0] = 30;  // INITIATE  (COMMON)
        defaultMaxByRarity[1] = 20;  // BITTY     (RARE)
        defaultMaxByRarity[2] = 10;  // RITTY     (EPIC)
        defaultMaxByRarity[3] = 5;   // RITUALIST (LEGENDARY)
        defaultMaxByRarity[4] = 3;   // RADIANT   (MYTHIC)
        defaultMaxByRarity[5] = 1;   // GENESIS
    }

    // -----------------------------------------------------------------
    // Owner configuration
    // -----------------------------------------------------------------

    function setIdentityRegistry(address registry) external onlyOwner {
        identityRegistry = IIdentityRegistryForPackManager(registry);
    }

    /// @notice Set per-rarity max supply. Pass 0 to mark a rarity as
    ///         unlimited (skip sold-out downgrade for that tier).
    function setMaxByRarity(uint8 rarity, uint256 max) external onlyOwner {
        if (rarity > uint8(InternalRarity.GENESIS)) revert InvalidRarity();
        maxByRarity[rarity] = max;
        emit MaxByRarityUpdated(rarity, max);
    }

    function setPackConfig(
        uint8 packType,
        uint256 apCost,
        uint16 bps0, uint16 bps1, uint16 bps2, uint16 bps3, uint16 bps4
    ) external onlyOwner {
        if (packType > uint8(PackType.RITUALIST)) revert UnknownPackType();
        uint16 sum = bps0 + bps1 + bps2 + bps3 + bps4;
        if (sum != 10000) revert BpsMustSum10000();
        PackConfig storage c = packType == 0 ? initiatePack : ritualPack;
        c.apCost = apCost;
        c.bps0 = bps0; c.bps1 = bps1; c.bps2 = bps2; c.bps3 = bps3; c.bps4 = bps4;
        emit PackConfigUpdated(packType, apCost);
    }

    function addPoolCard(uint8 packType, PoolCard calldata c) external onlyOwner {
        if (packType > uint8(PackType.RITUALIST)) revert UnknownPackType();
        if (c.rarity > uint8(InternalRarity.GENESIS)) revert InvalidRarity();
        if (packType == 0) initiatePool.push(c); else ritualPool.push(c);
        // V9: record per-card max supply
        if (c.maxSupply > 0) maxSupplyOf[c.cardId] = c.maxSupply;
        emit PoolCardAdded(packType, c.cardId, c.rarity);
    }

    function addPoolCardBatch(uint8 packType, PoolCard[] calldata cards) external onlyOwner {
        if (packType > uint8(PackType.RITUALIST)) revert UnknownPackType();
        for (uint256 i = 0; i < cards.length; i++) {
            if (cards[i].rarity > uint8(InternalRarity.GENESIS)) revert InvalidRarity();
            if (packType == 0) initiatePool.push(cards[i]);
            else ritualPool.push(cards[i]);
            if (cards[i].maxSupply > 0) maxSupplyOf[cards[i].cardId] = cards[i].maxSupply;
            emit PoolCardAdded(packType, cards[i].cardId, cards[i].rarity);
        }
    }

    /// @notice V9: Set per-rarity default max supply. Used when a PoolCard has
    ///         maxSupply == 0. Set after addPoolCardBatch to apply to all cards
    ///         of that rarity that didn't specify an explicit value.
    function setDefaultMaxByRarity(uint8 rarity, uint256 max) external onlyOwner {
        if (rarity > uint8(InternalRarity.GENESIS)) revert InvalidRarity();
        defaultMaxByRarity[rarity] = max;
    }

    /// @notice V9: Admin-mint a GENESIS card to a recipient. Bypasses pack
    ///         BPS, AP cost, and rarity pools. Caller must own a cardId in the
    ///         genesisCards list (added via addGenesisCard).
    function mintGenesisAdmin(address to, uint256 cardId) external onlyOwner returns (uint256 tokenId) {
        if (to == address(0)) revert InvalidRarity();
        PoolCard memory pc = _findGenesisCard(cardId);
        if (pc.cardId == 0) revert InvalidRarity();
        uint256 supplyCap = maxSupplyOf[cardId] == 0 ? defaultMaxByRarity[uint8(InternalRarity.GENESIS)] : maxSupplyOf[cardId];
        if (supplyCap > 0 && mintedByCardId[cardId] >= supplyCap) revert RaritySoldOutAll();
        uint256 serial = ++serialByRarity[uint8(InternalRarity.GENESIS)];
        mintedByRarity[uint8(InternalRarity.GENESIS)]++;
        mintedByCardId[cardId]++;
        string memory metadataURI = string(abi.encodePacked(
            pc.baseURI, "/", _toString(pc.cardId), ".json"
        ));
        uint16 mintedPower = _randomPowerForRarity(uint8(InternalRarity.GENESIS));
        tokenId = card.mint(
            to, 2, pc.cardId, uint8(InternalRarity.GENESIS), mintedPower, pc.role, metadataURI
        );
        _pushCollectionScore(to);
        emit PackOpened(to, 2, tokenId, pc.cardId, uint8(InternalRarity.GENESIS), pc.role, serial, 0);
    }

    PoolCard[] private _genesisCards;
    mapping(uint256 => uint256) private _genesisCardIdx;

    /// @notice V9: Add a GENESIS card to the admin-mint pool.
    function addGenesisCard(PoolCard calldata c) external onlyOwner {
        if (c.rarity != uint8(InternalRarity.GENESIS)) revert InvalidRarity();
        _genesisCardIdx[c.cardId] = _genesisCards.length;
        _genesisCards.push(c);
        if (c.maxSupply > 0) maxSupplyOf[c.cardId] = c.maxSupply;
        emit PoolCardAdded(2, c.cardId, c.rarity);
    }

    function _findGenesisCard(uint256 cardId) internal view returns (PoolCard memory) {
        uint256 idx = _genesisCardIdx[cardId];
        if (idx == 0 && _genesisCards.length == 0) return PoolCard({cardId: 0, rarity: 0, role: "", power: 0, baseURI: "", maxSupply: 0});
        if (idx >= _genesisCards.length) return PoolCard({cardId: 0, rarity: 0, role: "", power: 0, baseURI: "", maxSupply: 0});
        return _genesisCards[idx];
    }

    function poolSize(uint8 packType) external view returns (uint256) {
        if (packType == 0) return initiatePool.length;
        return ritualPool.length;
    }

    // -----------------------------------------------------------------
    // Open pack — 3 cards
    // -----------------------------------------------------------------

    function openInitiatePack() external nonReentrant returns (uint256[] memory tokenIds) {
        PackResult[] memory r = _openPack(0);
        tokenIds = new uint256[](r.length);
        for (uint256 i = 0; i < r.length; i++) tokenIds[i] = r[i].tokenId;
    }

    function openRitualistPack() external nonReentrant returns (uint256[] memory tokenIds) {
        PackResult[] memory r = _openPack(1);
        tokenIds = new uint256[](r.length);
        for (uint256 i = 0; i < r.length; i++) tokenIds[i] = r[i].tokenId;
    }

    function _openPack(uint8 packType) internal returns (PackResult[] memory results) {
        PackConfig memory cfg = packType == 0 ? initiatePack : ritualPack;
        uint256 len = packType == 0 ? initiatePool.length : ritualPool.length;
        if (len == 0) revert EmptyPool(packType);

        // AP cost (single payment for the whole pack, charged once)
        if (cfg.apCost > 0) {
            if (address(ap) == address(0)) revert PackFree();
            uint256 bal = ap.balanceOf(msg.sender);
            if (bal < cfg.apCost) revert InsufficientAPBalance(cfg.apCost, bal);
            uint256 allow = ap.allowance(msg.sender, address(this));
            if (allow < cfg.apCost) revert InsufficientAPAllowance(cfg.apCost, allow);
            ap.safeTransferFrom(msg.sender, owner(), cfg.apCost);
        }

        results = new PackResult[](3);
        uint256[] memory used = new uint256[](3); // 0 = unused; >0 = cardId picked (slot index in pool)

        for (uint256 i = 0; i < 3; i++) {
            // 1) Pick rarity (with guarantee override)
            uint8 rolledRarity = _pickRarityWithGuarantee(cfg, msg.sender, packType);

            // 2) Find a card of that rarity in this pack's pool (skip already-picked cardIds,
            //    sold-out rarities, and downgrades). Returns the actual rarity to use.
            (uint8 rarity, uint256 poolIdx) = _pickAvailablePoolIndex(
                packType, rolledRarity, len, used, i
            );
            PoolCard memory pc = packType == 0 ? initiatePool[poolIdx] : ritualPool[poolIdx];
            used[i] = pc.cardId;

            // 3) Assign per-rarity serial
            uint256 serial = ++serialByRarity[rarity];
            mintedByRarity[rarity]++;
            mintedByCardId[pc.cardId]++; // V9: per-card supply tracking

            // 4) Mint — power is randomized within the rarity's power band
            //    (PowerPerRarity), so cards of the same rarity have varied
            //    power rather than all sharing the pool-card's static value.
            string memory metadataURI = string(abi.encodePacked(
                pc.baseURI, "/", _toString(pc.cardId), ".json"
            ));
            uint16 mintedPower = _randomPowerForRarity(rarity);
            uint256 tokenId = card.mint(
                msg.sender, packType, pc.cardId, rarity, mintedPower, pc.role, metadataURI
            );

            // 5) Update guarantee counters
            _updateGuaranteeCounters(msg.sender, rarity, packType);

            _nonce++;
            emit PackOpened(
                msg.sender, packType, tokenId, pc.cardId, rarity, pc.role, serial, cfg.apCost
            );

            results[i] = PackResult({
                tokenId: tokenId, rarity: rarity, serial: serial,
                cardId: pc.cardId, role: pc.role, power: mintedPower
            });
        }

        uint256[] memory tids = new uint256[](3);
        uint8[]   memory rars = new uint8[](3);
        uint256[] memory sers = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            tids[i] = results[i].tokenId;
            rars[i] = results[i].rarity;
            sers[i] = results[i].serial;
        }
        emit PackOpenedBatch(msg.sender, packType, tids, rars, sers);

        _pushCollectionScore(msg.sender);
    }

    // -----------------------------------------------------------------
    // Guarantee logic
    // -----------------------------------------------------------------

    function _pickRarityWithGuarantee(
        PackConfig memory cfg,
        address user,
        uint8 packType
    ) internal returns (uint8) {
        // INITIATE-pack guarantee: counter is 10, force RITUALIST+
        if (packType == 0 && initGuaranteeCounter[user] >= 10) {
            uint8 forced = _highestAvailableRarity(3);
            if (forced >= 3 && forced <= 4) {
                initGuaranteeCounter[user] = 0;
                emit GuaranteeTriggered(user, 0, forced);
                return forced;
            }
            // No RITUALIST/RADIANT available — fall through to normal roll
        }
        // RITUALIST-pack guarantee: counter ≥ 10, force RADIANT+
        if (packType == 1 && ritGuaranteeCounter[user] >= 10) {
            uint8 forced = _highestAvailableRarity(4);
            if (forced == 4) {
                ritGuaranteeCounter[user] = 0;
                emit GuaranteeTriggered(user, 1, forced);
                return forced;
            }
        }
        return _pickRarity(cfg);
    }

    function _updateGuaranteeCounters(address user, uint8 rarity, uint8 packType) internal {
        // init counter: increments on rarity < RITUALIST (3)
        if (rarity < 3) {
            initGuaranteeCounter[user]++;
        } else if (packType == 0) {
            // success on the counter this pack is tracking — reset
            initGuaranteeCounter[user] = 0;
        }
        // rit counter: increments on rarity < RADIANT (4)
        if (rarity < 4) {
            ritGuaranteeCounter[user]++;
        } else if (packType == 1) {
            ritGuaranteeCounter[user] = 0;
        }
    }

    /// @notice Find the highest rarity in [minRarity, 4] that has
    ///         non-empty pool. Returns 0xFF if none available.
    function _highestAvailableRarity(uint8 minRarity) internal view returns (uint8) {
        for (int8 r = 4; r >= int8(minRarity); r--) {
            if (_countOfRarity(uint8(r)) > 0) return uint8(r);
        }
        return type(uint8).max;
    }

    function _countOfRarity(uint8 rarity) internal view returns (uint256) {
        uint256 c;
        uint256 len = initiatePool.length;
        for (uint256 i = 0; i < len; i++) if (initiatePool[i].rarity == rarity) c++;
        len = ritualPool.length;
        for (uint256 i = 0; i < len; i++) if (ritualPool[i].rarity == rarity) c++;
        return c;
    }

    // -----------------------------------------------------------------
    // Rarity pick + sold-out downgrade + card pick
    // -----------------------------------------------------------------

    function _pickRarity(PackConfig memory cfg) internal view returns (uint8) {
        uint256 roll = _rand(10000);
        uint16[5] memory bps = [cfg.bps0, cfg.bps1, cfg.bps2, cfg.bps3, cfg.bps4];
        for (uint8 r = 0; r < 5; r++) {
            if (roll < bps[r]) return r;
            roll -= bps[r];
        }
        return 4; // fallback to RADIANT
    }

    function _pickAvailablePoolIndex(
        uint8 packType,
        uint8 rarity,
        uint256 len,
        uint256[] memory used,
        uint256 usedLen
    ) internal view returns (uint8 foundRarity, uint256 poolIdx) {
        if (_isSoldOut(rarity)) {
            // try down
            for (int8 r = int8(rarity) - 1; r >= 0; r--) {
                if (_isSoldOut(uint8(r))) continue;
                uint256 downIdx = _pickPoolIndex(packType, uint8(r), len, used, usedLen);
                if (downIdx < len) return (uint8(r), downIdx);
            }
            // try up
            for (uint8 r = rarity + 1; r < 5; r++) {
                if (_isSoldOut(r)) continue;
                uint256 upIdx = _pickPoolIndex(packType, r, len, used, usedLen);
                if (upIdx < len) return (r, upIdx);
            }
            revert RaritySoldOutAll();
        }
        uint256 idx = _pickPoolIndex(packType, rarity, len, used, usedLen);
        if (idx < len) return (rarity, idx);
        // Fallback walk
        for (int8 r = int8(rarity) - 1; r >= 0; r--) {
            uint256 fb = _pickPoolIndex(packType, uint8(r), len, used, usedLen);
            if (fb < len) return (uint8(r), fb);
        }
        for (uint8 r = rarity + 1; r < 5; r++) {
            uint256 fb = _pickPoolIndex(packType, r, len, used, usedLen);
            if (fb < len) return (r, fb);
        }
        revert RaritySoldOutAll();
    }

    function _isSoldOut(uint8 rarity) internal view returns (bool) {
        uint256 cap = maxByRarity[rarity];
        if (cap == 0) return true; // 0 = sold out (never set or explicitly zeroed)
        return mintedByRarity[rarity] >= cap;
    }

    function _pickPoolIndex(
        uint8 packType,
        uint8 rarity,
        uint256 len,
        uint256[] memory used,
        uint256 usedLen
    ) internal view returns (uint256) {
        uint256[] memory candidates = new uint256[](len);
        uint256 count;
        for (uint256 i = 0; i < len; i++) {
            PoolCard memory pc = packType == 0 ? initiatePool[i] : ritualPool[i];
            if (pc.rarity != rarity) continue;
            // V9: skip cards that hit their per-card maxSupply
            uint256 cap = maxSupplyOf[pc.cardId] == 0 ? defaultMaxByRarity[rarity] : maxSupplyOf[pc.cardId];
            if (cap > 0 && mintedByCardId[pc.cardId] >= cap) continue;
            // skip already-picked cardIds in this same pack
            bool dup = false;
            for (uint256 j = 0; j < usedLen; j++) {
                if (used[j] == pc.cardId) { dup = true; break; }
            }
            if (dup) continue;
            candidates[count++] = i;
        }
        if (count == 0) return type(uint256).max;
        return candidates[_rand(count)];
    }

    // -----------------------------------------------------------------
    // Collection score
    // -----------------------------------------------------------------

    function _pushCollectionScore(address user) internal {
        if (address(identityRegistry) == address(0)) return;
        uint256 bal = card.balanceOf(user);
        uint256 score = bal > COLLECTION_CAP ? COLLECTION_CAP : bal;
        identityRegistry.updateCollection(user, score);
    }

    // -----------------------------------------------------------------
    // PRNG
    // -----------------------------------------------------------------

    function _rand(uint256 modulus) internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(
            block.prevrandao, block.timestamp, msg.sender, _nonce
        ))) % modulus;
    }

    // -----------------------------------------------------------------
    // Power range per rarity — used to randomize power at mint time
    // so cards in the same rarity tier don't all share the same power.
    //
    //   INITIATE             1 - 20   (common, 20-wide)
    //   BITTY               21 - 40   (rare,   20-wide)
    //   RITTY               41 - 60   (epic,   20-wide)
    //   RITUALIST           61 - 80   (legendary, 20-wide)
    //   RADIANT RITUALIST   81 - 95   (mythic, 15-wide)
    //   GENESIS             96 - 100  (genesis, 5-wide)
    // -----------------------------------------------------------------

    function _rarityPowerMin(uint8 rarity) internal pure returns (uint16) {
        if (rarity == 0) return 1;     // INITIATE
        if (rarity == 1) return 21;    // BITTY
        if (rarity == 2) return 41;    // RITTY
        if (rarity == 3) return 61;    // RITUALIST
        if (rarity == 4) return 81;    // RADIANT RITUALIST
        return 96;                     // GENESIS
    }

    function _rarityPowerMax(uint8 rarity) internal pure returns (uint16) {
        if (rarity == 0) return 20;    // INITIATE
        if (rarity == 1) return 40;    // BITTY
        if (rarity == 2) return 60;    // RITTY
        if (rarity == 3) return 80;    // RITUALIST
        if (rarity == 4) return 95;    // RADIANT RITUALIST
        return 100;                    // GENESIS
    }

    function _randomPowerForRarity(uint8 rarity) internal view returns (uint16) {
        uint16 lo = _rarityPowerMin(rarity);
        uint16 hi = _rarityPowerMax(rarity);
        uint256 span = uint256(hi) - uint256(lo) + 1;
        return uint16(lo) + uint16(_rand(span));
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v; uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (v != 0) { k--; bstr[k] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(bstr);
    }
}
