# Security Policy

Ritual Arena is a testnet showcase and public code mirror. Please do not open public issues that include private keys, seed phrases, API keys, deployer credentials, or exploit details with live abuse potential.

## Reporting

If you find a vulnerability, report it privately to the repository owner through GitHub contact channels. Include:

- affected contract, API route, or frontend surface
- reproduction steps
- expected impact
- suggested mitigation if available

## Secrets

This repository must not contain real operational secrets. Use local-only env files for private deployments and keep them out of git:

```txt
.env
.env.*
.env.admin.local
.env.deployer
.vercel-cli-token
*_seed*.json
```

Public examples may use placeholders only.
