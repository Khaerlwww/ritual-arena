# Deployment

This public repository is a showcase/runtime mirror. Private deployment keys, seed wallets, operational scripts, and local env files are intentionally excluded.

## Live Network

| Item | Value |
|---|---|
| Chain | Ritual Chain testnet |
| Chain ID | `1979` |
| RPC | `https://rpc.ritualfoundation.org` |
| Explorer | `https://explorer.ritualfoundation.org` |

## Canonical Contract Addresses

The frontend reads canonical V11 addresses from:

```txt
src/lib/chains.ts
```

Do not rely on stale Vercel env vars as the source of truth. Env vars are optional overrides/documentation only.

Active addresses are listed in [`CONTRACTS.md`](CONTRACTS.md).

## Public Build

```bash
npm install
npm run lint -- --pretty false
npm run build
```

## Required Environment Templates

Use `.env.example` or `.env.production.example` as templates. Real values must stay local or in the hosting provider secret manager.

Never commit:

```txt
.env
.env.*
.env.admin.local
.env.deployer
.vercel-cli-token
*_seed*.json
```

## Deployment Flow

1. Deploy/update contracts from the private ops environment.
2. Verify on-chain addresses and wiring.
3. Update `src/lib/chains.ts` in the runtime repo.
4. Run lint/build.
5. Push public-safe source only.
6. Deploy frontend through Vercel/GitHub integration.

## Public Mirror Rules

This repo should contain:

- frontend source
- active contract source
- public-safe API routes
- public docs
- deployment metadata that contains only public addresses/tx hashes

This repo should not contain:

- private keys
- seed wallet JSON
- Vercel/GitHub/API tokens
- local admin scripts with operational secrets
- historical/debug contract clutter
