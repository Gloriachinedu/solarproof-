# Third-Party Security Audit Reports

This directory contains the final reports from the independent third-party security audit of the Stellar-Spend smart contracts, as required by issue #118 before mainnet launch.

## Purpose

The internal audit (`docs/security/SECURITY_AUDIT_REPORT.md`) identified 13 findings. Before mainnet, an independent third-party audit of all three contracts is required. This directory is the canonical location for publishing the results of that engagement, including the initial audit report and the re-audit of remediated findings.

## Expected Contents

Once the engagement is complete, this directory will contain:

- **Final third-party audit report** — the complete report delivered by the selected audit firm, covering all three contracts in scope per `docs/AUDIT_SCOPE.md`.
- **Re-audit results** — the follow-up report confirming remediation of findings raised in the initial audit (including verification that all HIGH findings from the internal audit were remediated before the third-party audit began).
- **Supporting artifacts** (optional) — any appendices, finding trackers, or remediation evidence provided by the firm.

## Publishing Instructions

When the audit report is received from the audit firm:

1. **Verify completeness** — confirm the report covers the full scope defined in `docs/AUDIT_SCOPE.md` (all three contracts) and that it is the final, signed-off version.
2. **Confirm no redactions are required** — the report is intended to be public. If the firm requires any redactions, coordinate with them before publishing and note the redactions in this README.
3. **Add the report** — place the report file in this directory using a descriptive name, e.g.:
   - `docs/audits/<firm-name>-audit-report-<YYYY-MM-DD>.pdf`
   - `docs/audits/<firm-name>-reaudit-report-<YYYY-MM-DD>.pdf`
4. **Update this README** — add an entry to the "Published Reports" table below with the firm name, report type, date, and a link to the file.
5. **Cross-reference** — link the published report from `docs/security/SECURITY_AUDIT_REPORT.md` and the project root `README.md` so it is discoverable.
6. **Open a PR** — submit the report and README update in a pull request referencing issue #118. Do not merge until the report has been reviewed for accuracy against the delivered version.

## Published Reports

| Report | Firm | Date | Link |
| ------ | ---- | ---- | ---- |
| _Pending engagement_ | — | — | — |

## Status

- [ ] Audit firm selected and engaged
- [ ] Scope defined per `docs/AUDIT_SCOPE.md`
- [ ] All HIGH findings from internal audit remediated before third-party audit
- [ ] Third-party audit report published in `docs/audits/`
- [ ] Re-audit of remediated findings conducted

> **Note:** This directory is a placeholder until the third-party audit is complete. Do not add speculative or draft reports here — only final, delivered reports should be published.