// src/lib/packNftAbi.ts
// Collection NFT ABI slice.
//
// V10 contract layout (re-deployed 2026-06-21, address 0xc381fCd8f673E673Bd0927b2dd33B6C189570342):
//   struct CardData {
//     uint8   packType;   // 0 = INITIATE, 1 = RITUALIST
//     uint256 cardId;     // pool-card-type identity (NOT NFT tokenId)
//     uint8   rarity;     // 0=INITIATE 1=BITTY 2=RITTY 3=RITUALIST 4=RADIANT 5=GENESIS
//     uint16  power;      // 1..100
//     string  role;
//     uint64  mintedAt;   // unix seconds
//   }
//   function mint(address to, uint8 packType, uint256 cardId, uint8 rarity, uint16 power, string role, string metadataURI) onlyRole(MINTER_ROLE) returns (uint256 tokenId)
//   function cardData(uint256 tokenId) view returns (CardData)
//   function burn(uint256 tokenId)  // V10: deflation sink, owner-or-approved only, GENESIS rejected
//   function setApprovalForAll(address operator, bool approved)  // ERC721 standard
//
// NOTE: serialNumber + maxSupply live on the pack manager (not on the NFT):
//   - serialNumber: minted supply for the card id
//   - maxSupply:    maximum supply for the card id
// See the pack manager ABI for those getters.

export const RITUAL_PACK_NFT_ABI = [
  // ── Mint (only callable by MINTER_ROLE — usually PackManager) ──────
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",          type: "address" },
      { name: "packType",    type: "uint8"   },
      { name: "cardId",      type: "uint256" },
      { name: "rarity",      type: "uint8"   },
      { name: "power",       type: "uint16"  },
      { name: "role",        type: "string"  },
      { name: "metadataURI", type: "string"  },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },

  // ── V9 CardData struct (event/struct signature) ─
  // NOTE: actual decoding uses the custom `packCardDataDecoder` helper
  // (NOT viem's tuple decoder), because viem 2.52.x miscalculates the
  // dynamic-string offset inside a tuple-with-string and throws
  // "Position 49153 out of bounds". The ABI here is kept for encode +
  // type-only purposes.
  {
    type: "function",
    name: "cardData",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "packType", type: "uint8"   },
          { name: "cardId",   type: "uint256" },
          { name: "rarity",   type: "uint8"   },
          { name: "power",    type: "uint16"  },
          { name: "role",     type: "string"  },
          { name: "mintedAt", type: "uint64"  },
        ],
      },
    ],
  },

  // ── ERC721 + ERC721Enumerable ──────────────────────────────────────
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenByIndex",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool"    },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "owner",    type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",      type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getApproved",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },

  // ── V9 CardMinted event (event/struct signature) ──
  // event CardMinted(uint256 indexed tokenId, address indexed to, uint8 packType, uint256 cardId, uint8 rarity, uint16 power, string role, string metadataURI);
  {
    type: "event",
    name: "CardMinted",
    inputs: [
      { name: "tokenId",     type: "uint256", indexed: true  },
      { name: "to",          type: "address", indexed: true  },
      { name: "packType",    type: "uint8",   indexed: false },
      { name: "cardId",      type: "uint256", indexed: false },
      { name: "rarity",      type: "uint8",   indexed: false },
      { name: "power",       type: "uint16",  indexed: false },
      { name: "role",        type: "string",  indexed: false },
      { name: "metadataURI", type: "string",  indexed: false },
    ],
  },
];
