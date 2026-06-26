// Auto-extracted from artifacts/contracts/burner/CardBurnerV2.sol/CardBurnerV2.json
// V2 reads rarity from current RitualPackNFT via raw staticcall + assembly
// (current cardData emits a non-standard ABI layout that breaks Solidity's
// built-in struct decoder).
export const CARD_BURNER_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "_packNFT", "type": "address" },
      { "internalType": "address", "name": "_ap",      "type": "address" }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [{ "internalType": "uint8", "name": "rarity", "type": "uint8" }],
    "name": "BurnRateUnset",
    "type": "error"
  },
  { "inputs": [], "name": "CardDataReadFailed", "type": "error" },
  { "inputs": [], "name": "GenesisNotBurnable", "type": "error" },
  { "inputs": [], "name": "NotCardOwner",       "type": "error" },
  { "inputs": [{ "internalType": "address", "name": "owner",   "type": "address" }], "name": "OwnableInvalidOwner",        "type": "error" },
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "OwnableUnauthorizedAccount", "type": "error" },
  { "inputs": [], "name": "ReentrancyGuardReentrantCall", "type": "error" },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "uint8",   "name": "rarity", "type": "uint8" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "BurnRateUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "address", "name": "player",   "type": "address" },
      { "indexed": true,  "internalType": "uint256", "name": "tokenId",  "type": "uint256" },
      { "indexed": true,  "internalType": "uint8",   "name": "rarity",   "type": "uint8" },
      { "indexed": false, "internalType": "uint256", "name": "apEarned", "type": "uint256" }
    ],
    "name": "CardBurnFinished",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "newOwner",      "type": "address" }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "ap",
    "outputs": [{ "internalType": "contract IRitualAP", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "burnCard",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256[]", "name": "tokenIds", "type": "uint256[]" }],
    "name": "burnCards",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "name": "burnRates",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "packNFT",
    "outputs": [{ "internalType": "contract IRitualPackNFT", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "rarityOf",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "renounceOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint8",   "name": "rarity", "type": "uint8" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "setBurnRate",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "newOwner", "type": "address" }],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
