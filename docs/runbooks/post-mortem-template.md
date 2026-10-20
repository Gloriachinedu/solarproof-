# Post-Mortem Template

Use this template for all P1 and P2 incidents. Complete within 48 hours of resolution.
Copy this file to `docs/runbooks/post-mortems/YYYY-MM-DD-<slug>.md` and fill in each section.

---

## Incident Summary

| Field | Value |
|---|---|
| **Title** | _Short description of the incident_ |
| **Date** | _YYYY-MM-DD_ |
| **Severity** | _P1 / P2 / P3_ |
| **Duration** | _HH:MM (detection → resolution)_ |
| **Incident Commander** | _Name / GitHub handle_ |
| **Participants** | _Names / GitHub handles_ |
| **Status** | _Resolved / Monitoring_ |

---

## Timeline

List events in chronological order. Be specific — include times (UTC), actions taken, and who took them.

| Time (UTC) | Event |
|---|---|
| HH:MM | _Monitoring alert fired / user report received_ |
| HH:MM | _Incident acknowledged; IC assigned_ |
| HH:MM | _Root cause hypothesis formed_ |
| HH:MM | _Containment action applied (describe)_ |
| HH:MM | _Fix deployed / rolled back_ |
| HH:MM | _Service confirmed healthy; incident resolved_ |

---

## Root Cause

_One or two sentences describing the underlying cause — not just the symptom.
Example: "A missing nil-check in the mint job processor caused a panic when the
Stellar RPC returned an empty account object during a brief testnet outage."_

---

## Impact

| Dimension | Details |
|---|---|
| **Users affected** | _Number / percentage of active users_ |
| **Data affected** | _Records impacted, data integrity status_ |
| **Revenue / SLA** | _Downtime duration, SLA breach (yes/no)_ |
| **Downstream systems** | _Any dependent systems impacted_ |

---

## What Went Well

- _Example: On-call rotation responded within 5 minutes_
- _Example: Rollback procedure worked without data loss_
- _Example: Monitoring alert fired before users reported the issue_

---

## What Went Wrong

- _Example: Runbook for this scenario was missing_
- _Example: Alert threshold was too high — 30 minutes of impact before detection_
- _Example: No feature flag to disable the affected code path without a deploy_

---

## Remediation

Steps taken to resolve the incident and restore service.

1. _Describe each remediation step_
2. _Include commands or configs changed where relevant_

---

## Follow-up Action Items

Each item must have an owner and a due date.

| # | Action | Owner | Due date | Issue |
|---|---|---|---|---|
| 1 | _Add monitoring alert for X_ | @handle | YYYY-MM-DD | #_ |
| 2 | _Write runbook for Y scenario_ | @handle | YYYY-MM-DD | #_ |
| 3 | _Add unit test covering edge case Z_ | @handle | YYYY-MM-DD | #_ |

---

## Lessons Learned

_Summarise the key takeaways for the team. What should we do differently?
What systemic improvements would prevent this class of incident in the future?_

---

## References

- Incident issue: #_
- Related runbook: [incident-response.md](incident-response.md)
- Monitoring dashboard: _link_
- Relevant logs / traces: _link_
