---
title: Certificate Retirement Reporting Backlog
status: in-progress
---

## Overview

Add backend and reporting support so retired certificates can be queried and exported for audit and regulatory purposes.

## Scope

- Add API endpoints to query retired certificates by date range, meter, and owner.
- Add background job to aggregate retirement metrics and export CSV reports.
- Document retention policy and access controls.

## Suggested Implementation Steps

1. Add `retired_at` and `retirement_reason` metadata to certificates table if not present.
2. Implement `GET /api/certificates?status=retired` with filters and pagination.
3. Add scheduled job to aggregate and store CSV reports in object storage; surface them in the admin UI.

## Cooperative Monthly Retirement Report (Implemented)

The cooperative monthly retirement report has been implemented (see #123).

### API Endpoint

- `GET /api/cooperative/retirement-report?month=YYYY-MM`
  - Returns report data for the requested month.
  - Report includes: total kWh retired, per-buyer breakdown, and certificate IDs.
  - Access is restricted to the authenticated cooperative admin.

### CSV Export

- The report is downloadable as CSV from the cooperative admin UI.
- CSV columns include buyer, certificate IDs, and retired kWh totals.

### Scheduled Monthly Report

- A scheduled job runs monthly to auto-generate the retirement report and email it to the cooperative admin.
- The job reuses the same aggregation logic as the API endpoint to keep figures consistent.

## Remaining Follow-ups

- Add `GET /api/certificates?status=retired` with date range, meter, and owner filters plus pagination (general-purpose query endpoint, distinct from the cooperative report).
- Confirm `retired_at` and `retirement_reason` metadata exist on the certificates table; add migration if missing.
- Persist generated CSV reports in object storage for historical access, in addition to emailing them.
- Document retention policy and access controls for retirement reports.
- Surface stored historical reports in the admin UI.
- Add tests covering the report endpoint, CSV export, and scheduled job.