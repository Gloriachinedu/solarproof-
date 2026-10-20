# Runbook: Incident Response

Covers detecting, containing, resolving, and learning from incidents affecting SolarProof.

---

## Severity Levels

| Level | Description | Response time |
|---|---|---|
| P1 — Critical | Production down, data loss, security breach | Immediate |
| P2 — High | Core feature broken, significant user impact | < 1 hour |
| P3 — Medium | Degraded performance, non-critical feature broken | < 4 hours |
| P4 — Low | Minor issue, cosmetic, no user impact | Next business day |

---

## Phase 1 — Detection and Triage

1. **Detect** — via monitoring alert, error report, or user feedback
2. **Record** — open an incident issue on GitHub with:
   - Severity level
   - Affected systems (web app, API, database, smart contracts, infrastructure)
   - Observed symptoms and first detection time
3. **Assign** — designate an incident commander (IC) responsible for coordination
4. **Communicate** — notify stakeholders via the agreed channel (Slack, email, etc.)

---

## Phase 2 — Containment

Act to stop the incident from worsening before root cause is known.

| Affected system | Containment action |
|---|---|
| Web app / API | Roll back the last Vercel deployment |
| Smart contract exploit | Invoke contract pause via governance (see below) |
| Compromised meter key | Deactivate the meter record immediately (see [meter-key-rotation.md](meter-key-rotation.md)) |
| Database corruption | Stop write traffic; put app in maintenance mode |
| Failed mints (bulk) | Pause the mint job queue; investigate (see [failed-mint-investigation.md](failed-mint-investigation.md)) |

**Pause a smart contract (if pause function available):**

```bash
stellar contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network mainnet \
  -- pause
```

**Roll back a Vercel deployment:**

```bash
vercel rollback --token <VERCEL_TOKEN>
# Or via Vercel dashboard: Deployments → previous deployment → Promote to Production
```

**Preserve evidence before making changes:**

```bash
# Capture recent application logs
# Export relevant database tables
# Screenshot monitoring dashboards
```

---

## Phase 3 — Investigation

1. Review application logs for errors around the incident start time
2. Check recent deployments, config changes, and dependency updates
3. Query the database for anomalous data:

```sql
-- Recent failed readings
SELECT * FROM readings WHERE created_at > now() - interval '1 hour' AND status != 'anchored';

-- Recent failed mints
SELECT * FROM mint_jobs WHERE status = 'failed' AND created_at > now() - interval '1 hour';

-- Audit log for recent admin actions
SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50;
```

4. Check Stellar network status: https://status.stellar.org
5. Check Vercel deployment status: https://vercel.com/status

---

## Phase 4 — Resolution

1. Apply the fix (code patch, config change, data correction, or rollback)
2. Validate recovery:
   - Run smoke tests against production
   - Confirm error rates return to baseline in monitoring
   - Verify a successful end-to-end reading submission if the API was affected
3. Lift containment measures (re-enable features, unpause contracts, restore write traffic)
4. Confirm with stakeholders that the incident is resolved

---

## Phase 5 — Postmortem

Complete within 48 hours of resolution for P1/P2 incidents.

1. Copy [post-mortem-template.md](post-mortem-template.md) to
   `docs/runbooks/post-mortems/YYYY-MM-DD-<slug>.md` and fill in all sections.
   The template covers:
   - Timeline (detection → containment → resolution)
   - Root cause
   - Impact (users affected, data affected, duration)
   - What went well / what went wrong
   - Remediation steps
   - Follow-up action items with owners and due dates
2. Update this runbook if any procedure was unclear or missing
3. Add monitoring or alerting to catch the same issue earlier next time
4. Share the postmortem with the team
5. Track all follow-up action items as GitHub issues

Past post-mortems are stored in [`docs/runbooks/post-mortems/`](post-mortems/).
See [2026-08-14-mint-outage.md](post-mortems/2026-08-14-mint-outage.md) as an example.

---

## Useful Links

- Stellar network status: https://status.stellar.org
- Stellar Expert (testnet): https://stellar.expert/explorer/testnet
- Stellar Expert (mainnet): https://stellar.expert/explorer/mainnet
- Vercel dashboard: https://vercel.com/dashboard
- Supabase dashboard: https://app.supabase.com
- GitHub Actions: https://github.com/katecatherinaa/solarproof/actions
- Security policy: [SECURITY.md](../../SECURITY.md)
