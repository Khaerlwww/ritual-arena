// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal interface for the AP ERC-20 burner.
/// @dev    The marketplace must be granted BURNER_ROLE on the AP
///         contract so it can call `burnFrom(this, listingFee)`.
interface IAPBurnable {
    function burnFrom(address from, uint256 amount) external;
}

/// @title  Ritual Marketplace — on-chain P2P NFT trading
/// @notice Sellers escrow their NFT into this contract. Buyers pay the
///         seller in on-chain **RitualAP** (ERC-20). The buy transaction
///         is atomic: AP transferFrom(buyer→seller) and NFT
///         transferFrom(marketplace→buyer) happen in the same call, so
///         if either step reverts, neither side moves.
///
///         AP is NOT minted by this contract — it only ever moves
///         existing AP. No backend signature, no off-chain ledger,
///         no settlement before tx confirmation.
///
///         Listing flow:
///           1. Seller approves AP for the marketplace (for the
///              1 AP listing fee).
///           2. Seller approves the NFT (setApprovalForAll).
///           3. Seller calls `list(tokenId, priceAp, expiry)`. The
///              listing fee is transferred seller→marketplace and
///              immediately burned. NFT is escrowed into the
///              marketplace. `expiry == 0` means no expiry.
///           4. Buyer approves AP for the marketplace (priceAp).
///           5. Buyer calls `buy(listingId)`. Atomic: AP moves
///              buyer→seller, NFT moves marketplace→buyer.
///
///         The marketplace never holds seller AP. The only AP in
///         flight during a buy is the `transferFrom` from the buyer
///         to the seller that completes in the same tx.
///
///         Fees:
///           - Listing fee: 1 AP, burned on `list()`.
///           - Buy fee: 0 AP (royalty 0%, tx fee 0%).
///           - Currency: AP only.
contract RitualMarketplace is Ownable, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    /// @notice The on-chain AP ERC-20 used for payment.
    IERC20 public immutable ap;

    /// @notice The on-chain AP ERC-20 used for fee burning (typed view).
    IAPBurnable public immutable apBurnable;

    /// @notice Flat listing fee charged once per `list()` call. 1e18 = 1 AP.
    /// @dev    Burned in the same transaction as the listing creation,
    ///         so the marketplace's AP balance never grows from fees.
    uint256 public constant LISTING_FEE = 1 ether;

    struct Listing {
        uint256 listingId;
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 priceAp;     // in AP wei (10^18 == 1 AP)
        uint64  listedAt;
        uint64  expiry;      // 0 = no expiry
        bool    active;
    }

    mapping(uint256 => Listing) public listings;
    mapping(address => uint256[]) private _sellerListings;
    uint256 public nextListingId = 1;

    event ItemListed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 priceAp,
        uint64 expiry
    );
    event ListingCancelled(uint256 indexed listingId, address indexed seller);
    event ItemBought(
        uint256 indexed listingId,
        address indexed seller,
        address indexed buyer,
        address nftContract,
        uint256 tokenId,
        uint256 priceAp
    );
    event ListingFeeBurned(
        uint256 indexed listingId,
        address indexed seller,
        uint256 amount
    );

    error ZeroAP();
    error ZeroNft();
    error ZeroPrice();
    error NotOwner();
    error NotActive();
    error NotSeller();
    error Expired();
    error SelfBuy();
    error InsufficientAPAllowance(uint256 needed, uint256 actual);
    error InsufficientAPBalance(uint256 needed, uint256 actual);
    error InsufficientListingFeeAllowance(uint256 needed, uint256 actual);
    error InsufficientListingFeeBalance(uint256 needed, uint256 actual);

    constructor(address ap_, address initialOwner_) Ownable(initialOwner_) {
        if (ap_ == address(0)) revert ZeroAP();
        ap = IERC20(ap_);
        apBurnable = IAPBurnable(ap_);
    }

    // -----------------------------------------------------------------
    // Seller: list / cancel
    // -----------------------------------------------------------------

    /// @notice List NFT `tokenId` of `nft` for `priceAp` AP, valid
    ///         until `expiry` (0 = no expiry). The seller must own the
    ///         NFT and have approved the marketplace for the NFT
    ///         (setApprovalForAll) and approved at least `LISTING_FEE`
    ///         AP for the marketplace (or this call will revert on
    ///         `transferFrom`).
    /// @dev    Charges a flat `LISTING_FEE` (1 AP), transferred from
    ///         the seller and burned in the same tx. This is the only
    ///         fee in the marketplace — `buy()` charges 0 AP. The fee
    ///         is burned (not retained) to keep the AP supply
    ///         deflationary as a function of trading volume.
    function list(address nft, uint256 tokenId, uint256 priceAp, uint64 expiry)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        if (nft == address(0)) revert ZeroNft();
        if (priceAp == 0) revert ZeroPrice();
        if (IERC721(nft).ownerOf(tokenId) != msg.sender) revert NotOwner();

        // 1) Collect + burn listing fee. Pre-flight checks give clean
        //    error reasons instead of raw SafeERC20 reverts. The burn
        //    requires the marketplace to hold BURNER_ROLE on the AP
        //    contract — see deploy script `setBurner(marketplace, true)`.
        uint256 feeBal = ap.balanceOf(msg.sender);
        if (feeBal < LISTING_FEE) {
            revert InsufficientListingFeeBalance(LISTING_FEE, feeBal);
        }
        uint256 feeAllow = ap.allowance(msg.sender, address(this));
        if (feeAllow < LISTING_FEE) {
            revert InsufficientListingFeeAllowance(LISTING_FEE, feeAllow);
        }
        // Pull fee into the marketplace, then burn it immediately so
        // this contract never holds any accumulated fee AP.
        ap.safeTransferFrom(msg.sender, address(this), LISTING_FEE);
        apBurnable.burnFrom(address(this), LISTING_FEE);

        // 2) Escrow NFT: the seller must approve this contract
        //    (setApprovalForAll is the standard flow). transferFrom
        //    reverts on missing approval.
        IERC721(nft).transferFrom(msg.sender, address(this), tokenId);

        listingId = nextListingId++;
        listings[listingId] = Listing({
            listingId: listingId,
            seller: msg.sender,
            nftContract: nft,
            tokenId: tokenId,
            priceAp: priceAp,
            listedAt: uint64(block.timestamp),
            expiry: expiry,
            active: true
        });
        _sellerListings[msg.sender].push(listingId);

        emit ListingFeeBurned(listingId, msg.sender, LISTING_FEE);
        emit ItemListed(listingId, msg.sender, nft, tokenId, priceAp, expiry);
    }

    /// @notice Cancel your own listing. NFT returns to seller.
    function cancel(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (!listing.active) revert NotActive();
        if (listing.seller != msg.sender) revert NotSeller();

        listing.active = false;
        IERC721(listing.nftContract).transferFrom(
            address(this), msg.sender, listing.tokenId
        );

        emit ListingCancelled(listingId, msg.sender);
    }

    // -----------------------------------------------------------------
    // Buyer: atomic buy
    // -----------------------------------------------------------------

    /// @notice Buy listing `listingId`. Atomic: AP and NFT move in the
    ///         same tx, or both revert. The buyer must have approved
    ///         the marketplace for at least `priceAp` AP beforehand.
    /// @dev    Checks (in order):
    ///           - listing active
    ///           - not expired
    ///           - buyer != seller
    ///           - buyer has enough AP balance
    ///           - buyer has approved AP for >= priceAp
    ///         All checks happen before any state mutation. The
    ///         `transferFrom` calls below are the actual state moves;
    ///         if either reverts, the entire tx reverts.
    function buy(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (!listing.active) revert NotActive();
        if (msg.sender == listing.seller) revert SelfBuy();
        if (listing.expiry != 0 && block.timestamp > listing.expiry) revert Expired();

        address buyer = msg.sender;
        address seller = listing.seller;
        address nft = listing.nftContract;
        uint256 tokenId = listing.tokenId;
        uint256 priceAp = listing.priceAp;

        // 1) Pre-flight balance + allowance. Done as explicit checks
        //    so the user gets a clean error message rather than a
        //    raw SafeERC20 revert.
        uint256 bal = ap.balanceOf(buyer);
        if (bal < priceAp) revert InsufficientAPBalance(priceAp, bal);
        uint256 allow = ap.allowance(buyer, address(this));
        if (allow < priceAp) revert InsufficientAPAllowance(priceAp, allow);

        // 2) Flip state BEFORE external calls. If the NFT transfer
        //    reverts (e.g. contract paused, or token burned), the AP
        //    transfer is also in the same tx and reverts too — atomic.
        listing.active = false;

        // 3) AP transferFrom: buyer → seller. Uses SafeERC20.
        ap.safeTransferFrom(buyer, seller, priceAp);

        // 4) NFT transferFrom: marketplace → buyer.
        IERC721(nft).transferFrom(address(this), buyer, tokenId);

        emit ItemBought(listingId, seller, buyer, nft, tokenId, priceAp);
    }

    // -----------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    /// @notice All currently-active listings. Testnet scope: bounded by
    ///         `nextListingId`, not unbounded.
    function getActiveListings() external view returns (Listing[] memory out) {
        uint256 count = 0;
        uint256 total = nextListingId;
        for (uint256 i = 1; i < total; i++) {
            if (listings[i].active) count++;
        }
        out = new Listing[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i < total; i++) {
            if (listings[i].active) {
                out[idx++] = listings[i];
            }
        }
    }

    function getListingsBySeller(address seller) external view returns (uint256[] memory) {
        return _sellerListings[seller];
    }

    // -----------------------------------------------------------------
    // ERC-721 receiver hook (required to receive NFTs via transferFrom)
    // -----------------------------------------------------------------

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
