export const achievementRegistryAbi = [
  {
    type: "function",
    name: "unlockAchievement",
    stateMutability: "nonpayable",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "achievementId", type: "bytes32" },
      { name: "points", type: "uint16" },
      { name: "sourceHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "batchUnlockAchievements",
    stateMutability: "nonpayable",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "achievementIds", type: "bytes32[]" },
      { name: "points", type: "uint16[]" },
      { name: "sourceHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "hasAchievement",
    stateMutability: "view",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "achievementId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getAchievementIds",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "getAchievement",
    stateMutability: "view",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "achievementId", type: "bytes32" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "points", type: "uint16" },
          { name: "unlockedAt", type: "uint64" },
          { name: "sourceHash", type: "bytes32" },
          { name: "version", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getAchievementScore",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getAchievementCount",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "trustedUpdaters",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setTrustedUpdater",
    stateMutability: "nonpayable",
    inputs: [
      { name: "updater", type: "address" },
      { name: "trusted", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "pause",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "unpause",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "event",
    name: "AchievementUnlocked",
    inputs: [
      { name: "wallet", type: "address", indexed: true },
      { name: "achievementId", type: "bytes32", indexed: true },
      { name: "points", type: "uint16", indexed: false },
      { name: "sourceHash", type: "bytes32", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TrustedUpdaterSet",
    inputs: [
      { name: "updater", type: "address", indexed: true },
      { name: "trusted", type: "bool", indexed: false },
    ],
  },
] as const;
