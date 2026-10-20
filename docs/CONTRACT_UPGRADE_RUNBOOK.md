# Contract Upgrade Runbook

## Readiness status

**Not ready for production upgrades.** This runbook records the required
operational checks, but it does not provide an executable upgrade path.

The current contracts do not yet have a verified, shared upgrade flow:

- `community_governance` has `propose_upgrade`, `cancel_upgrade`, and
  `execute_upgrade` entry points with an on-chain ledger timelock. They require
  the configured admin's authorization.
- `multisig_admin` records proposals and approvals, but its generic operation
  path does not dispatch the stored call data to another contract. Reaching the
  approval threshold is therefore not sufficient to authorize a target
  contract upgrade.
- `energy_token` and `audit_registry` do not currently expose an upgrade
  entry point.

Do not treat an approved multisig operation or a pending governance proposal as
proof that a target contract can be upgraded safely. The missing authorization
and dispatch path must be implemented, tested, and reviewed before this runbook
can be used for a production upgrade.

## Required implementation before use

1. Implement an admin-authorized upgrade flow for each upgradeable contract.
2. Connect multisig approval to the target contract through an authenticated
   contract invocation; do not decode or execute arbitrary call data without a
   strict operation schema.
3. Apply and test the configured time-lock before the wasm update can execute.
4. Test that an upgrade preserves existing storage, rejects unauthorized
   callers, rejects early execution, and handles cancellation or replacement
   safely.
5. Review the migration and rollback behavior for the specific new wasm before
   deploying it.

## Per-upgrade procedure

Once the implementation prerequisites above are complete:

1. Build the reviewed contract wasm and record its SHA-256 wasm hash, source
   revision, toolchain, and audit reference in the upgrade proposal.
2. Verify the target network, contract ID, current wasm hash, admin/controller
   configuration, and expected storage schema. Confirm that a tested rollback
   wasm is available.
3. Submit the upgrade proposal through the configured multisig/governance
   process. Verify the proposal hash and unlock ledger independently before
   collecting approvals.
4. Wait until the on-chain timelock has elapsed. Do not bypass the delay for an
   operational incident; use the documented incident process instead.
5. Execute the approved upgrade and record the transaction hash and ledger
   sequence.
6. Verify the installed wasm hash and run read-only state checks plus the
   contract's post-upgrade smoke tests before resuming dependent operations.
7. Monitor contract errors and application metrics. If validation fails, use
   the approved rollback upgrade; a wasm rollback does not automatically undo
   storage migrations or external side effects.

Keep the proposal, approvals, transaction hashes, pre/post-upgrade checks, and
any rollback details with the release record.