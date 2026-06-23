// src/lib/marketplaceAbi.ts
// Minimal ABI slice for RitualMarketplace (V5 — on-chain atomic buy).

export const RITUAL_MARKETPLACE_ABI = [
  // list(nft, tokenId, priceAp, expiry) → listingId
  {
    type: "function",
    name: "list",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nft", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "priceAp", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "listingId", type: "uint256" }],
  },
  // cancel(listingId)
  {
    type: "function",
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [],
  },
  // buy(listingId) — atomic AP+NFT transfer
  {
    type: "function",
    name: "buy",
    stateMutability: "nonpayable",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [],
  },
  // getListing(listingId)
  {
    type: "function",
    name: "getListing",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "listingId", type: "uint256" },
          { name: "seller", type: "address" },
          { name: "nftContract", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "priceAp", type: "uint256" },
          { name: "listedAt", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  // getActiveListings()
  {
    type: "function",
    name: "getActiveListings",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "listingId", type: "uint256" },
          { name: "seller", type: "address" },
          { name: "nftContract", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "priceAp", type: "uint256" },
          { name: "listedAt", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  // getListingsBySeller(address)
  {
    type: "function",
    name: "getListingsBySeller",
    stateMutability: "view",
    inputs: [{ name: "seller", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  // ap() — AP token reference
  {
    type: "function",
    name: "ap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // LISTING_FEE() — constant 1e18 (1 AP), burned on list()
  {
    type: "function",
    name: "LISTING_FEE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Events
  {
    type: "event",
    name: "ItemListed",
    anonymous: false,
    inputs: [
      { indexed: true, name: "listingId", type: "uint256" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: true, name: "nftContract", type: "address" },
      { indexed: false, name: "tokenId", type: "uint256" },
      { indexed: false, name: "priceAp", type: "uint256" },
      { indexed: false, name: "expiry", type: "uint64" },
    ],
  },
  {
    type: "event",
    name: "ListingCancelled",
    anonymous: false,
    inputs: [
      { indexed: true, name: "listingId", type: "uint256" },
      { indexed: true, name: "seller", type: "address" },
    ],
  },
  {
    type: "event",
    name: "ItemBought",
    anonymous: false,
    inputs: [
      { indexed: true, name: "listingId", type: "uint256" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: false, name: "nftContract", type: "address" },
      { indexed: false, name: "tokenId", type: "uint256" },
      { indexed: false, name: "priceAp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "ListingFeeBurned",
    anonymous: false,
    inputs: [
      { indexed: true, name: "listingId", type: "uint256" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const;
