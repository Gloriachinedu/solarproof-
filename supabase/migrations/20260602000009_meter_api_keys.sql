-- Migration 009: API keys for meter device authentication (#131)
--
-- Each meter is issued a unique random API key on registration.
-- The key is validated by the readings endpoint before Ed25519 signature check.
-- Keys can be rotated (new key generated) without changing the Ed25519 keypair.
-- Revoking a key (setting it NULL) immediately rejects submissions from that meter.
--
-- API keys also carry an expiry (expires_at). Expired keys are rejected with
-- HTTP 401 on every reading submission. Keys should be rotated before expiry;
-- notifications are sent 7 days before expiry.

alter table meters
  add column api_key text unique;

-- Backfill existing meters with generated keys
update meters
  set api_key = 'mk_' || encode(gen_random_bytes(32), 'hex')
  where api_key is null;

-- Enforce NOT NULL going forward
alter table meters
  alter column api_key set not null;

-- Add API key expiry column (nullable initially for backfill)
alter table meters
  add column expires_at timestamptz;

-- Backfill existing keys with a default expiry of 90 days from now
update meters
  set expires_at = now() + interval '90 days'
  where expires_at is null;

-- Enforce NOT NULL going forward
alter table meters
  alter column expires_at set not null;

-- Index for efficient expiry queries (e.g. finding keys expiring soon)
create index idx_meters_expires_at on meters (expires_at);

comment on column meters.api_key is
  'API key issued to the meter device. Validated before Ed25519 signature check. Rotate via PATCH /api/meters/{id}/rotate-key. Set to empty string to revoke. Keys expire per expires_at and expired keys are rejected with HTTP 401.';

comment on column meters.expires_at is
  'Expiry timestamp for the meter API key. Expired keys are rejected with HTTP 401 on every reading submission. Notifications are sent 7 days before expiry.';