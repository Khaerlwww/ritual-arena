// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Collection Edition
/// @notice ERC-721 collectible editions derived from forged identities,
///         historical achievements, seasons, and arena milestones.
///         Editions are collectibles only — no gameplay power.
/// @dev    Forge editions created by CardImprint on forge; historical/achievement editions by admin.
contract CollectionEdition is ERC721, Ownable {
    uint8 public constant SEASON = 1;

    uint8 public constant COMMON = 0;
    uint8 public constant RARE = 1;
    uint8 public constant EPIC = 2;
    uint8 public constant LEGENDARY = 3;
    uint8 public constant MYTHIC = 4;
    uint8 public constant GENESIS = 5;

    /// @notice editionType = 0 for forge-based, 1 for historical/achievement
    struct EditionType {
        address sourceWallet;
        string handle;
        string title;
        uint256 powerSnapshot;
        uint8 raritySnapshot;
        uint8 seasonId;
        uint256 forgeTimestamp;
        uint256 achievementSnapshot;
        uint256 arenaSnapshot;
        uint16 maxSupply;
        uint16 currentSupply;
        uint8 editionType;
        bool exists;
    }

    mapping(uint256 => EditionType) public editionTypes;
    mapping(uint256 => uint256) public tokenEditionType;
    mapping(uint256 => uint16) public tokenEditionNumber;
    mapping(address => bool) public trustedCallers;

    uint256 public nextTokenId = 1;

    event EditionCreated(uint256 indexed editionTypeId, string title, uint8 editionType);
    event EditionMinted(uint256 indexed tokenId, uint256 indexed editionTypeId, uint16 editionNumber);

    constructor() ERC721("Ritual Arena Collection Edition", "EDITION") Ownable(msg.sender) {}

    modifier onlyTrusted() {
        require(trustedCallers[msg.sender] || msg.sender == owner(), "not trusted");
        _;
    }

    function setTrustedCaller(address caller, bool trusted) external onlyOwner {
        trustedCallers[caller] = trusted;
    }

    function maxSupplyForRarity(uint8 rarity) public pure returns (uint16) {
        if (rarity == MYTHIC) return 25;
        if (rarity == LEGENDARY) return 100;
        if (rarity == EPIC) return 250;
        if (rarity == RARE) return 500;
        if (rarity == COMMON) return 1000;
        if (rarity == GENESIS) return 10;
        return 0;
    }

    /// @notice Create a forge-based edition template (called by CardImprint on forge).
    ///         No token is minted — lazy minting happens on pack open.
    function createForgeEdition(
        address sourceWallet,
        string calldata handle,
        uint256 power,
        uint8 rarity,
        uint8 season
    ) external onlyTrusted returns (uint256 editionTypeId) {
        editionTypeId = _editionTypeId(sourceWallet, season, 0);
        EditionType storage et = editionTypes[editionTypeId];
        require(!et.exists, "already exists");
        uint16 supply = maxSupplyForRarity(rarity);
        require(supply > 0, "invalid rarity");
        et.sourceWallet = sourceWallet;
        et.handle = handle;
        et.title = "";
        et.powerSnapshot = power;
        et.raritySnapshot = rarity;
        et.seasonId = season;
        et.forgeTimestamp = block.timestamp;
        et.achievementSnapshot = 0;
        et.arenaSnapshot = 0;
        et.maxSupply = supply;
        et.currentSupply = 0;
        et.editionType = 0;
        et.exists = true;
        emit EditionCreated(editionTypeId, "", 0);
    }

    /// @notice Mint a historical / achievement / season edition (admin).
    function mintHistoricalEdition(
        address to,
        address sourceWallet,
        string calldata handle,
        string calldata title,
        uint256 power,
        uint8 rarity,
        uint8 season,
        uint256 achievementSnapshot,
        uint256 arenaSnapshot,
        uint16 customSupply
    ) external onlyOwner returns (uint256 tokenId) {
        require(customSupply > 0, "zero supply");
        uint256 editionTypeId = _editionTypeId(sourceWallet, season, 1);

        EditionType storage et = editionTypes[editionTypeId];
        if (!et.exists) {
            et.sourceWallet = sourceWallet;
            et.handle = handle;
            et.title = title;
            et.powerSnapshot = power;
            et.raritySnapshot = rarity;
            et.seasonId = season;
            et.forgeTimestamp = block.timestamp;
            et.achievementSnapshot = achievementSnapshot;
            et.arenaSnapshot = arenaSnapshot;
            et.maxSupply = customSupply;
            et.currentSupply = 0;
            et.editionType = 1;
            et.exists = true;
            emit EditionCreated(editionTypeId, title, 1);
        }

        require(et.currentSupply < et.maxSupply, "max supply");
        tokenId = nextTokenId++;
        et.currentSupply++;
        uint16 editionNumber = et.currentSupply;

        tokenEditionType[tokenId] = editionTypeId;
        tokenEditionNumber[tokenId] = editionNumber;

        _safeMint(to, tokenId);
        emit EditionMinted(tokenId, editionTypeId, editionNumber);
    }

    /// @notice Mint an existing edition type from pool (called by PackManager).
    function mintFromPool(address to, uint256 editionTypeId, uint16 amount)
        external onlyTrusted returns (uint256 firstTokenId)
    {
        EditionType storage et = editionTypes[editionTypeId];
        require(et.exists, "edition not found");
        require(amount > 0, "zero amount");
        for (uint16 i = 0; i < amount; i++) {
            require(et.currentSupply < et.maxSupply, "max supply");
            uint256 tid = nextTokenId++;
            et.currentSupply++;
            uint16 editionNumber = et.currentSupply;
            tokenEditionType[tid] = editionTypeId;
            tokenEditionNumber[tid] = editionNumber;
            if (i == 0) firstTokenId = tid;
            _safeMint(to, tid);
            emit EditionMinted(tid, editionTypeId, editionNumber);
        }
    }

    /// @notice Pool-friendly edition info for PackManager.
    function editionPoolInfo(uint256 editionTypeId) external view returns (
        uint8 raritySnapshot, uint16 currentSupply, uint16 maxSupply, bool exists
    ) {
        EditionType storage et = editionTypes[editionTypeId];
        return (et.raritySnapshot, et.currentSupply, et.maxSupply, et.exists);
    }

    function editionTypeIdOf(address sourceWallet, uint8 season, uint8 eType) public pure returns (uint256) {
        return _editionTypeId(sourceWallet, season, eType);
    }

    function _editionTypeId(address sourceWallet, uint8 season, uint8 eType) private pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(sourceWallet, season, eType)));
    }
}
