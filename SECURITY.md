# Security Policy

## Reporting

Do not open a public issue for private keys, seed phrases, API tokens, deployer wallets, signer keys, or exploitable contract issues.

Report sensitive findings privately to the repository owner with:

- affected contract / endpoint / file
- reproduction steps
- wallet / tx hash if relevant
- impact assessment

## Secret hygiene

This public repository must never commit real values for:

- `.env*` files except `.env.example` templates
- private keys / seed phrases / mnemonics
- Vercel, GitHub, RPC, IPFS, or attestation signer tokens
- seed wallet JSON files
- local/private operations scripts

Before pushing public-facing changes, run a secret scan for:

```bash
git diff --cached | grep -iE "PRIVATE_KEY|MNEMONIC|SEED_PHRASE|VERCEL_TOKEN|GITHUB_TOKEN|BEGIN .*PRIVATE KEY|0x[0-9a-fA-F]{64}"
```

A 66-character `0x...` value can be either a public tx hash or a private key. Treat it as sensitive until verified.

## On-chain operations

Contract deploys, role changes, admin writes, production deploys, and repo visibility changes require explicit approval before execution.
