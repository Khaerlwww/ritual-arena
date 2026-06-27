// src/lib/packManagerAbi.ts
// Pack manager ABI slice.
//
// V10 contract layout (re-deployed 2026-06-21, address 0xAd96175CaA412C3D42BCcF6C59eC2Fc8ee2c8CCb):
//   struct PackConfig { uint256 apCost; uint16 bps0..bps4; }    // rarity BPS (0..4)
//   PackConfig public initiatePack; PackConfig public ritualPack;
//   RitualPackNFT public immutable card;                        // = PackNFT
//   IERC20         public immutable ap;                         // = RitualAP
//   IIdentityRegistryForPackManager public identityRegistry;
//   mapping(uint8 => uint256) public maxByRarity;
//   mapping(uint256 => uint256) public mintedByCardId;          // serialNumber source
//   mapping(uint256 => uint256) public maxSupplyOf;             // maxSupply source
//   mapping(uint8 => uint256) public defaultMaxByRarity;
//   function openInitiatePack() / openRitualistPack() returns (uint256[] tokenIds)
//
// Events:
//   PackOpened(address indexed user, uint8 packType, uint256 tokenId, uint256 cardId, uint8 rarity, string role, uint256 serial, uint256 apCost)
//   PackOpenedBatch(address indexed user, uint8 packType, uint256[] tokenIds, uint8[] rarities, uint256[] serials)
//   PoolCardAdded(uint8 indexed packType, uint256 cardId, uint8 rarity, uint256 maxSupply)
//   PackSoldOut(uint256 cardId, uint256 maxSupply)
//   PackConfigUpdated(uint8 packType, uint256 apCost)

export const PACK_MANAGER_ABI = [
  // ── Pack open (entry points) ────────────────────────────────────────
  {
    type: "function",
    name: "openInitiatePack",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "tokenIds", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "openRitualistPack",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "tokenIds", type: "uint256[]" }],
  },

  // ── PackConfig public storage getters (auto-generated) ──────────────
  {
    type: "function",
    name: "initiatePack",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "apCost", type: "uint256" },
          { name: "bps0",   type: "uint16"  }, // INITIATE  (Common)
          { name: "bps1",   type: "uint16"  }, // BITTY     (Rare)
          { name: "bps2",   type: "uint16"  }, // RITTY     (Epic)
          { name: "bps3",   type: "uint16"  }, // RITUALIST (Legendary)
          { name: "bps4",   type: "uint16"  }, // RADIANT   (Mythic)
        ],
      },
    ],
  },
  {
    type: "function",
    name: "ritualPack",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "apCost", type: "uint256" },
          { name: "bps0",   type: "uint16"  },
          { name: "bps1",   type: "uint16"  },
          { name: "bps2",   type: "uint16"  },
          { name: "bps3",   type: "uint16"  },
          { name: "bps4",   type: "uint16"  },
        ],
      },
    ],
  },

  // ── Pool inspection ────────────────────────────────────────────────
  {
    type: "function",
    name: "poolSize",
    stateMutability: "view",
    inputs: [{ name: "packType", type: "uint8" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Per-card supply tracking (V9 supply model — replaces PackNFT's
  // serialNumber/maxSupply fields from the old V8 layout).
  {
    type: "function",
    name: "mintedByCardId",
    stateMutability: "view",
    inputs: [{ name: "cardId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxSupplyOf",
    stateMutability: "view",
    inputs: [{ name: "cardId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxByRarity",
    stateMutability: "view",
    inputs: [{ name: "rarity", type: "uint8" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "defaultMaxByRarity",
    stateMutability: "view",
    inputs: [{ name: "rarity", type: "uint8" }],
    outputs: [{ name: "", type: "uint256" }],
  },

  // ── Address getters (immutable + mutable) ───────────────────────────
  {
    type: "function",
    name: "card",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "ap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "identityRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },

  // ── Events (event signature) ──────────────
  // PackOpened(address indexed opener, uint8 indexed packType, uint256 indexed tokenId,
  //            uint256 cardId, uint8 rarity, string role, uint256 serial, uint256 apCost)
  {
    type: "event",
    name: "PackOpened",
    inputs: [
      { name: "opener",   type: "address", indexed: true  },
      { name: "packType", type: "uint8",   indexed: true  },
      { name: "tokenId",  type: "uint256", indexed: true  },
      { name: "cardId",   type: "uint256", indexed: false },
      { name: "rarity",   type: "uint8",   indexed: false },
      { name: "role",     type: "string",  indexed: false },
      { name: "serial",   type: "uint256", indexed: false },
      { name: "apCost",   type: "uint256", indexed: false },
    ],
  },
  // PackOpenedBatch(address indexed opener, uint8 indexed packType,
  //                 uint256[] tokenIds, uint8[] rarities, uint256[] serials)
  // — emitted once per pack with all 3 tokenIds; use this for FE pack-open
  //   flow because decoding a single event is cheaper than 3 PackOpened.
  {
    type: "event",
    name: "PackOpenedBatch",
    inputs: [
      { name: "opener",   type: "address",   indexed: true  },
      { name: "packType", type: "uint8",     indexed: true  },
      { name: "tokenIds", type: "uint256[]", indexed: false },
      { name: "rarities", type: "uint8[]",   indexed: false },
      { name: "serials",  type: "uint256[]", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PoolCardAdded",
    inputs: [
      { name: "packType",  type: "uint8",   indexed: true  },
      { name: "cardId",    type: "uint256", indexed: false },
      { name: "rarity",    type: "uint8",   indexed: false },
      { name: "maxSupply", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PackSoldOut",
    inputs: [
      { name: "cardId",    type: "uint256", indexed: false },
      { name: "maxSupply", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PackConfigUpdated",
    inputs: [
      { name: "packType", type: "uint8",   indexed: false },
      { name: "apCost",   type: "uint256", indexed: false },
    ],
  },
];
