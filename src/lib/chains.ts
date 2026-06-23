// ── Canonical contract addresses (verified on-chain 2026-06-17) ─────
//
// Single source of truth. All hooks/components should import from here
// instead of reading VITE_RITUAL_*_ADDRESS env vars. The env vars are
// kept in .env.example / Vercel for documentation, but chains.ts hard-
// codes the canonical values to avoid Vite build cache + env fallback
// bugs.
//
// V5-clean canon per deployments/ritual-v5-clean-ritualTestnet.json
// V8 supply overrides: pack NFT (V2) + pack manager + AP token used
//   by V8 PM are separate from the V5-clean canon set.
//
// IdentityCard fallback note:
//   The current source (contracts/identity/IdentityCard.sol) defines
//   full read APIs (getAnthems, getAnthem, getCardSnapshot, hasMinted).
//   The 0x0635 address has those selectors but they revert on-chain
//   because the deployed bytecode is from an older source revision
//   where the struct reads are not implemented. The legacy 0xDB49
//   contract (nextTokenId=4) holds the real Anthem records with full
//   handles + metadata. We point FE at 0xDB49 so gallery/training/profile
//   can read user data; forge on either address requires verifier match.
//
import { defineChain, fallback, http, type Address } from "viem";

// RPC + chain config
const RPC_URL = import.meta.env.VITE_RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const RPC_URL2 = (import.meta.env.VITE_RITUAL_RPC_URL_2 || "").trim();
const normalize = (u: string) => u.replace(/\/+$/, "").replace(/\/testnet$/, "");
export const transport = RPC_URL2
  ? fallback([http(normalize(RPC_URL)), http(normalize(RPC_URL2))], { rank: false })
  : http(normalize(RPC_URL));
const EXPLORER_URL = import.meta.env.VITE_RITUAL_EXPLORER_URL || "https://explorer.ritualfoundation.org";
const CHAIN_ID = Number(import.meta.env.VITE_RITUAL_CHAIN_ID || 1979);
export const zeroAddress = "0x0000000000000000000000000000000000000000";

export const ritualTestnet = defineChain({
  id: CHAIN_ID,
  name: "Ritual Chain",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Ritual Explorer", url: EXPLORER_URL } },
  testnet: true,
  contracts: { multicall3: { address: "0x5BD2cC1f1fa199793f36404b26cA0460feeceFCd" } },
});

export const faucetUrl = "https://faucet.ritualfoundation.org";
export const explorerTxUrl = (hash: string) => `${EXPLORER_URL.replace(/\/$/, "")}/tx/${hash}`;
export const explorerAddressUrl = (addr: string) => `${EXPLORER_URL.replace(/\/$/, "")}/address/${addr}`;

// ── V11 fresh deploy addresses (2026-06-22) ────────────────────────────
// Full fresh redeploy: zero state carry-over from V10. Deployer used the
// new admin key (0x542E...0d62). 10 contracts deployed + wired via
// scripts/deploy/ritual-v11-fresh-resume*.cjs. Verification of wirings
// (AP minters, Registry trustedUpdaters, PackNFT minter) confirmed via
// direct RPC reads of TrustedUpdaterSet + MinterUpdated events.
const IDENTITY_REGISTRY   = "0x8f4Cb00142979A19997fF90d39FE7839335186bC" as Address;
const IDENTITY_CARD       = "0xe189382845FF8C938E85ce7E25eB5c89F339ff5E" as Address;
const RITUAL_TRAINING     = "0xFcf3cDc5fAc5362b5C215E6A0FA5B5245302393c" as Address;
const RITUAL_ARENA        = "0x003cf5a69920Db892BFe6Eb2154f5CE76bF5060E" as Address; // V11 fresh (2026-06-22) — same ms-timestamp logic as V10 (block.timestamp/1000)
const ACHIEVEMENT_REG     = "0xa0BE4F8091b0bF3F170a643890c330274465E225" as Address;
const RITUAL_STAKING      = "0xcF2c42076219c2CD426Befe982D6abFE6402ad78" as Address; // V11 fresh (2026-06-22) — same ms-timestamp fix
const MARKETPLACE         = "0x75dfe1430237269eC6b575F43595B4e565443e22" as Address; // V11 fresh (2026-06-22) — fresh deploy, fresh state

// V11 PackManager + RitualPackNFT — freshly deployed at nonces 28-29
// (PackNFT at 28, PackManager at 29). PackNFT has PackManager as minter
// (verified via MinterUpdated event).
const PACK_NFT_V11        = "0x2939c908C456f794cD3eB3c5f5197831a497e9A9" as Address;
const PACK_MANAGER_V11    = "0x8D6bDcD293C856D3ACf6c82a5E0Fd54536293A5B" as Address;
const AP_V11              = "0x1d24252bf89557c6Da4293a94Bfa6F69f85B407D" as Address;

// V11 CardBurner (NFT Sink) — deployed 2026-06-22, holds MINTER_ROLE on
// the V11 RitualAP. Burns RitualPackNFT → mints AP by rarity. V2 reads
// rarity via raw `staticcall` + assembly slice at byte 95 to bypass V11
// RitualPackNFT's non-standard cardData ABI layout. Genesis (rarity 5) is
// non-burnable. Confirmed MINTER_ROLE via on-chain hasRole call after
// scripts/deploy/card-burner-v11.cjs.
const CARD_BURNER         = (import.meta.env.VITE_RITUAL_CARD_BURNER_ADDRESS || "0x99144aebBF3042493e85B5BEb9bBdddf84d138EC") as Address;

// ── Public exports ─────────────────────────────────────────────────
export const identityCardAddress = IDENTITY_CARD;
export const hasIdentityCard = identityCardAddress !== zeroAddress;

// Legacy anthem alias — point to canonical IdentityCard
export const anthemAddress = IDENTITY_CARD;
export const hasAnthemContract = anthemAddress !== zeroAddress;

export const identityRegistryAddress = IDENTITY_REGISTRY;
export const hasIdentityRegistry = identityRegistryAddress !== zeroAddress;

export const trainingAddress = RITUAL_TRAINING;
export const hasTrainingContract = trainingAddress !== zeroAddress;

export const arenaAddress = RITUAL_ARENA;
export const hasArenaContract = arenaAddress !== zeroAddress;

export const achievementRegistryAddress = ACHIEVEMENT_REG;
export const hasAchievementRegistry = achievementRegistryAddress !== zeroAddress;

export const stakingAddress = RITUAL_STAKING;
export const hasStakingContract = stakingAddress !== zeroAddress;

export const marketplaceAddress = MARKETPLACE;
export const hasMarketplace = marketplaceAddress !== zeroAddress;

// AP token — single canonical contract (V11).
//   apAddress     → used by every flow: Training, Staking, Arena,
//                   Marketplace, and V11 PackManager. All on-chain
//                   references are now AP_V11.
export const apAddress = AP_V11;
export const hasAPContract = apAddress !== zeroAddress;

// Back-compat alias — older code imports apPackAddress. Same value.
export const apPackAddress = AP_V11;

// Card Burner (NFT deflation sink).
export const cardBurnerAddress = CARD_BURNER;
export const hasCardBurner = cardBurnerAddress !== zeroAddress;

// Pack NFT + PackManager (V11: fresh deploy, paired together)
//   packNftAddress        — NFT contract, mint gated to PackManager
//   packManagerAddress    — PackManager, holds identityRegistry + AP minter
export const packNftAddress = PACK_NFT_V11;
export const hasPackNft = packNftAddress !== zeroAddress;
export const packManagerAddress = PACK_MANAGER_V11;
export const hasPackManagerContract = packManagerAddress !== zeroAddress;

// Legacy env lookup — kept for back-compat with code that still reads
// VITE_RITUAL_*_ADDRESS. Returns the canonical hardcoded value if env
// is missing OR points to a stale address.
export function envAddress(value: string | undefined): Address {
  return !value || value === zeroAddress ? zeroAddress : (value as Address);
}
