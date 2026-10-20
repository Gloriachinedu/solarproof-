# Governance Parameter Tuning Guide

This guide provides best practices for configuring governance parameters in the SolarProof Community Governance contract. Choosing the right parameters is critical for balancing security, agility, and community participation.

## Parameters Overview

### 1. Quorum Threshold (`QuorumBps`)
The minimum percentage of "Yes" votes required for a proposal to pass, relative to the total number of registered voters.
- **Role**: Prevents small minorities from making significant changes.
- **Default**: 1000 (10%).

### 2. Approval Threshold (`ThresholdBps`)
The percentage of cast votes that must be "Yes" for the proposal to pass (majority rule).
- **Role**: Ensures broad consensus among active voters.
- **Default**: 5100 (51%).

### 3. Voting Duration (`VotingPeriod`)
The length of time (in ledgers) that a proposal remains open for voting.
- **Role**: Balances the need for quick decisions with giving voters enough time to review and cast their votes.
- **Scale**: In Soroban (10s ledger time), 1 day ≈ 8,640 ledgers.

### 4. Execution Timelock (`ExecuteTimelock`)
The cooldown period between a proposal passing and when it can actually be executed.
- **Role**: Provides a safety window for the community to react (or exit) if a malicious or controversial proposal passes.

### 5. Minimum Balance (Proposer Requirement)
*Note: Currently enforced socially or through custom front-ends/wrappers in SolarProof.*
- **Role**: Prevents spam by requiring proposers to have a "stake" in the system (e.g., holding a minimum amount of Energy Tokens).

---

## Tuning by DAO Size

### Small DAOs (< 100 Members)
Typically highly active, closely-knit groups where communication is efficient.
- **Goal**: High agility and high participation.
- **Quorum**: High (e.g., 20-30%) because reaching a large portion of 50 people is feasible.
- **Voting Duration**: Short (3-5 days).
- **Timelock**: Minimal (24 hours).

### Medium DAOs (100 - 1000 Members)
A mix of active contributors and passive observers.
- **Goal**: Balance security with participation.
- **Quorum**: Moderate (e.g., 10-15%).
- **Voting Duration**: Moderate (7 days).
- **Timelock**: Moderate (2-3 days).

### Large DAOs (1000+ Members)
High degree of voter apathy and diverse interests.
- **Goal**: Prevent gridlock while maintaining security.
- **Quorum**: Low (e.g., 2-5%) to avoid proposals constantly failing due to lack of turnout.
- **Voting Duration**: Long (10-14 days) to ensure enough reach.
- **Timelock**: Long (7 days) for maximum security.

---

## Example Configurations

| Size | Quorum (BPS) | Threshold (BPS) | Voting Period | Timelock |
| :--- | :--- | :--- | :--- | :--- |
| **Small** | 2500 (25%) | 5100 (51%) | 25,920 ledgers (~3 days) | 8,640 ledgers (~24h) |
| **Medium** | 1000 (10%) | 5100 (51%) | 60,480 ledgers (~7 days) | 17,280 ledgers (~48h) |
| **Large** | 300 (3%) | 6000 (60%) | 120,960 ledgers (~14 days) | 60,480 ledgers (~7 days) |

---

## Proposal TTL and Expiry

### How `expires_at` Works (planned — issue #46)

Every proposal will carry an `expires_at: u64` ledger sequence set at creation
time (`env.ledger().sequence() + VotingPeriod`). Once the current ledger passes
`expires_at`:

- `vote()` will reject new votes with `"proposal expired"`.
- `execute()` will reject execution even if the proposal previously passed.
- Any member may call `close_expired_proposal(proposal_id)` to move the status
  to `Expired`, freeing storage and making the state explicit.

### Choosing a Voting Period (TTL)

The `VotingPeriod` parameter directly controls `expires_at`. Use the table
above as a guide. A proposal that expires before enough community members have
voted cannot be revived — choose a voting period long enough for your community
to react.

### Quorum vs. Participation
- **High Quorum**: Highly secure against hostile takeovers but risks "governance gridlock" where nothing passes due to apathy.
- **Low Quorum**: Easy to pass changes, but susceptible to "ninja voting" (small groups passing changes while others aren't looking).

### Duration vs. Agility
- **Longer Durations**: Better for complex technical changes or high-stakes financial decisions. Give the community time to discuss on social channels.
- **Shorter Durations**: Better for operational tweaks or emergency responses.

### Timelocks as a Safety Valve
Always use a timelock for protocol upgrades or large fund movements. A 48-72 hour window is generally considered the "goldilocks" zone for medium-sized DAOs, allowing enough time for an "emergency pause" or for users to withdraw their stake if they disagree with the outcome.
