-- Migration: ERC-1888 bridge support for certificates
-- Adds columns to track Energy Web Chain ERC-1888 EAC token issuance
-- for each SolarProof certificate.

ALTER TABLE public.certificates
    ADD COLUMN IF NOT EXISTS erc1888_token_id text,
    ADD COLUMN IF NOT EXISTS erc1888_issuance_status text DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS erc1888_tx_hash text,
    ADD COLUMN IF NOT EXISTS erc1888_issued_at timestamptz;

-- Constrain issuance status to the expected lifecycle values.
ALTER TABLE public.certificates
    ADD CONSTRAINT certificates_erc1888_issuance_status_check
    CHECK (
        erc1888_issuance_status IS NULL
        OR erc1888_issuance_status IN ('pending', 'issued', 'failed')
    );

-- Index used by the bridge worker to find certificates awaiting issuance.
CREATE INDEX IF NOT EXISTS idx_certificates_erc1888_issuance_status
    ON public.certificates (erc1888_issuance_status);

COMMENT ON COLUMN public.certificates.erc1888_token_id IS
    'ERC-1888 EAC token ID issued on Energy Web Chain for this certificate';
COMMENT ON COLUMN public.certificates.erc1888_issuance_status IS
    'ERC-1888 issuance lifecycle status: pending | issued | failed';
COMMENT ON COLUMN public.certificates.erc1888_tx_hash IS
    'Transaction hash of the ERC-1888 issuance on Energy Web Chain';
COMMENT ON COLUMN public.certificates.erc1888_issued_at IS
    'Timestamp when the ERC-1888 token was successfully issued';
```

File: supabase/migrations/rollbacks/20260701000000_erc1888_bridge.sql

```sql
-- Rollback: ERC-1888 bridge support for certificates
-- Reverts the changes made in 20260701000000_erc1888_bridge.sql

DROP INDEX IF EXISTS public.idx_certificates_erc1888_issuance_status;

ALTER TABLE public.certificates
    DROP CONSTRAINT IF EXISTS certificates_erc1888_issuance_status_check;

ALTER TABLE public.certificates
    DROP COLUMN IF EXISTS erc1888_issued_at,
    DROP COLUMN IF EXISTS erc1888_tx_hash,
    DROP COLUMN IF EXISTS erc1888_issuance_status,
    DROP COLUMN IF EXISTS erc1888_token_id;