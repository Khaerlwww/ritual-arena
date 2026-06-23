// RitualTraining ABI for the repo-source canonical deployment.
// Training address is defined in src/lib/chains.ts.
// Per contracts/training/RitualTraining.sol:
//   - getCardProgress(tokenId) — read progress (NOT getProgress, that name is stale)
//   - getTrainingRecord(tokenId, i) — read history entry
//   - trainingHistoryCount(tokenId) — read count of history records
//   - No public canTrain() — derive locally from cardProgress.lastTrainedAt + cooldown
//   - train() — write, no args (reads msg.sender + token from IdentityCard)

export const ritualTrainingAbi = [
  {
    type: "function",
    name: "train",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [
      { name: "totalXp", type: "uint256" },
      { name: "levelAfter", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getCardProgress",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "totalXp",       type: "uint256" },
          { name: "apEarned",      type: "uint256" },
          { name: "trainCount",    type: "uint64" },
          { name: "lastTrainedAt", type: "uint64" },
          { name: "createdAt",     type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getTrainingRecord",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "i", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "trainedAt",   type: "uint64"  },
          { name: "levelAfter",  type: "uint64"  },
          { name: "xpGained",    type: "uint256" },
          { name: "apGained",    type: "uint256" },
        ],
      },
    ],
  },
  // Public state variable getter (auto-generated)
  {
    type: "function",
    name: "trainingHistoryCount",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Constants — V5 has both TRAINING_COOLDOWN_MS (72_000_000) and
  // TRAINING_COOLDOWN_S (72000) due to the Ritual block.timestamp-ms bug.
  // Pick MS or S based on the local _cooldown() switch.
  { type: "function", name: "XP_PER_TRAIN",        stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "AP_PER_TRAIN",        stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "LEVEL_SIZE",          stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "TRAINING_COOLDOWN_MS",stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "TRAINING_COOLDOWN_S", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "HISTORY_SIZE",        stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  // Admin / wired addresses
  { type: "function", name: "owner",              stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "identityRegistry",   stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "setIdentityRegistry",
    stateMutability: "nonpayable",
    inputs: [{ name: "registry_", type: "address" }],
    outputs: [],
  },
  {
    type: "event",
    name: "CardTrained",
    inputs: [
      { name: "tokenId",    type: "uint256", indexed: true  },
      { name: "wallet",     type: "address", indexed: true  },
      { name: "xpGained",   type: "uint256", indexed: false },
      { name: "apGained",   type: "uint256", indexed: false },
      { name: "totalXp",    type: "uint256", indexed: false },
      { name: "levelAfter", type: "uint256", indexed: false },
    ],
  },
] as const;
