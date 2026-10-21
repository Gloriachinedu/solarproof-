# Security Policy

SolarProof takes the security of our renewable energy infrastructure seriously. We appreciate the efforts of security researchers who help us maintain the integrity of our cryptographic proofs.

## Supported Versions

We provide security updates for the following versions:

| Version | Supported |
|---|---|
| `main` branch | ✅ |
| Older releases | ❌ |

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

If you discover a potential security issue, please report it to us via email:

**[security@solarproof.dev](mailto:security@solarproof.dev)**

To help us address the issue quickly, please include:

- A detailed description of the vulnerability and its potential impact.
- Step-by-step instructions to reproduce the issue (or a proof-of-concept).
- The affected component(s) (API, smart contracts, frontend, scripts).
- Any suggested remediations or mitigations.

### Response Timeline

- **Acknowledgment:** Within 48 hours of receipt.
- **Initial Evaluation:** Within 7 days of acknowledgment.
- **Resolution:** We aim to resolve critical issues within 14-21 days.

---

## Disclosure Process

We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure) and ask that you do the same.

1. **Report:** You report the vulnerability privately to our security email.
2. **Evaluation:** We verify the issue and assess the risk.
3. **Fix:** We develop and test a security patch.
4. **Coordination:** We coordinate a release date with you.
5. **Disclosure:** We publish a security advisory and credit you for the discovery.

---

## Scope

### In Scope

- **Meter Proofs:** Ed25519 signature verification bypasses.
- **Certificate Lifecycle:** Unauthorized retirement or minting of tokens.
- **Chain of Custody:** Data manipulation in the `/api/verify` or anchor registry.
- **Smart Contracts:** Vulnerabilities in `energy_token`, `audit_registry`, or `community_governance`.
- **Infrastructure:** Supabase RLS policy bypasses or authentication flaws.

### Out of Scope

- Vulnerabilities in the Stellar network itself (please report to the [Stellar Foundation](https://stellar.org/security)).
- Attacks requiring physical access to a meter device (unless the attack scales to other devices).
- Social engineering, phishing, or denial-of-service (DoS) attacks.
- Third-party library vulnerabilities (unless they result from our specific usage).

---

## Bug Bounty

SolarProof does not currently operate a paid bug bounty program. However, we are happy to:

- Publicly credit researchers in our security advisories.
- Provide a letter of appreciation for significant findings.
- Offer early access to upcoming features.

---

## Security Headers

All production responses include the following OWASP-recommended security headers. They are enforced centrally via `next.config.ts` and verified by automated ZAP scans.

| Header | Configured Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | Restrictive policy limiting script, style, and connect sources to trusted origins |

These headers are configured in `next.config.ts` and are verified by ZAP scans. Certain header findings are ignored as false positives in `.zap/rules.tsv` because the headers are injected at the edge. The ZAP scan workflow (`.github/workflows/zap-scan.yml`) runs weekly to ensure these headers remain present.

---

## Encrypted Communication (PGP)

For sensitive reports, you may use our PGP key to encrypt your email.

**Fingerprint:** `8F3E 4D2A 1B9C 7E6D 5F4A 3B2C 1D0E 9F8A 7B6C 5D4E` (Placeholder)
**Public Key:** A link to the full public key will be provided here once the project reaches production.

In the meantime, standard email to `security@solarproof.dev` is the preferred channel.
