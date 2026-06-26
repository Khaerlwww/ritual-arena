// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal interface for the RitualPackNFT burn surface.
/// @dev    We deliberately do NOT import the `cardData` struct here, because
///         The NFT contract emits a non-standard ABI layout for `cardData(tokenId)`:
///           [slot 0]  packType (uint8, full 32B slot)
///           [slot 1]  cardId   (uint256, full 32B slot)
///           [slot 2]  rarity   (uint8, full 32B slot)
///           [slot 3]  power    (uint16, full 32B slot)
///           [slot 4]  role offset pointer (uint256 = 0xc0 = 192)
///           [slot 5]  mintedAt (uint64, full 32B slot)
///           [slot 6+] string length + UTF-8 content
///         This layout breaks Solidity's built-in ABI decoder (it reads the
///         wrong byte for `rarity`), which is why `burnCard`/`burnCards`
///         reverted with no reason on every ritual NFT (tx 0x3936…).
///
///         We avoid the broken decoder entirely by reading the rarity via
///         a raw `staticcall` and pulling byte 95 (= last byte of slot 2).
interface IRitualPackNFT {
    function burn(uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Minimal interface for the RitualAP ERC-20 mint surface.
interface IRitualAP {
    function mint(address to, uint256 amount) external;
}

/// @title  Card Burner V2 — NFT Sink with manual rarity decoder
/// @notice Same economic surface as CardBurner, but reads rarity from
///         RitualPackNFT via a raw `staticcall` + assembly slice,
///         bypassing Solidity's broken struct decoder for the non-standard
///         cardData layout. Identical burn rates, owner, and approval model.
contract CardBurnerV2 is Ownable, ReentrancyGuard {
    IRitualPackNFT public immutable packNFT;
    IRitualAP      public immutable ap;

    /// @notice burnRates[rarity] = AP wei paid for burning a card of that rarity.
    ///         Default table matches CardBurner (docs/CONTRACTS.md):
    ///           0 INITIATE           ->  5e18 (5 AP)
    ///           1 BITTY              -> 15e18 (15 AP)
    ///           2 RITTY              -> 50e18 (50 AP)
    ///           3 RITUALIST          -> 150e18 (150 AP)
    ///           4 RADIANT_RITUALIST  -> 500e18 (500 AP)
    ///           5 GENESIS            -> 0  (non-burnable; packNFT also rejects)
    mapping(uint8 => uint256) public burnRates;

    event CardBurnFinished(
        address indexed player,
        uint256 indexed tokenId,
        uint8   indexed rarity,
        uint256 apEarned
    );
    event BurnRateUpdated(uint8 indexed rarity, uint256 amount);

    error NotCardOwner();
    error BurnRateUnset(uint8 rarity);
    error GenesisNotBurnable();
    error CardDataReadFailed();

    constructor(address _packNFT, address _ap) Ownable(msg.sender) {
        require(_packNFT != address(0), "packNFT=0");
        require(_ap != address(0), "ap=0");
        packNFT = IRitualPackNFT(_packNFT);
        ap = IRitualAP(_ap);

        burnRates[0] = 5e18;
        burnRates[1] = 15e18;
        burnRates[2] = 50e18;
        burnRates[3] = 150e18;
        burnRates[4] = 500e18;
        burnRates[5] = 0; // GENESIS — locked non-burnable
    }

    function setBurnRate(uint8 rarity, uint256 amount) external onlyOwner {
        if (rarity > 5) revert("rarity out of range");
        if (rarity == 5) revert GenesisNotBurnable();
        burnRates[rarity] = amount;
        emit BurnRateUpdated(rarity, amount);
    }

    /// @notice Read rarity from RitualPackNFT.cardData() via raw staticcall.
    /// @dev    The NFT contract emits the rarity as a full 32-byte slot at offset 64-95,
    ///         with the rarity value in the LAST byte (matches standard
    ///         uint8 ABI placement). The earlier decoder tripped because
    ///         it assumed a standard packed struct layout; we read the
    ///         raw byte directly.
    function rarityOf(uint256 tokenId) public view returns (uint8) {
        bytes memory data = abi.encodeWithSignature("cardData(uint256)", tokenId);
        (bool ok, bytes memory result) = address(packNFT).staticcall(data);
        if (!ok || result.length < 96) revert CardDataReadFailed();
        // Rarity lives at the LAST byte of the second 32-byte slot (= byte 95).
        // Current layout: slot0 = packType, slot1 = cardId, slot2 = rarity.
        uint8 r = uint8(result[95]);
        return r;
    }

    function burnCard(uint256 tokenId) external nonReentrant {
        uint8 rarity = rarityOf(tokenId);
        if (rarity == 5) revert GenesisNotBurnable();
        if (packNFT.ownerOf(tokenId) != msg.sender) revert NotCardOwner();

        uint256 apReward = burnRates[rarity];
        if (apReward == 0) revert BurnRateUnset(rarity);

        packNFT.burn(tokenId);
        ap.mint(msg.sender, apReward);

        emit CardBurnFinished(msg.sender, tokenId, rarity, apReward);
    }

    function burnCards(uint256[] calldata tokenIds) external nonReentrant {
        uint256 len = tokenIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = tokenIds[i];
            uint8 rarity = rarityOf(tokenId);
            if (rarity == 5) revert GenesisNotBurnable();
            if (packNFT.ownerOf(tokenId) != msg.sender) revert NotCardOwner();

            uint256 apReward = burnRates[rarity];
            if (apReward == 0) revert BurnRateUnset(rarity);

            packNFT.burn(tokenId);
            ap.mint(msg.sender, apReward);

            emit CardBurnFinished(msg.sender, tokenId, rarity, apReward);
        }
    }
}
