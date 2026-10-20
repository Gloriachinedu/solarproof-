# Contract Snapshot Tests

The `energy_token`, `audit_registry`, and `community_governance` test suites
record Soroban ledger and authorization snapshots under each contract's
`test_snapshots/` directory. Contract CI runs all tests and fails if a test
changes, deletes, or adds a snapshot without a corresponding reviewed change.

## Updating snapshots

1. Run `cargo test --all` from `apps/contracts` to identify snapshot changes.
2. Review each changed snapshot alongside the Rust test and intended contract
   behavior. Do not accept snapshot changes solely to make CI pass.
3. Include intentional updates in the same change as the behavior they reflect.
4. Re-run `cargo test --all` and `bash scripts/check-contract-snapshots.sh` from
   the repository root. The check must pass with the reviewed snapshots committed.

New public entry points must have focused tests that exercise their behavior;
the resulting snapshots should be committed with those tests.