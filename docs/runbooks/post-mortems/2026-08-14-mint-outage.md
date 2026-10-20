# Post-Mortem: Energy Token Mint Outage (2026-08-14)

> **Template:** [post-mortem-template.md](../post-mortem-template.md)

---

## Incident Summary

| Field | Value |
|---|---|
| **Title** | Energy token minting stopped processing for ~40 minutes |
| **Date** | 2026-08-14 |
| **Severity** | P2 |
| **Duration** | 43 minutes (09:17 UTC → 10:00 UTC) |
| **Incident Commander** | @katecatherinaa |
| **Participants** | @katecatherinaa, @margaretking76 |
| **Status** | Resolved |

---

## Timeline

| Time (UTC) | Event |
|---|---|
| 09:17 | Upptime alert fired: `POST /api/readings` returning HTTP 500 |
| 09:21 | IC acknowledged; incident channel opened in Slack |
| 09:25 | Checked Vercel logs — `TypeError: Cannot read properties of undefined (reading 'sequence')` in mint job |
| 09:30 | Identified root cause: Stellar testnet RPC returned empty account object during brief network instability |
| 09:35 | Containment: mint job queue paused via admin endpoint |
| 09:42 | Stellar testnet confirmed healthy at status.stellar.org |
| 09:50 | Fix deployed: added nil-check and retry logic to `getRpcServer` account fetch |
| 09:55 | Mint job queue re-enabled; backlogged jobs began processing |
| 10:00 | All queued readings processed; error rate at 0%; incident resolved |

---

## Root Cause

A missing nil-check in the mint job processor caused an unhandled exception when
the Stellar testnet RPC returned an empty account object during a ~15-minute period
of testnet instability. The job processor crashed on the first failed fetch and stopped
consuming the queue entirely, causing a full stall rather than a per-job failure.

---

## Impact

| Dimension | Details |
|---|---|
| **Users affected** | ~12 active meters; 0 end users saw dashboard errors (minting is async) |
| **Data affected** | 37 readings queued but not minted; all successfully processed post-recovery |
| **Revenue / SLA** | 43 minutes degraded; no SLA breach (P2 threshold is 1 hour) |
| **Downstream systems** | Audit registry anchoring also stalled (depends on mint job completion) |

---

## What Went Well

- Upptime alert fired within 8 minutes of the first 500 error
- Mint job queue pause prevented duplicate processing when the fix was deployed
- All 37 queued readings processed correctly after recovery — no data loss
- Stellar testnet status page gave clear confirmation of network instability

---

## What Went Wrong

- Mint job processor lacked per-job error isolation — one crash stalled the entire queue
- No alert specifically for "mint queue depth increasing" — the 500 alert was indirect
- No circuit breaker on the Stellar RPC client to back off during network instability
- Runbook for mint failures ([failed-mint-investigation.md](failed-mint-investigation.md)) did not cover queue-wide stall scenario

---

## Remediation

1. Added nil-check for the account object returned by `server.getAccount()` in `buildTransaction`
2. Added exponential backoff retry (3 attempts, 2-second base delay) around the account fetch
3. Updated mint job processor to catch per-job errors and mark individual jobs as `failed` without halting the queue consumer
4. Re-queued and processed all 37 stalled readings via the admin retry endpoint

---

## Follow-up Action Items

| # | Action | Owner | Due date | Issue |
|---|---|---|---|---|
| 1 | Add mint queue depth alert (threshold: >20 pending jobs for >5 min) | @katecatherinaa | 2026-08-21 | #110 |
| 2 | Implement circuit breaker on Stellar RPC client | @margaretking76 | 2026-08-28 | #42 |
| 3 | Update failed-mint-investigation runbook with queue-stall recovery steps | @katecatherinaa | 2026-08-21 | — |
| 4 | Add integration test: mint job survives RPC returning empty account | @margaretking76 | 2026-08-28 | #110 |

---

## Lessons Learned

The biggest gap was job-level error isolation: a single bad RPC response should fail one
job, not the whole consumer. We also lacked a dedicated alert for queue depth — the only
signal was the HTTP 500 from the readings endpoint, which is indirect and slower to fire.

Going forward: all queue consumers must catch per-job errors and continue; queue depth
metrics must be monitored independently of HTTP error rates.

---

## References

- Incident issue: #103 *(example)*
- Related runbook: [failed-mint-investigation.md](failed-mint-investigation.md)
- Stellar testnet status during incident: https://status.stellar.org
