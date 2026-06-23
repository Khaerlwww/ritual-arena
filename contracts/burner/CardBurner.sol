// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal interface for the RitualPackNFT V9 burn surface.
interface IRitualPackNFT {
    struct CardData {
        uint8  packType;
        uint256 cardId;
        uint8  rarity;
        uint16 power;
        string role;
        uint64 mintedAt;
    }
    function cardData(uint256 tokenId) external view returns (CardData memory);
    function ownerOf(uint256 tokenId) external view returns (address);
    function burn(uint256 tokenId) external;
}

/// @notice Minimal interface for the RitualAP ERC-20 mint surface.
interface IRitualAP {
    function mint(address to, uint256 amount) external;
}

/// @title  Card Burner — NFT Sink for AP Recycling
/// @notice Players burn unwanted RitualPackNFT cards to mint fresh AP.
///         Deflationary mechanism: burned serial slots are gone forever
///         (PackManager.serialByRarity is NOT decremented) — this
///         protects scarcity of remaining cards and gives every card a
///         floor value (5 AP for Common, up to 500 AP for Mythic).
///
/// @dev    Owner of CardBurner must hold MINTER_ROLE on RitualAP so that
///         burnCard() can mint fresh AP to the burner. Player must call
///         setApprovalForAll(CardBurner, true) on RitualPackNFT once
///         before any burnCard() call.
///
///         GENESIS (rarity 5) is non-burnable — locked at the packNFT layer
///         so admin-mint rarity stays ultra-scarce. burnRate[5] is left
///         at 0 as a defensive double-check.
contract CardBurner is Ownable, ReentrancyGuard {
    IRitualPackNFT public immutable packNFT;
    IRitualAP      public immutable ap;

    /// @notice burnRates[rarity] = AP wei paid for burning a card of that rarity.
    ///         Default table (matches docs/CONTRACTS.md):
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

    constructor(address _packNFT, address _ap) Ownable(msg.sender) {
        require(_packNFT != address(0), "packNFT=0");
        require(_ap != address(0), "ap=0");
        packNFT = IRitualPackNFT(_packNFT);
        ap = IRitualAP(_ap);

        // Default rates — owner can override via setBurnRate().
        burnRates[0] = 5e18;
        burnRates[1] = 15e18;
        burnRates[2] = 50e18;
        burnRates[3] = 150e18;
        burnRates[4] = 500e18;
        burnRates[5] = 0; // GENESIS — locked non-burnable
    }

    /// @notice Owner-only rate adjustment. Set to 0 to disable burning
    ///         for a rarity tier (e.g. if the economy needs a cooling-off).
    function setBurnRate(uint8 rarity, uint256 amount) external onlyOwner {
        if (rarity > 5) revert("rarity out of range");
        if (rarity == 5) revert GenesisNotBurnable();
        burnRates[rarity] = amount;
        emit BurnRateUpdated(rarity, amount);
    }

    /// @notice Burn a single card and mint the corresponding AP.
    ///         Player must own the card AND have approved CardBurner
    ///         (setApprovalForAll on packNFT) beforehand.
    function burnCard(uint256 tokenId) external nonReentrant {
        IRitualPackNFT.CardData memory card = packNFT.cardData(tokenId);
        if (card.rarity == 5) revert GenesisNotBurnable();
        if (packNFT.ownerOf(tokenId) != msg.sender) revert NotCardOwner();

        uint256 apReward = burnRates[card.rarity];
        if (apReward == 0) revert BurnRateUnset(card.rarity);

        // Effects + interactions: burn NFT first (clears state), then mint AP.
        // Reentrancy guard prevents mid-burn re-entry.
        packNFT.burn(tokenId);
        ap.mint(msg.sender, apReward);

        emit CardBurnFinished(msg.sender, tokenId, card.rarity, apReward);
    }

    /// @notice Batch variant — burns N cards sequentially. Gas cost is
    ///         roughly N * (burn gas + mint gas). Caller passes tokenIds;
    ///         all must be owned by msg.sender. Stops at first failure.
    function burnCards(uint256[] calldata tokenIds) external nonReentrant {
        uint256 totalAp = 0;
        uint256 len = tokenIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = tokenIds[i];
            IRitualPackNFT.CardData memory card = packNFT.cardData(tokenId);
            if (card.rarity == 5) revert GenesisNotBurnable();
            if (packNFT.ownerOf(tokenId) != msg.sender) revert NotCardOwner();

            uint256 apReward = burnRates[card.rarity];
            if (apReward == 0) revert BurnRateUnset(card.rarity);

            packNFT.burn(tokenId);
            ap.mint(msg.sender, apReward);
            totalAp += apReward;

            emit CardBurnFinished(msg.sender, tokenId, card.rarity, apReward);
        }
    }
}
