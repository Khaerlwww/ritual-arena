# Deployment

## Networks

### Ritual Chain Testnet (current)

- **chainId**: 1979
- **RPC**: `https://rpc.ritualfoundation.org`
- **Explorer**: `https://explorer.ritualfoundation.org`
- **Faucet**: `https://faucet.ritualfoundation.org`
- **Native token**: RITUAL

> **Timestamp quirk**: `block.timestamp` is in **milliseconds**, not seconds. Contracts that store timestamps for later comparison must divide by 1000 (see `_now()` in `RitualStaking.sol`). Frontend reads ms-aware values via auto-detect (see `src/lib/ritualTime.ts`).

## Active Contract Addresses

**Canonical source of truth**: `deployments/ritual-1979-v9-fresh.json` (V9 fresh deploy + ms-fix staking redeploy + correct-AP marketplace redeploy).

| Contract | Address |
|---|---|
| RitualAP (V9 ERC-20) | `0x38EB5dB7cDc3571d767f42a51897298146Acb346` |
| IdentityCard | `0xeb6dF756e604Eda802b046dE3A904C143cB0f322` |
| RitualTraining (V9) | `0xfB08024373208a572B518190B05c5EF4c200B4AD` |
| RitualArena | `0xbb22d8c3EF60bf1E0Dd5500826c6baaEfE112f02` |
| RitualStaking (ms-fix) | `0x5E6c13eDCAbbcdA301F8310Ec3aFe2B3fA15F886` |
| AchievementRegistry | `0x90120eeF2d9A5D03fD310f47f615b8a406943774` |
| IdentityRegistry | `0xe04669f070764934708a91E1C0A24Fe5D06db586` |
| RitualPackNFT (V10, with burn) | `0xc381fCd8f673E673Bd0927b2dd33B6C189570342` |
| PackManager (V10) | `0xAd96175CaA412C3D42BCcF6C59eC2Fc8ee2c8CCb` |
| CardBurner (V10) | `0xf81F27A5eCC14227C8f5b0E0941896cFDe04ff16` |
| RitualMarketplace (V5+listing-fee) | `0x55Bab06C434866a38E6d241b45aF21283A482CDe` |

## Environment Variables

### Frontend (Vite / Vercel)

Set in Vercel project settings (`.env.production` is `.gitignore`d):

| Variable | Required | Purpose |
|---|---|---|
| `VITE_RITUAL_CHAIN_ID` | Yes | `1979` |
| `VITE_RITUAL_RPC_URL` | Yes | Public RPC endpoint |
| `VITE_RITUAL_EXPLORER_URL` | Yes | Block explorer base URL |
| `VITE_RITUAL_RPC_URL_2` | No | Fallback RPC endpoint (used by viem's `fallback()` transport) |
| `VITE_RITUAL_IDENTITY_CARD_ADDRESS` | Yes | IdentityCard address |
| `VITE_RITUAL_IDENTITY_REGISTRY_ADDRESS` | Yes | IdentityRegistry address (canonical leaderboard source) |
| `VITE_RITUAL_TRAINING_ADDRESS` | Yes | Training address |
| `VITE_RITUAL_ARENA_ADDRESS` | Yes | Arena address |
| `VITE_RITUAL_STAKING_ADDRESS` | Yes | Staking address |
| `VITE_RITUAL_MARKETPLACE_ADDRESS` | Yes | Marketplace address |
| `VITE_RITUAL_ACHIEVEMENT_REGISTRY_ADDRESS` | Yes | AchievementRegistry address |
| `VITE_RITUAL_PACK_NFT_ADDRESS` | Yes | RitualPackNFT address |
| `VITE_RITUAL_PACK_MANAGER_ADDRESS` | Yes | PackManager address |
| `VITE_RITUAL_AP_ADDRESS` | Yes | AP ERC-20 address |
| `VITE_IPFS_GATEWAYS` | No | Comma-separated fallback list |
| `VITE_IPFS_UPLOAD_URL` | No | Custom IPFS upload proxy |
| `VITE_ATTESTATION_URL` | No | Custom `/api/attestation` URL |

> **Frontend address source**: `src/lib/chains.ts` is the canonical hardcoded source. Env vars are kept in `.env.example` and Vercel for documentation, but `chains.ts` overrides them at build time. This avoids Vite build cache + env fallback bugs.

### Backend (Vercel serverless)

| Variable | Required | Purpose |
|---|---|---|
| `RITUAL_RPC_URL` (or `VITE_RITUAL_RPC_URL`) | Yes | Server-side RPC |
| `VITE_RITUAL_IDENTITY_CARD_ADDRESS` (server-side: `IDENTITY_CARD_ADDRESS`) | Yes | For `/api/metadata` and `/api/card-image` to read IdentityCard state |
| `ATTESTATION_PRIVATE_KEY` (or `ATTESTATION_SIGNER`) | Yes | EIP-712 signer for forge |
| `PUBLIC_APP_URL` | No | External URL in metadata response (default: `VERCEL_URL`) |
| `ATTESTATION_ALLOWED_ORIGIN` | No | CORS allowlist for `/api/attestation` (empty = all origins) |
| `PINATA_JWT` | For IPFS | Pinata upload token |
| `IPFS_ALLOWED_ORIGIN` | No | CORS allowlist for `/api/ipfs` |

### Local Development

```bash
cp .env.example .env
# fill in testnet values; never commit .env
```

## Deploying Contracts

V9 fresh deployment is a single coordinated script:

```bash
# 1. Compile
npm run compile

# 2. Full V9 fresh deploy (deploys all 10 contracts)
npx hardhat run scripts/deploy/ritual-1979-fresh-full-v9.cjs --network ritualTestnet

# 3. Wire V9 trusted-updater relationships
#    (IdentityRegistry trusts Training/Arena/Ach/PM/IdentityCard;
#     AP grants MINTER_ROLE to Training/Arena/Staking/PM;
#     AP grants BURNER_ROLE to Marketplace;
#     IdentityCard + AchievementRegistry trust their respective updaters)
npx hardhat run scripts/deploy/wire-v9-wiring.cjs --network ritualTestnet
```

Post-deploy redeploys (idempotent — re-run any time):

```bash
# Staking ms-timestamp fix (if you redeploy RitualStaking)
npx hardhat run scripts/deploy/redeploy-staking-ms-fix.cjs

# Marketplace with correct AP immutable (if you redeploy RitualMarketplace)
npx hardhat run scripts/deploy/redeploy-marketplace-v5-correct-ap.cjs
```

## Deploying Frontend

```bash
npm run build
npx vercel --prod --force --token "$VERCEL_TOKEN"
```

Or push to `main` — Vercel auto-deploys.

## Trusted Updaters Setup

IdentityRegistry's `setTrustedUpdater(updater, true)` must be called for each protocol contract. This is done by `wire-v9-wiring.cjs`. Verify on-chain:

```bash
node -e "
const { createPublicClient, http } = require('viem');
const c = createPublicClient({ transport: http(process.env.VITE_RITUAL_RPC_URL) });
const REG = '0xe04669f070764934708a91E1C0A24Fe5D06db586';
const ABI = [{type:'function',name:'trustedUpdaters',inputs:[{type:'address'}],outputs:[{type:'bool'}],stateMutability:'view'}];
const updaters = {
  Training:       '0xfB08024373208a572B518190B05c5EF4c200B4AD',
  Arena:          '0xbb22d8c3EF60bf1E0Dd5500826c6baaEfE112f02',
  AchievementReg: '0x90120eeF2d9A5D03fD310f47f615b8a406943774',
  IdentityCard:   '0xeb6dF756e604Eda802b046dE3A904C143cB0f322',
  PackManager:    '0xAd96175CaA412C3D42BCcF6C59eC2Fc8ee2c8CCb',
};
Promise.all(Object.entries(updaters).map(([name, addr]) =>
  c.readContract({address: REG, abi: ABI, functionName: 'trustedUpdaters', args: [addr]})
    .then(b => [name, addr.slice(0,10) + '...', b])
)).then(r => console.table(r));
"
```

All five should return `true`.

## AP Role Verification

```bash
node -e "
const { createPublicClient, http } = require('viem');
const c = createPublicClient({ transport: http(process.env.VITE_RITUAL_RPC_URL) });
const AP = '0x38EB5dB7cDc3571d767f42a51897298146Acb346';
const MINTER = '0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c895239';
const BURNER = '0x3c11d163cb1fbf46cdc652a5d5873ae0ca6e6f3e84c4cc95fc84b80f5b62c9e3';
const ABI = [{type:'function',name:'hasRole',inputs:[{type:'bytes32'},{type:'address'}],outputs:[{type:'bool'}],stateMutability:'view'}];
const targets = {
  'Training MINTER':       ['0xfB08024373208a572B518190B05c5EF4c200B4AD', MINTER],
  'Arena MINTER':          ['0xbb22d8c3EF60bf1E0Dd5500826c6baaEfE112f02', MINTER],
  'Staking MINTER':        ['0x5E6c13eDCAbbcdA301F8310Ec3aFe2B3fA15F886', MINTER],
  'PackManager MINTER':    ['0xAd96175CaA412C3D42BCcF6C59eC2Fc8ee2c8CCb', MINTER],
  'Marketplace BURNER':    ['0x55Bab06C434866a38E6d241b45aF21283A482CDe', BURNER],
};
Promise.all(Object.entries(targets).map(([name, [addr, role]]) =>
  c.readContract({address: AP, abi: ABI, functionName: 'hasRole', args: [role, addr]})
    .then(b => [name, addr.slice(0,10) + '...', b])
)).then(r => console.table(r));
"
```

All five should return `true`.

## Verification Checklist

After every deployment, verify the system end-to-end:

- [ ] `deployments/ritual-1979-v9-fresh.json` is updated with the new addresses
- [ ] All 5 trusted updaters are `true` on IdentityRegistry
- [ ] AP `MINTER_ROLE` granted to Training, Arena, Staking, PackManager
- [ ] AP `BURNER_ROLE` granted to Marketplace
- [ ] Each contract is wired to the correct IdentityRegistry (`identityRegistry()` getter)
- [ ] Frontend `VITE_*` env vars are updated in Vercel
- [ ] Frontend `src/lib/chains.ts` constants match on-chain addresses
- [ ] Test wallet can forge: `node scripts/qa/transfer-ap-1000.cjs`
- [ ] Test wallet can open a pack
- [ ] Production URL shows leaderboard reading from registry (`Sync Pending` if no entries)

## Source of Truth

`deployments/ritual-1979-v9-fresh.json` is the **canonical source of truth** for all V9 deployed addresses. It includes:

- `contracts.<contract>.address` — current address
- `contracts.<contract>.tx` — deployment tx hash
- `contracts.<contract>.replaces` — previous address (if redeployed)
- `contracts.<contract>.note` — wiring notes
- `wiring` — verified trusted-updater list and AP role grants

## Keeper Operations

Arena matchmaking (`scheduleBatch`) requires a keeper to call it. The deployer EOA is the keeper by default. To trigger matchmaking:

```bash
npx hardhat run scripts/deploy/ritual-arena-create-battle.js
```

To rotate the keeper (from the deployer account):

```bash
cast send <ARENA_ADDRESS> "setKeeper(address)" <NEW_KEEPER> \
  --rpc-url $VITE_RITUAL_RPC_URL \
  --private-key $PRIVATE_KEY
```

If the keeper is unavailable, existing battles still settle and pay out — only new matchmaking pauses. See `docs/history/OPERATIONAL_ARENA_AUDIT.md` for the full operational analysis.
