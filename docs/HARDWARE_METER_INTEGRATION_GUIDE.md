# Hardware Meter Integration Guide

This guide is for hardware manufacturers who want to integrate their smart meters with SolarProof. It covers hardware requirements, the signing protocol, API integration steps, and the certification process for new meter models.

---

## Quick Start (5 Steps)

New to SolarProof hardware integration? Follow these five steps to get your first signed reading submitted. Each step links to the detailed section below.

1. **Generate a keypair** — run `node scripts/gen-meter-key.mjs` to produce `meter-key.json` (an Ed25519 keypair for testing). See [Step 1 — Generate and Register the Meter Keypair](#step-1--generate-and-register-the-meter-keypair).

2. **Register the public key** — insert the `public_key_hex` from `meter-key.json` into the `meters` table with your cooperative ID. See [Step 1 — Generate and Register the Meter Keypair](#step-1--generate-and-register-the-meter-keypair).

3. **Compute the canonical reading hash** — `SHA-256(meter_id_utf8 || kwh_stroops_le64 || timestamp_le64)`. See [Step 2 — Compute the Canonical Reading Hash](#step-2--compute-the-canonical-reading-hash).

4. **Sign the hash with Ed25519** — produce a 64-byte signature (128-char hex) using your meter's private key. See [Step 3 — Sign the Reading](#step-3--sign-the-reading).

5. **Submit the reading** — `POST /api/readings` with `{ meter_id, kwh, timestamp, signature_hex }`, or use `node scripts/send-reading.mjs --meter-id <uuid> --kwh 12.5 --key ./meter-key.json --api http://localhost:3000` to validate end-to-end. See [Step 4 — Submit the Reading](#step-4--submit-the-reading) and [Step 5 — End-to-End Test](#step-5--end-to-end-test-with-reference-scripts).

> **Reference scripts:** `scripts/gen-meter-key.mjs` generates a keypair; `scripts/send-reading.mjs` signs and submits a reading; `scripts/e2e-meter-reading-flow.mjs` runs the full flow. All require Node.js v22+ and are for development/testing only.

---

## Hardware Requirements

### Ed25519 Key Storage

Every SolarProof-compatible meter must generate and store an Ed25519 keypair. The private key must never leave the device.

| Requirement | Minimum | Recommended |
|---|---|---|
| Key storage | Secure flash with access control | Hardware Security Module (HSM) or TPM 2.0 |
| Key generation | On-device CSPRNG | On-device CSPRNG with hardware entropy source |
| Key protection | Software access control | HSM / secure enclave (YubiKey, ATECC608, TPM) |
| Curve | Ed25519 | Ed25519 |
| Key size | 32-byte private key, 32-byte public key | Same |

**Minimum viable hardware:**
- Microcontroller with at least 64 KB flash and 16 KB RAM
- Hardware RNG or entropy source
- Persistent storage that survives power cycles
- Network interface (Ethernet, Wi-Fi, or cellular) capable of HTTPS

**Recommended hardware:**
- Dedicated HSM chip (e.g., Microchip ATECC608B, Infineon SLB 9670 TPM)
- Secure boot to prevent firmware tampering
- Tamper-evident enclosure

### Connectivity

- HTTPS (TLS 1.2+) to reach the SolarProof API
- Accurate real-time clock (RTC) — timestamp drift must be within ±30 seconds
- Minimum 1 kB/s uplink for reading submissions

---

## API Integration Steps

### Step 1 — Generate and Register the Meter Keypair

Generate an Ed25519 keypair at manufacture time or on first boot. Store the private key in secure storage. Register the public key with the SolarProof operator before the meter goes live.

**Reference script (development/testing only — do not use in production firmware):**

```bash
node scripts/gen-meter-key.mjs
# Outputs meter-key.json: { private_key_hex, public_key_hex }
```

Register the public key in the SolarProof database:

```sql
INSERT INTO meters (id, pubkey_hex, cooperative_id, active)
VALUES ('<uuid>', '<64-char hex public key>', '<cooperative-uuid>', true);
```

The operator will provide the `cooperative_id` and confirm the `meter_id` (UUID) assigned to your device.

### Step 2 — Compute the Canonical Reading Hash

Before signing, compute a deterministic SHA-256 hash of the reading:

```
SHA-256( meter_id_utf8 || kwh_stroops_le64 || timestamp_le64 )
```

- `meter_id_utf8` — the meter UUID as a UTF-8 byte string (e.g. `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`)
- `kwh_stroops_le64` — `round(kwh × 10_000_000)` as a little-endian 64-bit signed integer
- `timestamp_le64` — Unix epoch seconds (UTC) as a little-endian 64-bit signed integer

**Node.js reference:**

```js
import { createHash } from 'crypto'

function computeReadingHash(meterId, kwh, timestamp) {
  const kwhStroops = BigInt(Math.round(kwh * 1e7))
  const meterBytes = Buffer.from(meterId, 'utf8')
  const kwhBuf = Buffer.alloc(8)
  kwhBuf.writeBigInt64LE(kwhStroops)
  const tsBuf = Buffer.alloc(8)
  tsBuf.writeBigInt64LE(BigInt(timestamp))
  return createHash('sha256').update(meterBytes).update(kwhBuf).update(tsBuf).digest()
}
```

The server uses the identical algorithm in `apps/web/src/lib/crypto.ts`. Any deviation will cause signature verification to fail.

### Step 3 — Sign the Reading

Sign the 32-byte hash with the device's Ed25519 private key. The signature must be 64 bytes, encoded as a 128-character lowercase hex string.

**Node.js reference:**

```js
import { createSign } from 'crypto'

function signReading(readingHash, privateKeyHex) {
  const privKeyDer = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(privateKeyHex, 'hex'),
  ])
  const sign = createSign('ed25519')
  sign.update(readingHash)
  return sign.sign({ key: privKeyDer, format: 'der', type: 'pkcs8' }).toString('hex')
}
```

For HSM-backed devices, use the HSM's signing API to produce the Ed25519 signature over the hash bytes — the output format is the same.

### Step 4 — Submit the Reading

```
POST /api/readings
Content-Type: application/json
```

**Request body:**

```json
{
  "meter_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "kwh": 12.5,
  "timestamp": 1745500800,
  "signature_hex": "<128-char lowercase hex>"
}
```

**Success — `201 Created`:**

```json
{
  "reading_id": "<uuid>",
  "anchor_tx_hash": "<64-char hex>",
  "mint_tx_hash": "<64-char hex>"
}
```

**Error codes:**

| Status | Meaning |
|---|---|
| `400` | Malformed payload or validation failure |
| `401` | Invalid Ed25519 signature |
| `404` | Meter not found or inactive |
| `409` | Duplicate reading (already anchored) |
| `500` | Stellar transaction failure |

### Step 5 — End-to-End Test with Reference Scripts

Use the reference scripts in `scripts/` to validate your integration before certification:

```bash
# Generate a test keypair
node scripts/gen-meter-key.mjs

# Send a signed reading to a local or staging instance
node scripts/send-reading.mjs \
  --meter-id <your-meter-uuid> \
  --kwh 12.5 \
  --key ./meter-key.json \
  --api http://localhost:3000

# Run the full end-to-end flow
node scripts/e2e-meter-reading-flow.mjs
```

See `docs/METER_INTEGRATION.md` for the full protocol reference including the complete API specification.

---

## Reference Scripts

| Script | Purpose |
|---|---|
| `scripts/gen-meter-key.mjs` | Generate an Ed25519 keypair for a meter device |
| `scripts/send-reading.mjs` | Sign and submit a single meter reading |
| `scripts/e2e-meter-reading-flow.mjs` | Full end-to-end flow: key generation → reading → anchor → mint → verify |

All scripts require Node.js v22+ and are intended for development, testing, and certification validation. Do not use them in production firmware.

---

## Certification Checklist for New Meter Models

Before a meter model is approved for production use with SolarProof, the manufacturer must complete the following checklist. Submit the completed checklist to the integration support contact below.

### Hardware

- [ ] Ed25519 keypair generated on-device using a hardware entropy source
- [ ] Private key stored in HSM, TPM, or secure enclave (not in plain flash)
- [ ] Secure boot enabled to prevent firmware tampering
- [ ] RTC accuracy verified to be within ±30 seconds of UTC
- [ ] Device passes tamper-detection requirements (physical or logical)

### Protocol Compliance

- [ ] Canonical reading hash matches the reference implementation for at least 100 test vectors
- [ ] Ed25519 signatures verified by the SolarProof server for at least 100 test readings
- [ ] Duplicate reading rejection confirmed (server returns `409` for repeated submissions)
- [ ] Replay attack prevention confirmed (server rejects stale timestamps)
- [ ] Error handling tested for all documented error codes (`400`, `401`, `404`, `409`, `500`)

### Integration Testing

- [ ] End-to-end test completed against the SolarProof staging environment
- [ ] `scripts/e2e-meter-reading-flow.mjs` passes against staging with the device's public key registered
- [ ] Reading submission latency measured and within acceptable bounds (<5 s under normal conditions)
- [ ] Behavior under network failure documented (retry logic, no duplicate submissions)

### Security Review

- [ ] Private key never transmitted or logged
- [ ] Firmware update mechanism does not expose key material
- [ ] Security contact and vulnerability disclosure process documented for the device

### Documentation

- [ ] Firmware version and hardware revision documented
- [ ] Key provisioning process documented
- [ ] Operator setup instructions provided

---

## Contact Information for Integration Support

For integration questions, certification submissions, or to report a protocol issue:

- **GitHub Issues:** [github.com/katecatherinaa/solarproof/issues](https://github.com/katecatherinaa/solarproof/issues) — use the label `hardware-integration`
- **Security issues:** See [SECURITY.md](../SECURITY.md) for the responsible disclosure process
- **Protocol questions:** Open a discussion in the repository or reference `docs/METER_INTEGRATION.md` and `docs/adr/001-ed25519-signing.md`

When submitting a certification request, include:
1. Completed certification checklist (above)
2. Hardware model name and firmware version
3. Test vector results (hash and signature outputs for the provided test inputs)
4. Contact name and organisation
