# Data Classification and Retention Policy

> Applies to all data stored in SolarProof's Supabase instance.

---

## 1. Classification Categories

| Level | Definition |
|---|---|
| **Public** | No sensitivity; safe for anyone to read. On-chain transaction hashes, kWh totals on certificates. |
| **Internal** | Operational data; visible to cooperative members. Meter serial numbers, cooperative names, reading timestamps. |
| **PII** | Personally identifiable information about a natural person (cooperative member). Access restricted to the data subject and cooperative admins; subject to GDPR rights including erasure (Art. 17). Member email, display name, role. |
| **Confidential** | Sensitive operational data; access restricted to the owning cooperative via RLS. Ed25519 public keys, admin addresses. |
| **Restricted** | Cryptographic proof material; integrity must be preserved and access tightly controlled. Ed25519 signatures, reading hashes. |

---

## 2. Table and Field Classification

### `cooperatives`
| Field | Classification | Notes |
|---|---|---|
| `id` | Internal | UUID primary key |
| `name` | Internal | Cooperative display name |
| `admin_address` | Confidential | Stellar public key; not a secret but PII-adjacent — identifies an individual or organisation |
| `created_at` | Internal | |

### Cooperative member data (PII)

Cooperative member identity is **not** stored in a dedicated application table. It is composed from Supabase Auth (`auth.users`) joined with the cooperative association carried in the user's JWT claims (`cooperative_id`, `app_metadata.role`). The logical entity below documents the fields that constitute member PII so they can be classified, retained, and deleted consistently.

| Field | Source | Classification | Notes |
|---|---|---|---|
| `user_id` (`sub`) | `auth.users.id` | PII | Stable identifier of a natural person; links a Supabase account to a cooperative |
| `email` | `auth.users.email` | PII | Direct identifier; used for authentication and notifications |
| `display_name` | `auth.users.raw_user_meta_data` | PII | Optional human-readable name provided by the member |
| `role` | JWT `app_metadata.role` | PII | Membership status (`admin` / `member`); reveals the member's standing in the cooperative |
| `cooperative_id` | JWT claim | PII | Associates a natural person with a specific cooperative |
| `created_at` | `auth.users.created_at` | PII | Account creation timestamp; indirectly identifies the member |
| `last_sign_in_at` | `auth.users.last_sign_in_at` | PII | Activity indicator; indirectly identifies the member |

**PII handling controls:**
- **Access** — only the data subject and cooperative admins may read member PII. RLS is enforced on the cooperative tables via `auth.cooperative_id()` (see `supabase/migrations/20260531000003_rls_policies.sql`). Supabase Auth (`auth.users`) is only readable through the service-role key in server-side API routes; the anon/authenticated keys cannot select from `auth.users`.
- **Minimisation** — the API never returns another member's `email` or `display_name`. Governance vote tallies are aggregated and anonymous; `voter_id` on the `votes` table is restricted to the voter themselves and admins.
- **No export** — member PII is never logged in plaintext or exported to analytics. Log redaction rules in `docs/SECURE_LOGGING.md` apply.
- **On-chain separation** — Stellar addresses (`admin_address`) are published on-chain and are **not** considered PII on their own, but the mapping from an on-chain address back to a natural person (via the cooperative membership) is PII and must not be exposed.

### `meters`
| Field | Classification | Notes |
|---|---|---|
| `id` | Internal | UUID primary key |
| `cooperative_id` | Internal | Foreign key |
| `serial_number` | Confidential | Physical device identifier |
| `pubkey_hex` | Confidential | Ed25519 public key (32 bytes hex); cryptographic material — exposure enables signature-verification spoofing attempts |
| `active` | Internal | |
| `created_at` | Internal | |

### `readings`
| Field | Classification | Notes |
|---|---|---|
| `id` | Internal | |
| `meter_id` | Internal | |
| `kwh` | Internal | Generation measurement |
| `timestamp` | Internal | |
| `reading_hash` | Restricted | SHA-256 of the reading; integrity anchor — must not be altered |
| `signature_hex` | Restricted | Ed25519 signature (64 bytes hex); cryptographic proof material |
| `anchor_tx_hash` | Public | Stellar transaction hash; publicly visible on-chain |
| `mint_tx_hash` | Public | Stellar transaction hash; publicly visible on-chain |
| `anchored` | Internal | |
| `minted` | Internal | |

### `certificates`
| Field | Classification | Notes |
|---|---|---|
| `id` | Internal | |
| `cooperative_id` | Internal | |
| `reading_id` | Internal | |
| `reading_hash` | Restricted | Mirrors reading integrity anchor |
| `anchor_tx_hash` | Public | |
| `mint_tx_hash` | Public | |
| `kwh` | Public | Certificate energy amount |
| `issued_at` | Internal | |
| `retired` | Public | Retirement status |
| `retired_at` | Internal | |
| `retired_by` | Confidential | Stellar address of retiring party |

---

## 3. Retention Schedules

| Table | Retention Period | Basis |
|---|---|---|
| `readings` | **7 years** from reading timestamp | Regulatory (energy metering compliance) |
| `certificates` | **10 years** from `issued_at` | Compliance (I-REC / certificate audit trail) |
| `meters` | **Lifetime of device** (until decommissioned + 2 years) | Operational; needed to verify historical signatures |
| `cooperatives` | **Lifetime of cooperative** + 2 years | Operational |
| Cooperative member PII | **90 days after member departure** | GDPR Art. 17 (right to erasure); see §5.3 |

Archival (not deletion) is the default action at retention boundary — see §5.

---

## 4. Sensitive Data Controls

- **`pubkey_hex` and `signature_hex`** — cryptographic material. Treated as Confidential/Restricted. Never logged in plaintext. Supabase RLS prevents cross-cooperative reads.
- **`admin_address`** — Stellar public key. Not a cryptographic secret, but links an on-chain identity to an organisation. Treated as Confidential.
- **RLS** — all four tables have Row Level Security enabled (see `supabase/migrations/20240101000003_rls.sql`). Service-role key access is restricted to server-side API routes only.
- **Encryption at rest** — provided by Supabase (AES-256). No additional column-level encryption is currently applied; consider it for `signature_hex` in a future migration if threat model requires it.

---

## 5. Deletion and Archival Procedures

### Archival (preferred)
1. Set `readings.archived = true` and `readings.archived_at = now()` for rows past the 7-year boundary.
2. Export archived rows to cold storage (e.g., S3 Glacier) before purging.
3. Certificates past the 10-year boundary follow the same pattern (add `archived` columns in a future migration when needed).

### Hard deletion
Hard deletion is only permitted:
- On explicit cooperative decommission request, after export confirmation.
- For test/staging data with no regulatory significance.

All deletions must be logged in an external audit log (outside Supabase) with timestamp, actor, and row count.

### Scheduled review
Retention compliance should be reviewed annually. A cron job or Supabase Edge Function should flag rows approaching their retention boundary 90 days in advance.

---

## 6. Cooperative Member PII — Deletion Procedure (GDPR Article 17)

### 6.1 What "departure" means

A member is considered to have departed when **any** of the following occurs:
- The member explicitly requests account deletion (GDPR Art. 17 right to erasure).
- A cooperative admin removes the member from the cooperative.
- The member's Supabase Auth account is deactivated/soft-deleted.

Departure time is the timestamp of the triggering event. The 90-day retention clock starts from this point.

### 6.2 Why 90 days (and not immediate)

A short retention window after departure balances the member's erasure right with operational integrity:
- **Dispute resolution** — 90 days allows resolution of vote-tally or membership disputes.
- **Audit trail continuity** — governance records (aggregated, anonymous) remain intact while the member's identity is removed.
- **Legal hold exception** — if a legal hold is in place, deletion is suspended until the hold is lifted. The hold and its reason must be recorded in the external audit log.

After the 90-day window, **all** member PII is erased — no indefinite retention of email, display name, or role.

### 6.3 Deletion steps

Deletion is performed by a service-role server function (never exposed to the anon/authenticated client). Each step is recorded in the external audit log with timestamp, actor, and affected record identifiers.

1. **Anonymise governance contributions.** Update the member's `votes` rows to replace `voter_id` with a tombstone UUID (e.g. `00000000-0000-0000-0000-000000000000`) and null out any identifying metadata. Tally aggregates are preserved so historical proposal outcomes remain verifiable.
2. **Remove cooperative association.** Clear the `cooperative_id` and `role` claims from the user's `app_metadata` (Supabase Auth admin API `auth.admin.updateUserById`).
3. **Soft-delete the auth account.** Call `auth.admin.removeUser(userId)`. This deletes the `auth.users` row, revoking all refresh tokens and blocking future sign-in. Email and `raw_user_meta_data` (display name) are removed at this step.
4. **Verify no residual PII.** Query for any remaining references to the `user_id` across application tables. Any straggler rows are purged.
5. **Log the deletion.** Record the erasure (user_id hash, departure time, completion time, actor) in the external audit log. Do **not** log the raw email or display name.

> **Re-identification is out of scope.** On-chain Stellar addresses remain public and immutable. The deletion procedure removes the off-chain mapping from an address to a natural person, which is the PII component. Once `cooperative_id`/`role` claims and the `auth.users` row are gone, an on-chain address can no longer be tied to a departed member through SolarProof's systems.

### 6.4 Review against GDPR Article 17

| Art. 17 provision | How this policy satisfies it |
|---|---|
| (1) Erasure when data no longer necessary for the purpose collected | Member PII is erased 90 days after departure; it is only kept while the member is active or briefly thereafter for dispute resolution. |
| (1)(b) Withdrawal of consent | Member-initiated account deletion triggers departure immediately; the 90-day clock starts and hard deletion follows. |
| (1)(c) Legal obligation to retain | Regulatory retention applies only to `readings`/`certificates` (energy data) — not to member PII. Member PII has no regulatory retention requirement, so it is erased on the schedule above. |
| (2) Notification of controllers processing the data | SolarProof is the sole controller of member PII; no third-party processors hold member PII. Notification is therefore internal-only. |
| (3) Exceptions (freedom of expression, legal compliance) | A documented legal hold suspends deletion. Anonymous governance tallies are retained as aggregated, non-identifying data (Art. 17(3)(e) — public-interest archiving). |
