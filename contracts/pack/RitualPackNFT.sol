// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title  Ritual Pack NFT — V5 (MINTER_ROLE only, no backend path)
/// @notice V5: only the on-chain PackManager can mint. There is no
///         EIP-712 backend path and no `markLegacy` function. Every
///         minted card is tradable on the marketplace.
contract RitualPackNFT is ERC721Enumerable, ERC721URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    enum PackType { INITIATE, RITUALIST }

    struct CardData {
        uint8   packType;
        uint256 cardId;
        uint8   rarity;
        uint16  power;
        string  role;
        uint64  mintedAt;
    }

    mapping(uint256 => CardData) public cardData;
    uint256 public nextTokenId = 1;

    event CardMinted(
        uint256 indexed tokenId,
        address indexed wallet,
        uint8 packType,
        uint256 cardId,
        uint8 rarity,
        uint16 power,
        string role,
        string metadataURI
    );
    event CardBurned(
        uint256 indexed tokenId,
        address indexed owner,
        uint8 rarity
    );
    event MinterUpdated(address indexed minter, bool enabled);

    error ZeroAddress();
    error InvalidPackType();
    error RarityOutOfRange();
    error PowerOutOfRange();
    error GenesisNotBurnable();

    constructor(address admin) ERC721("Ritual Arena Pack Card", "RAPCK") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setMinter(address minter, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (minter == address(0)) revert ZeroAddress();
        if (enabled) _grantRole(MINTER_ROLE, minter);
        else _revokeRole(MINTER_ROLE, minter);
        emit MinterUpdated(minter, enabled);
    }

    function mint(
        address to,
        uint8 packType,
        uint256 cardId,
        uint8 rarity,
        uint16 power,
        string calldata role,
        string calldata metadataURI
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (packType > uint8(PackType.RITUALIST)) revert InvalidPackType();
        if (rarity > 5) revert RarityOutOfRange(); // 0..5: INITIATE..GENESIS (v7)
        if (power < 1 || power > 100) revert PowerOutOfRange();

        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        if (bytes(metadataURI).length > 0) _setTokenURI(tokenId, metadataURI);

        cardData[tokenId] = CardData({
            packType: packType,
            cardId: cardId,
            rarity: rarity,
            power: power,
            role: role,
            mintedAt: uint64(block.timestamp)
        });

        emit CardMinted(tokenId, to, packType, cardId, rarity, power, role, metadataURI);
    }

    /// @notice Burn a pack card. Owner or approved caller only.
    ///         Deflationary sink: card is permanently destroyed, on-chain
    ///         cardData is cleared. The PackManager's `serialByRarity[rarity]`
    ///         counter is NOT decremented — burned serial slots stay gone.
    /// @dev    GENESIS (rarity 5) is rejected — admin-only mint tier that
    ///         must remain ultra-scarce. Use CardBurner to earn AP; burning
    ///         a Common card yields 5 AP, Mythic yields 500 AP (see
    ///         contracts/burner/CardBurnerV2.sol).
    function burn(uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (!_isBurnAuthorized(owner, msg.sender, tokenId)) revert("Caller is not owner nor approved");
        CardData memory card = cardData[tokenId];
        if (card.rarity == 5) revert GenesisNotBurnable();
        delete cardData[tokenId];
        _burn(tokenId);
        emit CardBurned(tokenId, owner, card.rarity);
    }

    /// @dev Mirrors OpenZeppelin's _isAuthorized but renamed to avoid
    ///      the virtual override collision with ERC721._isAuthorized.
    function _isBurnAuthorized(address owner, address spender, uint256 tokenId) internal view returns (bool) {
        return (
            spender == owner ||
            isApprovedForAll(owner, spender) ||
            getApproved(tokenId) == spender
        );
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 iid) public view override(ERC721Enumerable, ERC721URIStorage, AccessControl) returns (bool) {
        return super.supportsInterface(iid);
    }

    function _update(address to, uint256 tokenId, address auth) internal override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }
    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }
}
