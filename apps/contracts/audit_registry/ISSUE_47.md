# Issue #47 — Validate canonical hash format on anchor

## Summary

The `anchor()` function in `audit_registry` should validate that `reading_hash`
is a well-formed SHA-256 digest (exactly 32 bytes) before storing it.

## Planned changes

- Add `Error::InvalidHash = 3` to the `Error` enum.
- Add a `validate_hash_format(hash: Bytes) -> Result<(), Error>` helper that
  returns `Err(Error::InvalidHash)` for any input that is not exactly 32 bytes.
- Unit tests: 31-byte input rejected, 33-byte input rejected, 32-byte input accepted.

## References

Closes #47
