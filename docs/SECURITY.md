# Security

## Supported Versions

| Branch | Supported |
|---|---|
| `main` | ✅ Yes — production deployments |
| Older | ❌ No — please upgrade |

Only `main` receives security fixes. Branches not listed above are not supported.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **security@ritualarena.xyz** (or open a [GitHub Security Advisory](https://github.com/Khaerlwww/ritual-arena-experimental/security/advisories/new) on the repository).

Please include:
- A clear description of the vulnerability
- Steps to reproduce
- Impact assessment (what an attacker could do)
- Suggested fix (optional)
- Your contact info (so we can follow up)

We aim to acknowledge within **48 hours** and provide a remediation plan within **7 days** of confirmation.

### Disclosure timeline

1. **Day 0**: vulnerability reported
2. **Day 2**: maintainer acknowledges, begins triage
3. **Day 7**: severity assessed, fix planned
4. **Day 30 (target)**: fix deployed to testnet; coordinated mainnet fix if applicable
5. **Day 45**: public disclosure (if not already public)

We follow coordinated disclosure. Please do not publicly disclose the vulnerability before the agreed date.

## Severity scale

| Severity | Description | Response |
|---|---|---|
| Critical | Loss of user funds, full contract takeover | Immediate hotfix |
| High | Privilege escalation, fund loss under specific conditions | Hotfix within 7 days |
| Medium | Griefing, denial of service, info disclosure | Next release |
| Low | Best-practice violation, gas optimization | Backlog |

## Out of scope (testnet only)

The currently-deployed contracts are on **Ritual Chain testnet** (chainId 1979). No production mainnet exists at this time. Funds and assets on the testnet are not real and have no monetary value. Testnet security issues are still reported and fixed, but are not eligible for bug bounty payouts.

## Security design notes

For the curious, key design choices that limit blast radius:

- **`simulateContract` before every write** — the frontend never broadcasts a tx that would revert. This catches most user errors at the simulation stage.
- **One connect per session** — the shared wallet controller (`src/lib/wallet.ts`) issues exactly one `requestAddresses` and one `switchChain` call per session, eliminating the wallet-spam attack vector.
- **EIP-712 forge attestation** — the `/api/attestation` endpoint holds the EIP-712 signer key server-side. The frontend never holds the key. CORS can be restricted to a single origin via `ATTESTATION_ALLOWED_ORIGIN`.
- **Pull-based push, not push-based update** — the leaderboard reads from `IdentityRegistry` (a single source of truth). There is no client-side ranking logic. A user's position is computed from onchain data on every page load.
- **ms-aware timestamps** — all onchain time math uses the `_dur() / _cd() / _ci() / _ro()` helpers which auto-detect whether `block.timestamp` is in seconds or milliseconds.
- **OpenZeppelin audited primitives** — all ERC721, Ownable, Pausable, and signature-recovery code uses OpenZeppelin v5 contracts.
- **No upgradeable proxies** — contracts are not upgradeable. Fixes require redeployment.
