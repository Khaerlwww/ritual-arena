# API Routes

Vercel serverless functions in `api/`. All routes are configured in `vercel.json`.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `VITE_RITUAL_IDENTITY_CARD_ADDRESS` (server-side: `IDENTITY_CARD_ADDRESS`) | Yes | IdentityCard contract address for `/api/metadata` and `/api/card-image` |
| `VITE_RITUAL_RPC_URL` (server-side: `RITUAL_RPC_URL`) | Yes | Public RPC endpoint |
| `VITE_RITUAL_PACK_NFT_ADDRESS` (server-side) | For pack routes | RitualPackNFT contract address |
| `PUBLIC_APP_URL` (server-side) | No | App URL (for metadata `external_url`). Defaults to `VERCEL_URL` or `https://ritual-arenav0.vercel.app` |
| `ATTESTATION_ALLOWED_ORIGIN` | No | Comma-separated CORS allowlist for `/api/attestation`. If empty, all origins are allowed. |
| `ATTESTATION_PRIVATE_KEY` (or `ATTESTATION_SIGNER`) | Yes (for forge) | Private key for EIP-712 forge attestation signing |
| `PINATA_JWT` | For IPFS | Pinata upload token (never expose via `VITE_` prefix) |
| `IPFS_ALLOWED_ORIGIN` | No | CORS allowlist for `/api/ipfs` |

## Routes

### `GET /api/metadata/:tokenId`

Returns ERC-721 metadata JSON for an IdentityCard token.

**Path params**: `tokenId` — integer NFT token ID

**Response 200**:
```json
{
  "name": "Ritual Arena #1",
  "description": "@sharxlr's Ritual Arena Identity Card. Power 8 | Grade: INITIATE. ...",
  "image": "https://ritual-arenav0.vercel.app/api/card-image/1",
  "external_url": "https://ritual-arenav0.vercel.app",
  "attributes": [
    { "trait_type": "Power", "value": 8 },
    { "trait_type": "Grade", "value": "INITIATE" },
    { "trait_type": "Rarity Rank", "value": 0 },
    { "trait_type": "Initial Power", "value": 1 },
    { "trait_type": "Initial Grade", "value": "INITIATE" },
    { "trait_type": "Snapshot Version", "value": 1 },
    { "trait_type": "Last Evolved", "value": "5m ago" },
    { "trait_type": "Genesis", "value": false }
  ]
}
```

**Errors**:
- `400 Invalid tokenId` — tokenId is not a positive integer ≤ 1,000,000
- `404 Token does not exist` — token not minted
- `503 Metadata service not configured` — env vars missing

**Caching**: `public, max-age=30, s-maxage=60`

### `GET /api/card-image/:tokenId`

Returns an SVG image for a token.

**Path params**: `tokenId` — integer NFT token ID

**Response 200**: SVG XML

**Errors**: same as `/api/metadata/`

**Caching**: `public, max-age=30, s-maxage=300`

### `POST /api/attestation`

Signs an EIP-712 forge attestation. The signer key is held server-side and never exposed to the frontend.

**Request body**:
```json
{
  "type": "forge",
  "wallet": "0x...",
  "xHandle": "sharxlr",
  "chainId": 1979,
  "contractAddress": "0xe189382845FF8C938E85ce7E25eB5c89F339ff5E",
  "expiry": 1781320844000,
  "nonce": 99999
}
```

**Response 200**:
```json
{
  "signature": "0x...",
  "expiry": "1781320844000",
  "nonce": "99999"
}
```

**Errors**:
- `400` — missing/invalid params
- `403 Origin not allowed` — if `ATTESTATION_ALLOWED_ORIGIN` is set and origin not in list

> **Critical**: The `expiry` and `nonce` values must be in the same unit as `block.timestamp` on the target chain. For Ritual Chain (which returns timestamps in milliseconds), `expiry` must be in ms. The signature is computed over whatever values are provided.

### `POST /api/ipfs`

IPFS upload proxy. Forwards to Pinata if `PINATA_JWT` is configured.

### `GET /api/pack/...`

Pack-related metadata helpers. See `api/pack/` for individual routes.

### `GET /api/proxy-avatar`

CORS proxy for Discord avatars (used by collection card display when Discord CDN blocks the request).

## Vercel Configuration

`vercel.json`:
```json
{
  "rewrites": [
    { "source": "/api/metadata/:tokenId", "destination": "/api/metadata?tokenId=:tokenId" },
    { "source": "/api/card-image/:tokenId", "destination": "/api/card-image?tokenId=:tokenId" },
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "functions": {
    "api/**/*.js": { "maxDuration": 15 }
  }
}
```

- Path-style URLs (`/api/metadata/1`) are rewritten to query-string format (`/api/metadata?tokenId=1`)
- Non-API URLs fall through to `index.html` (SPA routing)
- All API functions have a 15-second timeout

## CORS

All API routes include permissive CORS headers for browser access. In production, set `ATTESTATION_ALLOWED_ORIGIN` (and `IPFS_ALLOWED_ORIGIN` for `/api/ipfs`) to restrict those endpoints to your app's origin.
