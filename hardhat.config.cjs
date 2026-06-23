require("dotenv").config();
require("dotenv").config({ path: ".env.admin.local", override: true });
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
// Official Ritual Chain testnet RPC (docs.ritualfoundation.org)
const RITUAL_RPC_URL = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 1000 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "none" },
    },
  },
  networks: {
    ritualTestnet: {
      url: RITUAL_RPC_URL,
      chainId: 1979,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  mocha: {
    // V5 clean test glob: only V5Clean.t.js runs. Archived tests live
    // under test/_archive_v5_rewrite/ and are excluded by the ! pattern.
    spec: ["test/V5Clean.t.js"],
    ignore: ["test/_archive_v5_rewrite/**/*"],
  },
};
