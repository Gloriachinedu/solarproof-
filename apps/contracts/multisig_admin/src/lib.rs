//! # Multisig Admin (`multisig-admin`)
//!
//! 2-of-3 multi-signature controller for SolarProof admin operations.
//!
//! Any of the three signers may propose an operation (encoded as raw call
//! bytes). Once `threshold` distinct signers have approved, the operation is
//! marked executable. Pending operations are stored on-chain and visible to
//! anyone via `get_op`.
//!
//! ## Time-lock
//! Critical operations (contract upgrade, minter change, etc.) are subject to
//! a configurable time-lock delay (minimum 24 h). A critical op proposed via
//! `propose_critical` enters a `pending` state and cannot be executed until
//! `timelock_delay_seconds` have elapsed. During the lock period any signer
//! with enough approvals (`threshold`) may cancel the op via `cancel_critical`.
//!
//! ## Signer rotation
//! Rotating the signer set is itself an operation that must pass the current
//! threshold — no single key can unilaterally replace the signers.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Bytes, Env};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    /// Address of signer at index 0, 1, or 2.
    Signer(u32),
    /// Approval threshold (default 2).
    Threshold,
    /// Total number of operations proposed (used as next op ID).
    OpCount,
    /// Pending operation keyed by op ID.
    Op(u32),
    /// Approval bitmap for an operation (bit i = signer i approved).
    Approvals(u32),
    /// Time-lock delay in seconds for critical operations (min 86400 = 24 h).
    TimelockDelay,
    /// Critical operation keyed by op ID.
    CriticalOp(u32),
    /// Cancel-approval bitmap for a critical operation.
    CancelApprovals(u32),
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A pending admin operation.
#[contracttype]
#[derive(Clone)]
pub struct Op {
    /// Opaque call data describing the operation (e.g. ABI-encoded call).
    pub call_data: Bytes,
    /// True once the operation has been executed.
    pub executed: bool,
}

/// Minimum time-lock delay: 24 hours in seconds.
pub const MIN_TIMELOCK_SECONDS: u64 = 86_400;

/// A pending critical operation subject to the time-lock delay.
#[contracttype]
#[derive(Clone)]
pub struct CriticalOp {
    /// Opaque call data describing the critical operation.
    pub call_data: Bytes,
    /// Ledger timestamp (seconds since Unix epoch) at which this op was proposed.
    pub proposed_at: u64,
    /// Ledger timestamp after which the op may be executed.
    pub executable_after: u64,
    /// True once the operation has been executed.
    pub executed: bool,
    /// True if the operation was cancelled.
    pub cancelled: bool,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct MultisigAdmin;

#[contractimpl]
impl MultisigAdmin {
    /// Initialise the contract with three signers and a threshold.
    ///
    /// # Panics
    /// * `"already initialized"` if called more than once.
    /// * `"threshold must be 1-3"` if threshold is out of range.
    /// * `"timelock must be >= 86400"` if delay is below 24 h.
    pub fn initialize(
        env: Env,
        signer0: Address,
        signer1: Address,
        signer2: Address,
        threshold: u32,
        timelock_delay_seconds: u64,
    ) {
        if env.storage().instance().has(&DataKey::Threshold) {
            panic!("already initialized");
        }
        assert!(threshold >= 1 && threshold <= 3, "threshold must be 1-3");
        assert!(
            timelock_delay_seconds >= MIN_TIMELOCK_SECONDS,
            "timelock must be >= 86400"
        );
        env.storage().instance().set(&DataKey::Signer(0), &signer0);
        env.storage().instance().set(&DataKey::Signer(1), &signer1);
        env.storage().instance().set(&DataKey::Signer(2), &signer2);
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::OpCount, &0_u32);
        env.storage()
            .instance()
            .set(&DataKey::TimelockDelay, &timelock_delay_seconds);
    }

    /// Propose a new operation. The proposer's approval is counted automatically.
    ///
    /// # Returns
    /// The new operation's ID.
    ///
    /// # Panics
    /// * `"not a signer"` if `proposer` is not one of the three signers.
    pub fn propose(env: Env, proposer: Address, call_data: Bytes) -> u32 {
        proposer.require_auth();
        let idx = Self::signer_index(&env, &proposer);

        let op_id: u32 = env.storage().instance().get(&DataKey::OpCount).unwrap_or(0);
        let op = Op {
            call_data,
            executed: false,
        };
        env.storage().instance().set(&DataKey::Op(op_id), &op);

        // Auto-approve for proposer
        let bitmap: u32 = 1 << idx;
        env.storage()
            .instance()
            .set(&DataKey::Approvals(op_id), &bitmap);

        env.storage()
            .instance()
            .set(&DataKey::OpCount, &(op_id + 1));
        env.events().publish((symbol_short!("proposed"),), op_id);

        // Execute immediately if threshold already met (e.g. threshold = 1)
        if Self::approval_count(bitmap) >= Self::threshold(&env) {
            Self::mark_executed(&env, op_id);
        }

        op_id
    }

    /// Approve a pending operation. Executes it if threshold is now met.
    ///
    /// # Panics
    /// * `"not a signer"` if `signer` is not one of the three signers.
    /// * `"op not found"` if `op_id` does not exist.
    /// * `"already executed"` if the operation has already been executed.
    /// * `"already approved"` if this signer has already approved.
    pub fn approve(env: Env, signer: Address, op_id: u32) {
        signer.require_auth();
        let idx = Self::signer_index(&env, &signer);

        let op: Op = env
            .storage()
            .instance()
            .get(&DataKey::Op(op_id))
            .expect("op not found");
        assert!(!op.executed, "already executed");

        let mut bitmap: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Approvals(op_id))
            .unwrap_or(0);
        assert!((bitmap >> idx) & 1 == 0, "already approved");

        bitmap |= 1 << idx;
        env.storage()
            .instance()
            .set(&DataKey::Approvals(op_id), &bitmap);
        env.events()
            .publish((symbol_short!("approved"),), (op_id, idx));

        if Self::approval_count(bitmap) >= Self::threshold(&env) {
            Self::mark_executed(&env, op_id);
        }
    }

    /// Rotate the signer set. Must be proposed and approved through the
    /// normal multisig flow — this is a convenience wrapper that encodes
    /// the rotation as call_data and proposes it.
    ///
    /// The actual signer update only takes effect once the returned op is
    /// approved by the required threshold via `approve()`, at which point
    /// `execute_rotate` must be called with the same op_id.
    ///
    /// # Panics
    /// * `"not a signer"` if `proposer` is not a current signer.
    pub fn propose_rotate(
        env: Env,
        proposer: Address,
        new0: Address,
        new1: Address,
        new2: Address,
        new_threshold: u32,
    ) -> u32 {
        proposer.require_auth();
        let idx = Self::signer_index(&env, &proposer);
        assert!(
            new_threshold >= 1 && new_threshold <= 3,
            "threshold must be 1-3"
        );

        // Inline op creation (cannot call propose() — would double require_auth).
        let op_id: u32 = env.storage().instance().get(&DataKey::OpCount).unwrap_or(0);
        let mut data = Bytes::new(&env);
        data.push_back(0x01_u8); // rotation tag
        let op = Op {
            call_data: data,
            executed: false,
        };
        env.storage().instance().set(&DataKey::Op(op_id), &op);

        let bitmap: u32 = 1 << idx;
        env.storage()
            .instance()
            .set(&DataKey::Approvals(op_id), &bitmap);
        env.storage()
            .instance()
            .set(&DataKey::OpCount, &(op_id + 1));

        // Store the new signer set alongside the op so execute_rotate can apply it.
        env.storage()
            .instance()
            .set(&DataKey::Signer(op_id * 10 + 3), &new0);
        env.storage()
            .instance()
            .set(&DataKey::Signer(op_id * 10 + 4), &new1);
        env.storage()
            .instance()
            .set(&DataKey::Signer(op_id * 10 + 5), &new2);
        env.storage()
            .instance()
            .set(&(symbol_short!("rot_thr"), op_id), &new_threshold);

        env.events().publish((symbol_short!("proposed"),), op_id);

        // Execute immediately if threshold already met (e.g. threshold = 1).
        // Note: rotation ops are NOT auto-applied here — caller must call execute_rotate.
        op_id
    }

    /// Apply a previously approved rotation operation.
    ///
    /// # Panics
    /// * `"op not found"` if `op_id` does not exist.
    /// * `"not a rotation op"` if the op was not created by `propose_rotate`.
    /// * `"threshold not met"` if the op has not been approved by enough signers.
    pub fn execute_rotate(env: Env, op_id: u32) {
        let op: Op = env
            .storage()
            .instance()
            .get(&DataKey::Op(op_id))
            .expect("op not found");
        assert!(op.call_data.get(0) == Some(0x01_u8), "not a rotation op");

        let bitmap: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Approvals(op_id))
            .unwrap_or(0);
        assert!(
            Self::approval_count(bitmap) >= Self::threshold(&env),
            "threshold not met"
        );

        let new0: Address = env
            .storage()
            .instance()
            .get(&DataKey::Signer(op_id * 10 + 3))
            .expect("op not found");
        let new1: Address = env
            .storage()
            .instance()
            .get(&DataKey::Signer(op_id * 10 + 4))
            .expect("op not found");
        let new2: Address = env
            .storage()
            .instance()
            .get(&DataKey::Signer(op_id * 10 + 5))
            .expect("op not found");
        let new_threshold: u32 = env
            .storage()
            .instance()
            .get(&(symbol_short!("rot_thr"), op_id))
            .expect("op not found");

        env.storage().instance().set(&DataKey::Signer(0), &new0);
        env.storage().instance().set(&DataKey::Signer(1), &new1);
        env.storage().instance().set(&DataKey::Signer(2), &new2);
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &new_threshold);

        env.events().publish((symbol_short!("rotated"),), op_id);
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Returns the pending operation with the given ID, or panics if not found.
    pub fn get_op(env: Env, op_id: u32) -> Op {
        env.storage()
            .instance()
            .get(&DataKey::Op(op_id))
            .expect("op not found")
    }

    /// Returns the approval bitmap for an operation (bit i = signer i approved).
    pub fn get_approvals(env: Env, op_id: u32) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Approvals(op_id))
            .unwrap_or(0)
    }

    /// Returns the signer at the given index (0, 1, or 2).
    pub fn get_signer(env: Env, index: u32) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Signer(index))
            .expect("not initialized")
    }

    /// Returns the current approval threshold.
    pub fn get_threshold(env: Env) -> u32 {
        Self::threshold(&env)
    }

    /// Returns the total number of operations proposed.
    pub fn op_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::OpCount).unwrap_or(0)
    }

    // ── Time-lock / critical operations ───────────────────────────────────────

    /// Returns the configured time-lock delay in seconds.
    pub fn timelock_delay(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::TimelockDelay)
            .expect("not initialized")
    }

    /// Propose a critical operation subject to the time-lock delay.
    ///
    /// The operation enters a `pending` state immediately but cannot be
    /// executed until `timelock_delay_seconds` have elapsed. The proposer's
    /// approval is counted automatically.
    ///
    /// # Returns
    /// The new critical operation's ID.
    ///
    /// # Panics
    /// * `"not a signer"` if `proposer` is not one of the three signers.
    pub fn propose_critical(env: Env, proposer: Address, call_data: Bytes) -> u32 {
        proposer.require_auth();
        let idx = Self::signer_index(&env, &proposer);

        let op_id: u32 = env.storage().instance().get(&DataKey::OpCount).unwrap_or(0);
        let delay: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TimelockDelay)
            .expect("not initialized");

        let now = env.ledger().timestamp();
        let critical_op = CriticalOp {
            call_data,
            proposed_at: now,
            executable_after: now + delay,
            executed: false,
            cancelled: false,
        };
        env.storage()
            .instance()
            .set(&DataKey::CriticalOp(op_id), &critical_op);

        // Auto-approve for proposer
        let bitmap: u32 = 1 << idx;
        env.storage()
            .instance()
            .set(&DataKey::Approvals(op_id), &bitmap);
        env.storage()
            .instance()
            .set(&DataKey::OpCount, &(op_id + 1));

        env.events()
            .publish((symbol_short!("crit_prop"),), (op_id, now + delay));

        op_id
    }

    /// Approve a pending critical operation.
    ///
    /// # Panics
    /// * `"not a signer"` if `signer` is not one of the three signers.
    /// * `"critical op not found"` if `op_id` does not exist.
    /// * `"already executed"` if the operation has already been executed.
    /// * `"already cancelled"` if the operation was cancelled.
    /// * `"already approved"` if this signer already approved.
    pub fn approve_critical(env: Env, signer: Address, op_id: u32) {
        signer.require_auth();
        let idx = Self::signer_index(&env, &signer);

        let op: CriticalOp = env
            .storage()
            .instance()
            .get(&DataKey::CriticalOp(op_id))
            .expect("critical op not found");
        assert!(!op.executed, "already executed");
        assert!(!op.cancelled, "already cancelled");

        let mut bitmap: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Approvals(op_id))
            .unwrap_or(0);
        assert!((bitmap >> idx) & 1 == 0, "already approved");

        bitmap |= 1 << idx;
        env.storage()
            .instance()
            .set(&DataKey::Approvals(op_id), &bitmap);
        env.events()
            .publish((symbol_short!("crit_apr"),), (op_id, idx));
    }

    /// Execute a critical operation after the time-lock has expired.
    ///
    /// # Panics
    /// * `"critical op not found"` if `op_id` does not exist.
    /// * `"already executed"` if already executed.
    /// * `"already cancelled"` if the op was cancelled.
    /// * `"threshold not met"` if not enough signers have approved.
    /// * `"timelock not expired"` if the lock period has not elapsed.
    pub fn execute_critical(env: Env, op_id: u32) {
        let mut op: CriticalOp = env
            .storage()
            .instance()
            .get(&DataKey::CriticalOp(op_id))
            .expect("critical op not found");
        assert!(!op.executed, "already executed");
        assert!(!op.cancelled, "already cancelled");

        let bitmap: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Approvals(op_id))
            .unwrap_or(0);
        assert!(
            Self::approval_count(bitmap) >= Self::threshold(&env),
            "threshold not met"
        );

        let now = env.ledger().timestamp();
        assert!(now >= op.executable_after, "timelock not expired");

        op.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::CriticalOp(op_id), &op);
        env.events()
            .publish((symbol_short!("crit_exe"),), op_id);
    }

    /// Cancel a pending critical operation during the lock period.
    ///
    /// Any signer may initiate a cancellation; once `threshold` distinct signers
    /// have called `cancel_critical` the op is marked cancelled.
    ///
    /// # Panics
    /// * `"not a signer"` if `signer` is not one of the three signers.
    /// * `"critical op not found"` if `op_id` does not exist.
    /// * `"already executed"` if the operation has already been executed.
    /// * `"already cancelled"` if already cancelled.
    /// * `"already voted to cancel"` if this signer already voted.
    pub fn cancel_critical(env: Env, signer: Address, op_id: u32) {
        signer.require_auth();
        let idx = Self::signer_index(&env, &signer);

        let mut op: CriticalOp = env
            .storage()
            .instance()
            .get(&DataKey::CriticalOp(op_id))
            .expect("critical op not found");
        assert!(!op.executed, "already executed");
        assert!(!op.cancelled, "already cancelled");

        let mut cancel_bitmap: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CancelApprovals(op_id))
            .unwrap_or(0);
        assert!((cancel_bitmap >> idx) & 1 == 0, "already voted to cancel");

        cancel_bitmap |= 1 << idx;
        env.storage()
            .instance()
            .set(&DataKey::CancelApprovals(op_id), &cancel_bitmap);

        if Self::approval_count(cancel_bitmap) >= Self::threshold(&env) {
            op.cancelled = true;
            env.storage()
                .instance()
                .set(&DataKey::CriticalOp(op_id), &op);
            env.events()
                .publish((symbol_short!("crit_can"),), op_id);
        }
    }

    /// Returns the critical operation with the given ID, or panics if not found.
    pub fn get_critical_op(env: Env, op_id: u32) -> CriticalOp {
        env.storage()
            .instance()
            .get(&DataKey::CriticalOp(op_id))
            .expect("critical op not found")
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn threshold(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Threshold)
            .expect("not initialized")
    }

    /// Returns the index (0, 1, or 2) of `addr` in the signer set.
    /// Panics with `"not a signer"` if not found.
    fn signer_index(env: &Env, addr: &Address) -> u32 {
        for i in 0u32..3 {
            let s: Address = env
                .storage()
                .instance()
                .get(&DataKey::Signer(i))
                .expect("not initialized");
            if s == *addr {
                return i;
            }
        }
        panic!("not a signer");
    }

    /// Count the number of set bits in a u32 bitmap.
    fn approval_count(bitmap: u32) -> u32 {
        bitmap.count_ones()
    }

    /// Mark an operation as executed and emit an event.
    fn mark_executed(env: &Env, op_id: u32) {
        let mut op: Op = env
            .storage()
            .instance()
            .get(&DataKey::Op(op_id))
            .expect("op not found");
        op.executed = true;
        env.storage().instance().set(&DataKey::Op(op_id), &op);
        env.events().publish((symbol_short!("executed"),), op_id);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Bytes, Env};

    fn setup() -> (Env, Address, Address, Address, MultisigAdminClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &id);
        let s0 = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        client.initialize(&s0, &s1, &s2, &2_u32, &86_400_u64);
        (env, s0, s1, s2, client)
    }

    fn call_data(env: &Env) -> Bytes {
        let mut b = Bytes::new(env);
        b.push_back(0xAA);
        b
    }

    // ── initialization ────────────────────────────────────────────────────────

    #[test]
    fn test_initialize_stores_signers_and_threshold() {
        let (env, s0, s1, s2, client) = setup();
        assert_eq!(client.get_signer(&0), s0);
        assert_eq!(client.get_signer(&1), s1);
        assert_eq!(client.get_signer(&2), s2);
        assert_eq!(client.get_threshold(), 2);
        let _ = (env,);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_panics() {
        let (env, s0, s1, s2, client) = setup();
        client.initialize(&s0, &s1, &s2, &2_u32, &86_400_u64);
        let _ = env;
    }

    #[test]
    #[should_panic(expected = "threshold must be 1-3")]
    fn test_invalid_threshold_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &id);
        let s0 = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        client.initialize(&s0, &s1, &s2, &0_u32, &86_400_u64);
    }

    // ── propose ───────────────────────────────────────────────────────────────

    #[test]
    fn test_propose_creates_op_and_auto_approves_proposer() {
        let (env, s0, _s1, _s2, client) = setup();
        let op_id = client.propose(&s0, &call_data(&env));
        assert_eq!(op_id, 0);
        assert_eq!(client.op_count(), 1);
        // bit 0 set (signer 0 auto-approved)
        assert_eq!(client.get_approvals(&op_id), 0b001);
        assert!(!client.get_op(&op_id).executed);
    }

    #[test]
    #[should_panic(expected = "not a signer")]
    fn test_propose_by_non_signer_panics() {
        let (env, _s0, _s1, _s2, client) = setup();
        let outsider = Address::generate(&env);
        client.propose(&outsider, &call_data(&env));
    }

    // ── approve / threshold enforcement ──────────────────────────────────────

    #[test]
    fn test_single_approval_does_not_execute() {
        let (env, s0, _s1, _s2, client) = setup();
        let op_id = client.propose(&s0, &call_data(&env));
        // only 1 approval (proposer); threshold is 2
        assert!(!client.get_op(&op_id).executed);
    }

    #[test]
    fn test_second_approval_executes_op() {
        let (env, s0, s1, _s2, client) = setup();
        let op_id = client.propose(&s0, &call_data(&env));
        client.approve(&s1, &op_id);
        assert!(client.get_op(&op_id).executed);
        // both bits set
        assert_eq!(client.get_approvals(&op_id), 0b011);
    }

    #[test]
    fn test_third_signer_approval_also_executes() {
        let (env, s0, _s1, s2, client) = setup();
        let op_id = client.propose(&s0, &call_data(&env));
        client.approve(&s2, &op_id);
        assert!(client.get_op(&op_id).executed);
    }

    #[test]
    #[should_panic(expected = "already approved")]
    fn test_double_approval_panics() {
        let (env, s0, _s1, _s2, client) = setup();
        let op_id = client.propose(&s0, &call_data(&env));
        client.approve(&s0, &op_id); // s0 already approved via propose
    }

    #[test]
    #[should_panic(expected = "already executed")]
    fn test_approve_after_execution_panics() {
        let (env, s0, s1, s2, client) = setup();
        let op_id = client.propose(&s0, &call_data(&env));
        client.approve(&s1, &op_id); // executes
        client.approve(&s2, &op_id); // must panic
    }

    #[test]
    #[should_panic(expected = "not a signer")]
    fn test_approve_by_non_signer_panics() {
        let (env, s0, _s1, _s2, client) = setup();
        let op_id = client.propose(&s0, &call_data(&env));
        let outsider = Address::generate(&env);
        client.approve(&outsider, &op_id);
    }

    // ── threshold = 1 executes immediately on propose ─────────────────────────

    #[test]
    fn test_threshold_one_executes_on_propose() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &id);
        let s0 = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        client.initialize(&s0, &s1, &s2, &1_u32, &86_400_u64);
        let op_id = client.propose(&s0, &call_data(&env));
        assert!(client.get_op(&op_id).executed);
    }

    // ── signer rotation ───────────────────────────────────────────────────────

    #[test]
    fn test_rotate_signers_requires_threshold() {
        let (env, s0, s1, _s2, client) = setup();
        let n0 = Address::generate(&env);
        let n1 = Address::generate(&env);
        let n2 = Address::generate(&env);
        let op_id = client.propose_rotate(&s0, &n0, &n1, &n2, &2_u32);
        // only 1 approval so far — rotation not applied yet
        assert_eq!(client.get_signer(&0), s0);
        // second signer approves
        client.approve(&s1, &op_id);
        // now execute the rotation
        client.execute_rotate(&op_id);
        assert_eq!(client.get_signer(&0), n0);
        assert_eq!(client.get_signer(&1), n1);
        assert_eq!(client.get_signer(&2), n2);
    }

    #[test]
    #[should_panic(expected = "threshold not met")]
    fn test_execute_rotate_before_threshold_panics() {
        let (env, s0, _s1, _s2, client) = setup();
        let n0 = Address::generate(&env);
        let n1 = Address::generate(&env);
        let n2 = Address::generate(&env);
        let op_id = client.propose_rotate(&s0, &n0, &n1, &n2, &2_u32);
        client.execute_rotate(&op_id); // only 1 approval
    }

    #[test]
    #[should_panic(expected = "not a signer")]
    fn test_rotate_by_non_signer_panics() {
        let (env, _s0, _s1, _s2, client) = setup();
        let outsider = Address::generate(&env);
        let n0 = Address::generate(&env);
        let n1 = Address::generate(&env);
        let n2 = Address::generate(&env);
        client.propose_rotate(&outsider, &n0, &n1, &n2, &2_u32);
    }

    // ── multiple ops ─────────────────────────────────────────────────────────

    #[test]
    fn test_multiple_ops_independent() {
        let (env, s0, s1, s2, client) = setup();
        let op0 = client.propose(&s0, &call_data(&env));
        let op1 = client.propose(&s1, &call_data(&env));
        // approve op0 with s1 → executes
        client.approve(&s1, &op0);
        assert!(client.get_op(&op0).executed);
        // op1 still pending
        assert!(!client.get_op(&op1).executed);
        // approve op1 with s2 → executes
        client.approve(&s2, &op1);
        assert!(client.get_op(&op1).executed);
    }

    // ── time-lock / critical ops ──────────────────────────────────────────────

    #[test]
    fn test_timelock_delay_stored_correctly() {
        let (env, _s0, _s1, _s2, client) = setup();
        assert_eq!(client.timelock_delay(), 86_400_u64);
        let _ = env;
    }

    #[test]
    #[should_panic(expected = "timelock must be >= 86400")]
    fn test_initialize_rejects_short_timelock() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &id);
        let s0 = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        // 1 hour < 24 h minimum
        client.initialize(&s0, &s1, &s2, &2_u32, &3_600_u64);
    }

    #[test]
    fn test_propose_critical_stores_pending_op() {
        let (env, s0, _s1, _s2, client) = setup();
        env.ledger().set_timestamp(1_000_000);
        let op_id = client.propose_critical(&s0, &call_data(&env));
        let op = client.get_critical_op(&op_id);
        assert!(!op.executed);
        assert!(!op.cancelled);
        assert_eq!(op.proposed_at, 1_000_000);
        assert_eq!(op.executable_after, 1_000_000 + 86_400);
    }

    #[test]
    #[should_panic(expected = "timelock not expired")]
    fn test_execute_critical_before_lock_expires_panics() {
        let (env, s0, s1, _s2, client) = setup();
        env.ledger().set_timestamp(1_000_000);
        let op_id = client.propose_critical(&s0, &call_data(&env));
        client.approve_critical(&s1, &op_id);
        // Still within lock period
        env.ledger().set_timestamp(1_000_000 + 86_399);
        client.execute_critical(&op_id);
    }

    #[test]
    fn test_execute_critical_after_lock_expires_succeeds() {
        let (env, s0, s1, _s2, client) = setup();
        env.ledger().set_timestamp(1_000_000);
        let op_id = client.propose_critical(&s0, &call_data(&env));
        client.approve_critical(&s1, &op_id);
        // Advance past the lock period
        env.ledger().set_timestamp(1_000_000 + 86_400);
        client.execute_critical(&op_id);
        let op = client.get_critical_op(&op_id);
        assert!(op.executed);
    }

    #[test]
    fn test_cancel_critical_during_lock_period() {
        let (env, s0, s1, _s2, client) = setup();
        env.ledger().set_timestamp(1_000_000);
        let op_id = client.propose_critical(&s0, &call_data(&env));
        // Two signers vote to cancel — meets threshold of 2
        client.cancel_critical(&s0, &op_id);
        client.cancel_critical(&s1, &op_id);
        let op = client.get_critical_op(&op_id);
        assert!(op.cancelled);
        assert!(!op.executed);
    }

    #[test]
    fn test_single_cancel_vote_does_not_cancel() {
        let (env, s0, _s1, _s2, client) = setup();
        env.ledger().set_timestamp(1_000_000);
        let op_id = client.propose_critical(&s0, &call_data(&env));
        // Only one signer votes to cancel — threshold is 2
        client.cancel_critical(&s0, &op_id);
        let op = client.get_critical_op(&op_id);
        assert!(!op.cancelled);
    }

    #[test]
    #[should_panic(expected = "already cancelled")]
    fn test_execute_cancelled_critical_op_panics() {
        let (env, s0, s1, _s2, client) = setup();
        env.ledger().set_timestamp(1_000_000);
        let op_id = client.propose_critical(&s0, &call_data(&env));
        client.approve_critical(&s1, &op_id);
        // Cancel the op
        client.cancel_critical(&s0, &op_id);
        client.cancel_critical(&s1, &op_id);
        // Advance past lock period and try to execute — should panic
        env.ledger().set_timestamp(1_000_000 + 86_400);
        client.execute_critical(&op_id);
    }

    #[test]
    #[should_panic(expected = "threshold not met")]
    fn test_execute_critical_without_threshold_panics() {
        let (env, s0, _s1, _s2, client) = setup();
        env.ledger().set_timestamp(1_000_000);
        let op_id = client.propose_critical(&s0, &call_data(&env));
        // Only proposer has approved (1 of 2 required); advance past lock
        env.ledger().set_timestamp(1_000_000 + 86_400);
        client.execute_critical(&op_id);
    }

    #[test]
    fn test_timelock_48h_is_accepted() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &id);
        let s0 = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        // 48 h delay
        client.initialize(&s0, &s1, &s2, &2_u32, &172_800_u64);
        assert_eq!(client.timelock_delay(), 172_800_u64);
    }
}
