# Security Policy

## Supported Scope

This public repository contains the Ritual Arena frontend, API handlers, contract source, ABIs, and public configuration templates.

Operational secrets, deployer wallets, Vercel tokens, seed wallets, private environment files, and production operator scripts are intentionally excluded from the public repository.

## Reporting a Vulnerability

Please do not open a public GitHub issue for security-sensitive reports.

Report privately to the repository owner with:

- affected contract / API / frontend surface
- reproduction steps
- expected impact
- related transaction hash or address, if applicable

## Secret Handling

Never commit real values for:

- private keys
- seed phrases / mnemonics
- Vercel tokens
- GitHub tokens
- RPC provider credentials
- seed-wallet JSON files

Use `.env.example` and `.env.production.example` as templates only. Real `.env*` files must stay local or in the deployment provider's secret store.

## Public On-chain Data

Contract addresses, transaction hashes, role identifiers, and zero-value placeholders are public data and may appear in this repository.
