// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {CollectionEdition} from "../CollectionEdition.sol";

/// Read-only view over the live, immutable RitualAnthem identity card.
interface IRitualAnthemView {
    struct Anthem {
        uint256 tokenId;
        address wallet;
        string xHandle;
        string mood;
        string lyrics;
        string musicPrompt;
        string audioURI;
        string metadataURI;
        uint256 createdAt;
    }

    struct CardSnapshot {
        uint256 tokenId;
        uint16 initialPower;
        uint16 currentPower;
        uint8 initialRarity;
        uint8 currentRarity;
        bytes32 initialSourceHash;
        bytes32 currentSourceHash;
        uint64 forgedAt;
        uint64 lastRefreshed;
        uint8 snapshotVersion;
    }

    function hasAnthem(address wallet) external view returns (bool);
    function getAnthem(address wallet) external view returns (Anthem memory);
    function balanceOf(address wallet) external view returns (uint256);
    function getCardSnapshot(address wallet) external view returns (CardSnapshot memory);
}

/// @notice IdentityRegistry push channel for Collection Score updates.
interface IIdentityRegistry {
    function updateCollection(address wallet, uint256 collectionScore) external;
}

/// @notice AP bridge into the canonical Arena contract (trusted-caller role required for deduct/award).
interface IAnthemArenaAP {
    function ritualPoints(address wallet) external view returns (uint256);

    function deductAP(address wallet, uint256 amount) external;

    function awardAP(address wallet, uint256 amount, string calldata reason) external;
}

/// @title Card Imprint
/// @notice The permanent, tradeable artifact of a Ritual Arena identity.
/// @dev    One Imprint per wallet — a permanent, on-chain record of entry.
///
///         - Minted the first time a wallet enters the Arena (after Forge).
///         - ERC-721 tradeable: can be sold and displayed, but never
///           re-minted. It is a frozen snapshot of the wallet's card at entry.
///         - `mood` + `originTokenId` are read trustlessly from RitualAnthem;
///           score/grade/role/abilities are derived on-chain from the same
///           wallet + handle seed used by the UI, then frozen here.
///           Genesis stays verifiable via the origin tokenId (#1..#10).
///
///         Also hosts an AP offer marketplace for direct holder-to-holder
///         Imprint trading.
contract CardImprint is ERC721, ReentrancyGuard {
    using Strings for uint256;

    // ----- constants -----
    uint256 public constant SEASON = 1;
    uint256 public constant GENESIS_SUPPLY = 10;

    uint256 public constant MIN_LISTING_DURATION = 1 days;
    uint256 public constant MAX_LISTING_DURATION = 90 days;
    uint256 public constant OFFER_DURATION = 7 days;
    uint256 public constant PROTOCOL_FEE_BPS = 1000; // 10%
    uint256 public constant MIN_OFFER_AP = 10;

    // ----- external deps -----
    IRitualAnthemView public immutable ritualAnthem;
    IAnthemArenaAP public immutable arena;
    address public owner;
    address public pendingOwner;
    address public feeRecipient;
    CollectionEdition public collectionEdition;
    address public packManager;

    // --- IdentityRegistry (push Collection Score on every change) ---
    IIdentityRegistry public identityRegistry;

    // ----- imprint storage -----
    /// @notice Live-mirror imprint storage. Card progression fields
    ///         (score, rarity, trainingLevel, identityScore) are NOT
    ///         stored here — they are always derived at render time from
    ///         IdentityCard.cardSnapshots[origin]. This struct only
    ///         stores imprint-specific metadata (origin, handle, mood,
    ///         archetype, traits, season, mintedAt). The legacy
    ///         `score` and `rarity` fields are kept (zeroed on new
    ///         mints) so the ABI stays backward-compatible; old
    ///         imprints that have stored values there are ignored by
    ///         the new live view (see getImprintLive + tokenURI).
    struct ImprintData {
        address origin;
        uint256 originTokenId;
        string handle;
        string mood;
        uint256 score;       // DEPRECATED — always read from IdentityCard
        string rarity;       // DEPRECATED — always read from IdentityCard
        string cardArchetype;
        string[] cardTraits;
        uint256 season;
        uint256 mintedAt;
    }

    mapping(uint256 => ImprintData) private _imprints;
    mapping(address => uint256) public imprintOfWallet;
    mapping(address => bool) public hasMintedImprint;
    uint256 public nextImprintId = 1;

    // ----- AP offer marketplace -----
    struct Listing {
        address seller;
        uint256 listedAt;
        uint256 expiresAt;
        uint256 floorAp;
        bool active;
    }

    struct Offer {
        address buyer;
        uint256 tokenId;
        uint256 apAmount;
        uint256 createdAt;
        uint256 expiresAt;
        bool active;
    }

    mapping(uint256 => Listing) public listings;
    Offer[] public offers;
    mapping(uint256 => uint256[]) public offersByToken;
    mapping(address => uint256[]) public offersByBuyer;
    mapping(address => mapping(uint256 => bool)) public hasActiveOffer;
    uint256[] private _activeListingIds;
    mapping(uint256 => uint256) private _activeListingIndex;

    // ----- events -----
    event ImprintForged(uint256 indexed tokenId, address indexed owner, string rarity, uint256 season);
    event ImprintListed(uint256 indexed tokenId, address indexed seller, uint256 durationDays, uint256 floorAp);
    event ImprintUnlisted(uint256 indexed tokenId, address indexed seller);
    event OfferMade(uint256 indexed offerId, uint256 indexed tokenId, address indexed buyer, uint256 apAmount);
    event OfferAccepted(
        uint256 indexed offerId,
        uint256 indexed tokenId,
        address indexed seller,
        address buyer,
        uint256 apAmount,
        uint256 fee
    );
    event OfferCancelled(uint256 indexed offerId, uint256 indexed tokenId, address indexed buyer);
    event OfferExpired(uint256 indexed offerId);
    event OwnershipTransferStarted(address indexed prev, address indexed next);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address ritualAnthem_, address anthemArena_, address feeRecipient_)
        ERC721("Ritual Arena Card Imprint", "IMPRINT")
    {
        require(ritualAnthem_ != address(0) && anthemArena_ != address(0), "zero dep");
        ritualAnthem = IRitualAnthemView(ritualAnthem_);
        arena = IAnthemArenaAP(anthemArena_);
        owner = msg.sender;
        feeRecipient = feeRecipient_ == address(0) ? msg.sender : feeRecipient_;
    }

    // =====================================================================
    // Mint — one imprint per wallet, ever
    // =====================================================================

    /// @notice Forge this wallet's permanent Imprint. Callable once per wallet.
    ///         The contract derives the card score/grade/role/traits instead of
    ///         trusting calldata, so the frozen marketplace metadata is not
    ///         spoofable by bypassing the UI.
    function mintImprint() external returns (uint256 tokenId) {
        require(ritualAnthem.hasAnthem(msg.sender), "no identity card");
        require(!hasMintedImprint[msg.sender], "imprint already minted");

        IRitualAnthemView.Anthem memory a = ritualAnthem.getAnthem(msg.sender);
        IRitualAnthemView.CardSnapshot memory snap = ritualAnthem.getCardSnapshot(msg.sender);
        require(snap.snapshotVersion >= 1, "snapshot unavailable");

        // LIVE MIRROR: do NOT store score/rarity. Power and grade are
        // always read from IdentityCard.cardSnapshots[origin] at render
        // time (see tokenURI, getImprintLive, and the frontend's
        // imprintToItem). The imprint is now a "view of the current card"
        // — its display updates automatically as the card evolves.

        // Archetype and traits are seed-derived (imprint-specific flavor)
        // and stay stored because they don't change with card progression.
        uint32 seed = _seedFor(msg.sender, a.xHandle);
        string memory cardArchetype = _archetype(seed);
        string[] memory cardTraits = _traits(seed);

        tokenId = nextImprintId++;
        ImprintData storage d = _imprints[tokenId];
        d.origin = msg.sender;
        d.originTokenId = a.tokenId;
        d.handle = a.xHandle;
        d.mood = a.mood;
        // d.score and d.rarity intentionally left at default (0 / "")
        // — see LIVE MIRROR note above.
        d.cardArchetype = cardArchetype;
        d.cardTraits = cardTraits;
        d.season = SEASON;
        d.mintedAt = block.timestamp;

        imprintOfWallet[msg.sender] = tokenId;
        hasMintedImprint[msg.sender] = true;

        _safeMint(msg.sender, tokenId);
        // Use LIVE score/rarity for the event (not the deprecated struct fields).
        emit ImprintForged(tokenId, msg.sender, _rarityLabel(snap.currentRarity), SEASON);

        // Auto-create Collection Edition if eligible (uses live power/rarity).
        // SKIP if the edition already exists for this (wallet, season) —
        // re-creating an existing edition reverts with "already exists"
        // in CollectionEdition.createForgeEdition (line 81:
        // `require(!et.exists, "already exists")`). The fix is to read
        // the on-chain storage via a STATICCALL before calling the
        // mutating function. This is the path that fixed the
        // `mintImprint -> already exists` regression after the
        // CardImprint redeploy in commit fab7c36 — the existing
        // edition state is preserved (legacy editions stay intact),
        // and the new mint path just skips the duplicate creation.
        if (address(collectionEdition) != address(0) && _eligibleForEdition(snap.currentPower, a.tokenId)) {
            uint256 existingEditionId = collectionEdition.editionTypeIdOf(msg.sender, uint8(SEASON), uint8(0));
            // EditionType struct field order:
            //   sourceWallet, handle, title, powerSnapshot, raritySnapshot,
            //   seasonId, forgeTimestamp, achievementSnapshot, arenaSnapshot,
            //   maxSupply, currentSupply, editionType, exists
            // `exists` is the LAST field. We destructure with the
            // earlier fields skipped and `exists` named last.
            (,,,,,,,,,,,, bool exists) = collectionEdition.editionTypes(existingEditionId);
            if (!exists) {
                collectionEdition.createForgeEdition(
                    msg.sender,
                    a.xHandle,
                    snap.currentPower,
                    snap.currentRarity,
                    uint8(SEASON)
                );
            }
        }

        // Push the new Collection Score to the canonical IdentityRegistry
        // so the leaderboard updates automatically on every imprint mint.
        // The CardImprint contributes the imprint-count component (max 100).
        if (address(identityRegistry) != address(0)) {
            identityRegistry.updateCollection(msg.sender, _calcCollectionScoreForImprints(msg.sender));
        }
    }

    /// @notice Compute the FULL Collection Score from on-chain state:
    ///         - currentPower contribution:  max 600  (read from IdentityCard)
    ///         - currentRarity contribution: max 300  (read from IdentityCard)
    ///         - cardCount contribution:      max 100  (capped at 10 cards)
    ///         - imprintCount contribution:  max 100  (capped at 5 imprints)
    ///         Same formula as identityEngine.ts. Mirrors IdentityCard so any
    ///         component can be the source of truth on its own update.
    function _calcCollectionScoreForImprints(address wallet) internal view returns (uint256) {
        IRitualAnthemView.CardSnapshot memory snap = ritualAnthem.getCardSnapshot(wallet);
        uint256 powerComponent = snap.snapshotVersion == 0 ? 0 : uint256(snap.currentPower) * 6;
        if (powerComponent > 600) powerComponent = 600;

        uint256 rarityComponent = snap.snapshotVersion == 0 ? 0 : uint256(snap.currentRarity) * 75;
        if (rarityComponent > 300) rarityComponent = 300;

        uint256 cardCount = ritualAnthem.balanceOf(wallet);
        if (cardCount > 10) cardCount = 10;
        uint256 countComponent = cardCount * 10;
        if (countComponent > 100) countComponent = 100;

        uint256 imprintCount = balanceOf(wallet);
        if (imprintCount > 5) imprintCount = 5;
        countComponent += imprintCount * 20;
        if (countComponent > 100) countComponent = 100;

        uint256 raw = powerComponent + rarityComponent + countComponent;
        return raw > 1000 ? 1000 : raw;
    }

    function _deriveSnapshot(address wallet, string memory handle, uint256 originTokenId)
        private
        pure
        returns (uint256 score, string memory rarity, string memory cardArchetype, string[] memory cardTraits)
    {
        uint32 seed = _seedFor(wallet, handle);
        score = uint256(seed) % 101;
        rarity = _rarityFor(score, originTokenId);
        cardArchetype = _archetype(seed);
        cardTraits = _traits(seed);
    }

    function _seedFor(address wallet, string memory handle) private pure returns (uint32 acc) {
        acc = 7;
        acc = _hashBytes(acc, bytes(Strings.toHexString(uint160(wallet), 20)));
        acc = _hashByte(acc, uint8(bytes1("|")));
        acc = _hashBytes(acc, _sanitizeLowerHandle(handle));
    }

    function _hashBytes(uint32 acc, bytes memory data) private pure returns (uint32) {
        for (uint256 i = 0; i < data.length; i++) {
            acc = _hashByte(acc, uint8(data[i]));
        }
        return acc;
    }

    function _hashByte(uint32 acc, uint8 c) private pure returns (uint32) {
        unchecked {
            return acc * 31 + uint32(c);
        }
    }

    function _sanitizeLowerHandle(string memory raw) private pure returns (bytes memory out) {
        bytes memory b = bytes(raw);
        uint256 start;
        uint256 end = b.length;
        while (start < end && _isTrimChar(uint8(b[start]))) start++;
        while (end > start && _isTrimChar(uint8(b[end - 1]))) end--;
        while (start < end && uint8(b[start]) == 64) start++; // leading "@"

        bytes memory tmp = new bytes(15);
        uint256 len;
        for (uint256 i = start; i < end && len < 15; i++) {
            uint8 c = uint8(b[i]);
            bool keep = (c >= 48 && c <= 57) || c == 95 || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
            if (!keep) continue;
            if (c >= 65 && c <= 90) c += 32;
            tmp[len++] = bytes1(c);
        }

        out = new bytes(len);
        for (uint256 i = 0; i < len; i++) out[i] = tmp[i];
    }

    function _isTrimChar(uint8 c) private pure returns (bool) {
        return c == 32 || (c >= 9 && c <= 13);
    }

    function _rarityFor(uint256 score, uint256 originTokenId) private pure returns (string memory) {
        if (originTokenId >= 1 && originTokenId <= GENESIS_SUPPLY) return "GENESIS";
        if (score >= 95) return "MYTHIC";
        if (score >= 80) return "LEGENDARY";
        if (score >= 60) return "EPIC";
        if (score >= 40) return "RARE";
        return "COMMON";
    }

    /// @dev Convert uint8 rarity rank (0-4) to label string.
    function _rarityLabel(uint8 rank) private pure returns (string memory) {
        if (rank == 0) return "COMMON";
        if (rank == 1) return "RARE";
        if (rank == 2) return "EPIC";
        if (rank == 3) return "LEGENDARY";
        return "MYTHIC";
    }

    function _eligibleForEdition(uint256 score, uint256 originTokenId) private pure returns (bool) {
        return score >= 40 || (originTokenId >= 1 && originTokenId <= GENESIS_SUPPLY);
    }

    function _rarityToUint8(string memory rarity) private pure returns (uint8) {
        bytes32 r = keccak256(bytes(rarity));
        if (r == keccak256("GENESIS")) return 5;
        if (r == keccak256("MYTHIC")) return 4;
        if (r == keccak256("LEGENDARY")) return 3;
        if (r == keccak256("EPIC")) return 2;
        if (r == keccak256("RARE")) return 1;
        return 0;
    }

    function _archetype(uint32 seed) private pure returns (string memory) {
        uint256 i = uint256(seed) % 9;
        if (i == 0) return "DREAMER";
        if (i == 1) return "ARCHITECT";
        if (i == 2) return "VOID WALKER";
        if (i == 3) return "SIGNAL HUNTER";
        if (i == 4) return "ALCHEMIST";
        if (i == 5) return "EXPLORER";
        if (i == 6) return "ORACLE";
        if (i == 7) return "BUILDER";
        return "VISIONARY";
    }

    function _traits(uint32 seed) private pure returns (string[] memory out) {
        uint256 count = 1 + (uint256(seed) % 3);
        out = new string[](count);
        uint8[10] memory pool = [uint8(0), 1, 2, 3, 4, 5, 6, 7, 8, 9];
        uint256 poolLen = 10;
        uint32 s = seed;

        for (uint256 i = 0; i < count; i++) {
            unchecked {
                s = s * 1_103_515_245 + 12_345;
            }
            uint256 idx = uint256(s) % poolLen;
            out[i] = _trait(pool[idx]);
            for (uint256 j = idx; j < poolLen - 1; j++) {
                pool[j] = pool[j + 1];
            }
            poolLen--;
        }
    }

    function _trait(uint8 i) private pure returns (string memory) {
        if (i == 0) return "NIGHT VISION";
        if (i == 1) return "SILENT FOCUS";
        if (i == 2) return "INTUITION";
        if (i == 3) return "HIGH CONVICTION";
        if (i == 4) return "EARLY SIGNAL";
        if (i == 5) return "CHAOS RESISTANCE";
        if (i == 6) return "DEEP LIQUIDITY";
        if (i == 7) return "IRON HANDS";
        if (i == 8) return "PATTERN SENSE";
        return "COLD BLOOD";
    }

    // =====================================================================
    // Marketplace (AP offers)
    // =====================================================================

    function listImprint(uint256 tokenId, uint256 durationDays, uint256 floorAp) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        require(durationDays >= 1 && durationDays <= 90, "duration 1-90 days");
        require(floorAp >= MIN_OFFER_AP, "floor below minimum");
        Listing storage current = listings[tokenId];
        require(
            !current.active || block.timestamp >= current.expiresAt || _ownerOf(tokenId) != current.seller,
            "already listed"
        );
        listings[tokenId] = Listing({
            seller: msg.sender,
            listedAt: block.timestamp,
            expiresAt: block.timestamp + (durationDays * 1 days),
            floorAp: floorAp,
            active: true
        });
        _addActiveListing(tokenId);
        emit ImprintListed(tokenId, msg.sender, durationDays, floorAp);
    }

    function cancelListing(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        require(listings[tokenId].active, "not listed");
        listings[tokenId].active = false;
        _removeActiveListing(tokenId);
        emit ImprintUnlisted(tokenId, msg.sender);
    }

    function makeOffer(uint256 tokenId, uint256 apAmount) external nonReentrant {
        Listing storage l = listings[tokenId];
        require(l.active, "not listed");
        require(block.timestamp < l.expiresAt, "listing expired");
        require(ownerOf(tokenId) != msg.sender, "own listing");
        require(apAmount >= MIN_OFFER_AP, "below minimum");
        require(apAmount >= l.floorAp, "below floor");
        require(arena.ritualPoints(msg.sender) >= apAmount, "insufficient AP");

        require(!hasActiveOffer[msg.sender][tokenId], "offer exists");

        uint256 id = offers.length;
        offers.push(
            Offer({
                buyer: msg.sender,
                tokenId: tokenId,
                apAmount: apAmount,
                createdAt: block.timestamp,
                expiresAt: block.timestamp + OFFER_DURATION,
                active: true
            })
        );
        offersByToken[tokenId].push(id);
        offersByBuyer[msg.sender].push(id);
        hasActiveOffer[msg.sender][tokenId] = true;

        arena.deductAP(msg.sender, apAmount);

        emit OfferMade(id, tokenId, msg.sender, apAmount);
    }

    function acceptOffer(uint256 offerId) external nonReentrant {
        require(offerId < offers.length, "bad offer");
        Offer storage o = offers[offerId];
        require(o.active, "offer inactive");
        require(block.timestamp < o.expiresAt, "offer expired");
        require(ownerOf(o.tokenId) == msg.sender, "not owner");
        require(listings[o.tokenId].active, "not listed");

        uint256 fee = (o.apAmount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 sellerAP = o.apAmount - fee;
        address buyer = o.buyer;
        uint256 tokenId = o.tokenId;
        uint256 apAmount = o.apAmount;

        o.active = false;
        hasActiveOffer[buyer][tokenId] = false;
        listings[tokenId].active = false;
        _removeActiveListing(tokenId);

        arena.awardAP(msg.sender, sellerAP, "imprint_sale");
        if (fee > 0) arena.awardAP(feeRecipient, fee, "market_fee");
        _transfer(msg.sender, buyer, tokenId);

        emit OfferAccepted(offerId, tokenId, msg.sender, buyer, apAmount, fee);
    }

    function cancelOffer(uint256 offerId) external nonReentrant {
        require(offerId < offers.length, "bad offer");
        Offer storage o = offers[offerId];
        require(o.buyer == msg.sender, "not buyer");
        require(o.active, "offer inactive");
        o.active = false;
        hasActiveOffer[o.buyer][o.tokenId] = false;
        arena.awardAP(msg.sender, o.apAmount, "offer_cancelled");
        emit OfferCancelled(offerId, o.tokenId, msg.sender);
    }

    function sweepExpiredOffer(uint256 offerId) external nonReentrant {
        require(offerId < offers.length, "bad offer");
        Offer storage o = offers[offerId];
        require(o.active, "offer inactive");
        require(block.timestamp >= o.expiresAt, "offer live");
        o.active = false;
        hasActiveOffer[o.buyer][o.tokenId] = false;
        arena.awardAP(o.buyer, o.apAmount, "offer_expired_refund");
        emit OfferExpired(offerId);
    }

    function sweepExpiredListing(uint256 tokenId) external {
        Listing storage l = listings[tokenId];
        require(l.active, "not listed");
        require(block.timestamp >= l.expiresAt, "listing live");
        l.active = false;
        _removeActiveListing(tokenId);
        emit ImprintUnlisted(tokenId, l.seller);
    }

    // =====================================================================
    // Views + metadata
    // =====================================================================

    function getImprint(uint256 tokenId) external view returns (ImprintData memory) {
        return _imprints[tokenId];
    }

    /// @notice LIVE-MIRROR view of an imprint. Returns the stored
    ///         metadata (origin/handle/mood/archetype/traits/season)
    ///         combined with the current IdentityCard state
    ///         (currentPower/currentRarity). The `score` and `rarity`
    ///         fields in the returned struct are derived from
    ///         IdentityCard.cardSnapshots[origin] at call time —
    ///         they update automatically as the card evolves.
    ///         Old imprints (minted before the live-mirror migration)
    ///         that have stored `d.score`/`d.rarity` values are
    ///         ignored — only the live card state is returned.
    ///         If the origin's card snapshot doesn't exist, returns
    ///         score=1 / rarity="COMMON" (the forge initial state).
    function getImprintLive(uint256 tokenId)
        external
        view
        returns (
            address origin,
            uint256 originTokenId,
            string memory handle,
            string memory mood,
            uint256 score,        // LIVE — from IdentityCard.cardSnapshots[origin]
            string memory rarity, // LIVE — derived from card's currentRarity
            string memory cardArchetype,
            string[] memory cardTraits,
            uint256 season,
            uint256 mintedAt
        )
    {
        ImprintData storage d = _imprints[tokenId];
        // Read the LIVE card state. We do NOT trust d.score / d.rarity
        // even if they were set by an old mint — those values are
        // frozen and would diverge from the card as it evolves.
        uint256 livePower = 1;
        string memory liveRarity = "COMMON";
        try this._readLiveCardSnapshot(d.origin) returns (
            uint16 currentPower, uint8 currentRarity, uint8 snapshotVersion
        ) {
            if (snapshotVersion >= 1) {
                livePower = uint256(currentPower);
                liveRarity = _rarityLabel(currentRarity);
            }
        } catch {
            // Origin has no card snapshot (e.g. pre-forge or post-burn).
            // Fall back to forge initial state.
        }
        return (
            d.origin,
            d.originTokenId,
            d.handle,
            d.mood,
            livePower,
            liveRarity,
            d.cardArchetype,
            d.cardTraits,
            d.season,
            d.mintedAt
        );
    }

    /// @dev Internal helper: read the LIVE CardSnapshot of `wallet`
    ///         from the active IdentityCard contract. Wrapped in a
    ///         function (not inlined) so `getImprintLive` can use
    ///         try/catch — Solidity try/catch only works on external
    ///         calls.
    function _readLiveCardSnapshot(address wallet)
        external
        view
        returns (uint16 currentPower, uint8 currentRarity, uint8 snapshotVersion)
    {
        IRitualAnthemView.CardSnapshot memory snap = ritualAnthem.getCardSnapshot(wallet);
        return (snap.currentPower, snap.currentRarity, snap.snapshotVersion);
    }

    function getActiveListings() external view returns (uint256[] memory tokenIds) {
        uint256 count;
        for (uint256 i = 0; i < _activeListingIds.length; i++) {
            uint256 id = _activeListingIds[i];
            Listing storage l = listings[id];
            if (l.active && block.timestamp < l.expiresAt && _ownerOf(id) == l.seller) count++;
        }
        tokenIds = new uint256[](count);
        uint256 j;
        for (uint256 i = 0; i < _activeListingIds.length; i++) {
            uint256 id = _activeListingIds[i];
            Listing storage l = listings[id];
            if (l.active && block.timestamp < l.expiresAt && _ownerOf(id) == l.seller) {
                tokenIds[j++] = id;
            }
        }
    }

    function getOffersForToken(uint256 tokenId) external view returns (Offer[] memory out) {
        uint256[] storage ids = offersByToken[tokenId];
        uint256 count;
        for (uint256 i = 0; i < ids.length; i++) {
            Offer storage o = offers[ids[i]];
            if (o.active && block.timestamp < o.expiresAt) count++;
        }
        out = new Offer[](count);
        uint256 j;
        for (uint256 i = 0; i < ids.length; i++) {
            Offer storage o = offers[ids[i]];
            if (o.active && block.timestamp < o.expiresAt) out[j++] = o;
        }
    }

    function getOfferIdsForToken(uint256 tokenId) external view returns (uint256[] memory out) {
        uint256[] storage ids = offersByToken[tokenId];
        uint256 count;
        for (uint256 i = 0; i < ids.length; i++) {
            Offer storage o = offers[ids[i]];
            if (o.active && block.timestamp < o.expiresAt) count++;
        }
        out = new uint256[](count);
        uint256 j;
        for (uint256 i = 0; i < ids.length; i++) {
            Offer storage o = offers[ids[i]];
            if (o.active && block.timestamp < o.expiresAt) out[j++] = ids[i];
        }
    }

    function getOffersByBuyer(address buyer) external view returns (Offer[] memory out) {
        uint256[] storage ids = offersByBuyer[buyer];
        uint256 count;
        for (uint256 i = 0; i < ids.length; i++) {
            Offer storage o = offers[ids[i]];
            if (o.active) count++;
        }
        out = new Offer[](count);
        uint256 j;
        for (uint256 i = 0; i < ids.length; i++) {
            Offer storage o = offers[ids[i]];
            if (o.active) out[j++] = o;
        }
    }

    function getOfferIdsByBuyer(address buyer) external view returns (uint256[] memory out) {
        uint256[] storage ids = offersByBuyer[buyer];
        uint256 count;
        for (uint256 i = 0; i < ids.length; i++) {
            if (offers[ids[i]].active) count++;
        }
        out = new uint256[](count);
        uint256 j;
        for (uint256 i = 0; i < ids.length; i++) {
            if (offers[ids[i]].active) out[j++] = ids[i];
        }
    }

    function canList(address wallet, uint256 tokenId) external view returns (bool, string memory) {
        if (_ownerOf(tokenId) == address(0)) return (false, "missing token");
        if (_ownerOf(tokenId) != wallet) return (false, "not owner");
        Listing storage l = listings[tokenId];
        if (l.active && block.timestamp < l.expiresAt && l.seller == wallet) return (false, "already listed");
        return (true, "");
    }

    function setFeeRecipient(address r) external onlyOwner {
        require(r != address(0), "zero");
        feeRecipient = r;
    }

    function setCollectionEdition(address edition) external onlyOwner {
        collectionEdition = CollectionEdition(edition);
    }

    function setPackManager(address pm) external onlyOwner {
        packManager = pm;
    }

    /// @notice Owner sets the IdentityRegistry that this contract pushes the
    ///         Collection Score to. Required for the leaderboard to auto-update
    ///         on every imprint mint and on every ownership transfer.
    function setIdentityRegistry(address registry) external onlyOwner {
        require(registry != address(0), "zero");
        identityRegistry = IIdentityRegistry(registry);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function _addActiveListing(uint256 tokenId) private {
        if (_activeListingIndex[tokenId] != 0) return;
        _activeListingIds.push(tokenId);
        _activeListingIndex[tokenId] = _activeListingIds.length;
    }

    function _removeActiveListing(uint256 tokenId) private {
        uint256 indexPlusOne = _activeListingIndex[tokenId];
        if (indexPlusOne == 0) return;
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _activeListingIds.length - 1;
        if (index != lastIndex) {
            uint256 lastId = _activeListingIds[lastIndex];
            _activeListingIds[index] = lastId;
            _activeListingIndex[lastId] = index + 1;
        }
        _activeListingIds.pop();
        delete _activeListingIndex[tokenId];
    }

    /// @notice On-chain ERC-721 metadata. Returns a JSON object whose
    ///         Power / Grade attributes are derived from the LIVE
    ///         IdentityCard state of `d.origin` at call time, NOT from
    ///         the deprecated `d.score` / `d.rarity` storage fields.
    ///         External marketplaces (OpenSea, etc.) will see a fresh
    ///         Power / Grade on every re-fetch — the imprint is now
    ///         a live mirror of the owner's current card.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        ImprintData storage d = _imprints[tokenId];
        string memory handle = bytes(d.handle).length > 0 ? string.concat("@", d.handle) : "anon";

        // LIVE: read current power and rarity from the card snapshot.
        // If the card snapshot doesn't exist (snapshotVersion < 1),
        // fall back to the forge initial state.
        uint16 livePower = 1;
        string memory liveRarity = "COMMON";
        try this._readLiveCardSnapshot(d.origin) returns (
            uint16 currentPower, uint8 currentRarity, uint8 snapshotVersion
        ) {
            if (snapshotVersion >= 1) {
                livePower = currentPower;
                liveRarity = _rarityLabel(currentRarity);
            }
        } catch {}

        string memory attrs = string.concat(
            '{"trait_type":"Origin","value":"',
            Strings.toHexString(uint160(d.origin), 20),
            '"},{"trait_type":"Class","value":"',
            d.mood,
            '"},{"trait_type":"Grade","value":"',
            liveRarity,
            '"},{"trait_type":"Power","value":',
            uint256(livePower).toString(),
            '},{"trait_type":"Role","value":"',
            d.cardArchetype,
            '"},{"trait_type":"Season","value":',
            d.season.toString(),
            "}"
        );

        string memory json = string.concat(
            '{"name":"',
            handle,
            "'s Imprint #",
            tokenId.toString(),
            '","description":"Live mirror of a Ritual Arena identity card. Power, Grade, and Rank update automatically as the owner\'s card evolves.","attributes":[',
            attrs,
            "]}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // ---------------------------------------------------------------------
    // Transfer hook (OZ 5.x): called from _update on every mint/transfer/burn.
    // Re-derive and push Collection Score for both parties on every
    // transfer so the leaderboard never drifts on a marketplace transfer.
    // The from-imprint no longer counts for the seller; the to-imprint
    // now counts for the buyer.
    // ---------------------------------------------------------------------
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override returns (address) {
        address from = _ownerOf(tokenId);
        // Call parent first to perform the actual state change.
        address previousOwner = super._update(to, tokenId, auth);
        // Now re-derive Collection Score for both parties.
        if (address(identityRegistry) != address(0)) {
            // Mint case (from == 0): mintImprint already pushes the new
            // collection score, but the call here is idempotent (overwrites
            // with the same value) — safe and removes the need to special-case.
            if (to != address(0) && to != from) {
                identityRegistry.updateCollection(to, _calcCollectionScoreForImprints(to));
            }
            if (from != address(0) && from != to) {
                identityRegistry.updateCollection(from, _calcCollectionScoreForImprints(from));
            }
        }
        return previousOwner;
    }
}
