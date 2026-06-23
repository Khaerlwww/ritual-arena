// Burn surface only — full ABI in ritualPackNftAbi.ts is what useOpenPack uses.
export const RITUAL_PACK_NFT_BURN_ABI = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "rarity",
        "type": "uint8"
      }
    ],
    "name": "CardBurned",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "burn",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "cardData",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "packType",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "cardId",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "rarity",
        "type": "uint8"
      },
      {
        "internalType": "uint16",
        "name": "power",
        "type": "uint16"
      },
      {
        "internalType": "string",
        "name": "role",
        "type": "string"
      },
      {
        "internalType": "uint64",
        "name": "mintedAt",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
