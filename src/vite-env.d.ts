/// <reference types="vite/client" />
interface Window { ethereum?: any }
interface ImportMetaEnv {
  // ── Network ──
  readonly VITE_RITUAL_CHAIN_ID?: string;
  readonly VITE_RITUAL_RPC_URL?: string;
  readonly VITE_RITUAL_RPC_URL_2?: string;
  readonly VITE_RITUAL_EXPLORER_URL?: string;

  // ── Smart Contracts (canonical VITE_RITUAL_*_ADDRESS convention) ──
  // All contract addresses follow VITE_RITUAL_*_ADDRESS. Legacy keys
  // (VITE_ANTHEM_ADDRESS, VITE_ARENA_ADDRESS, VITE_TRAINING_ADDRESS,
  // VITE_STAKING_ADDRESS, VITE_ACHIEVEMENT_REGISTRY_ADDRESS,
  // VITE_IDENTITY_REGISTRY_ADDRESS) were removed in the V5 env
  // standardization. See src/lib/chains.ts for the single source of
  // truth and .env.example for the canonical values.
  readonly VITE_RITUAL_ANTHEM_ADDRESS?: `0x${string}`;
  readonly VITE_RITUAL_ARENA_ADDRESS?: `0x${string}`;
  readonly VITE_RITUAL_TRAINING_ADDRESS?: `0x${string}`;
  readonly VITE_RITUAL_STAKING_ADDRESS?: `0x${string}`;
  readonly VITE_RITUAL_ACHIEVEMENT_REGISTRY_ADDRESS?: `0x${string}`;
  readonly VITE_RITUAL_IDENTITY_REGISTRY_ADDRESS?: `0x${string}`;
  readonly VITE_RITUAL_IDENTITY_CARD_ADDRESS?: `0x${string}`;
  readonly VITE_RITUAL_AP_ADDRESS?: `0x${string}`;
  readonly VITE_RITUAL_PACK_NFT_ADDRESS?: `0x${string}`;
  readonly VITE_RITUAL_PACK_MANAGER_ADDRESS?: `0x${string}`;
  readonly VITE_RITUAL_MARKETPLACE_ADDRESS?: `0x${string}`;

  // ── Modes ──
  readonly AP_MODE?: string;
  readonly PACK_MODE?: string;
  readonly MARKETPLACE_MODE?: string;

  // ── IPFS / Attestation ──
  readonly VITE_ATTESTATION_URL?: string;
  readonly VITE_IPFS_UPLOAD_URL?: string;
  readonly VITE_IPFS_GATEWAYS?: string;
  readonly VITE_IPFS_GATEWAY?: string;
}
