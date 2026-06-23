// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title  RitualPackNFT V2 — cardType-based supply model
/// @notice Each cardId is a card TYPE (e.g. cardId 101 = "Knight Initiate").
///         maxSupply per cardId is fixed at mint time. Each mint assigns
///         serialNumber = current minted count + 1. One metadata URI per
///         cardId (no per-serial JSON).
///
/// @dev    Storage layout (intentionally non-standard, see decoder.ts):
///         word 0: cardId        (uint256)
///         word 1: serialNumber  (uint256)
///         word 2: maxSupply     (uint256)
///         word 3: rarity        (uint8)  (rest zero)
///         word 4: role          (string, 1 or 2 slots)
///         word 5/6: power       (uint16) (rest zero)
///         word 6/7: metadataURI (string, 1+ slots)
///         word N: mintedAt      (uint256)
contract RitualPackNFTV2 is ERC721, ERC721URIStorage, ERC721Enumerable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    struct CardData {
        uint256 cardId;
        uint256 serialNumber;
        uint256 maxSupply;
        uint8   rarity;
        string  role;
        uint16  power;
        string  metadataURI;
        uint256 mintedAt;
    }

    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => CardData) private _cards;

    // O(1) lookup by cardId
    mapping(uint256 cardId => uint256) public mintedSupplyByCardId;
    mapping(uint256 cardId => uint256) public maxSupplyByCardId;
    mapping(uint256 cardId => bool)    public cardTypeExists;

    // Optional base URI override (if set, tokenURI returns baseURI + cardId + ".json")
    string  public baseURI;
    address public admin;

    event CardMinted(
        uint256 indexed tokenId,
        uint256 indexed cardId,
        uint256 serialNumber,
        uint256 maxSupply,
        uint8   rarity,
        address indexed to
    );

    event BaseURISet(string baseURI);

    error CardSoldOut(uint256 cardId, uint256 maxSupply);
    error CardNotRegistered(uint256 cardId);
    error MaxSupplyZero();

    constructor(address _admin) ERC721("Ritual Pack NFT V2", "RPACK-V2") {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MINTER_ROLE, _admin);
        admin = _admin;
    }

    modifier onlyAdmin() {
        _checkRole(DEFAULT_ADMIN_ROLE);
        _;
    }

    // ---------- admin: set maxSupply per cardId ----------

    function setMaxSupply(uint256 cardId, uint256 maxSupply) external onlyAdmin {
        if (maxSupply == 0) revert MaxSupplyZero();
        if (cardTypeExists[cardId]) revert("cardId already registered");
        maxSupplyByCardId[cardId] = maxSupply;
        cardTypeExists[cardId] = true;
    }

    function setMaxSupplyBatch(uint256[] calldata cardIds, uint256[] calldata maxSupplies)
        external onlyAdmin
    {
        require(cardIds.length == maxSupplies.length, "length mismatch");
        for (uint256 i = 0; i < cardIds.length; i++) {
            uint256 cardId = cardIds[i];
            uint256 maxSupply = maxSupplies[i];
            if (maxSupply == 0) revert MaxSupplyZero();
            if (cardTypeExists[cardId]) revert("cardId already registered");
            maxSupplyByCardId[cardId] = maxSupply;
            cardTypeExists[cardId] = true;
        }
    }

    function setBaseURI(string calldata uri) external onlyAdmin {
        baseURI = uri;
        emit BaseURISet(uri);
    }

    // ---------- minter: mint next serial of a cardId ----------

    /// @notice Mints the next serial of `cardId` to `to`. The caller must
    ///         hold MINTER_ROLE. Reverts if sold out.
    /// @return tokenId     newly minted tokenId
    /// @return serialNumber 1-indexed serial of this cardId
    function mint(
        address to,
        uint256 cardId,
        uint8   rarity,
        string calldata role,
        uint16  power,
        string calldata metadataURI
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId, uint256 serialNumber) {
        if (!cardTypeExists[cardId]) revert CardNotRegistered(cardId);
        uint256 max = maxSupplyByCardId[cardId];
        uint256 minted = mintedSupplyByCardId[cardId];
        if (minted >= max) revert CardSoldOut(cardId, max);

        serialNumber = minted + 1;
        tokenId = _nextTokenId++;

        _cards[tokenId] = CardData({
            cardId:       cardId,
            serialNumber: serialNumber,
            maxSupply:    max,
            rarity:       rarity,
            role:         role,
            power:        power,
            metadataURI:  metadataURI,
            mintedAt:     block.timestamp
        });
        mintedSupplyByCardId[cardId] = serialNumber;

        _safeMint(to, tokenId);
        emit CardMinted(tokenId, cardId, serialNumber, max, rarity, to);
    }

    // ---------- views ----------

    function cardData(uint256 tokenId) external view returns (CardData memory) {
        return _cards[tokenId];
    }

    function totalSupply() public view override(ERC721Enumerable) returns (uint256) {
        return ERC721Enumerable.totalSupply();
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        _requireOwned(tokenId);
        CardData memory c = _cards[tokenId];
        // If a per-token metadataURI is set, return it; else build baseURI/cardId.json
        if (bytes(c.metadataURI).length > 0) {
            return c.metadataURI;
        }
        return string.concat(baseURI, Strings.toString(c.cardId), ".json");
    }

    // ---------- role mgmt ----------

    function setMinter(address minter, bool enabled) external onlyAdmin {
        if (enabled) _grantRole(MINTER_ROLE, minter);
        else _revokeRole(MINTER_ROLE, minter);
    }

    // ---------- required overrides ----------

    function supportsInterface(bytes4 iid)
        public
        view
        override(ERC721, ERC721Enumerable, ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(iid);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }
}
