# Issue #611 — Public verification kiosk mode: User story backlog

This file captures user stories and acceptance criteria for a public verification kiosk mode.

## Goal
Allow members of the public to verify credentials or readings at a public kiosk with minimal friction and strong privacy guarantees.

## User Stories

- As a public user, I can walk up to a verification kiosk and scan a QR code to see a read-only verification page.
- As a kiosk operator, I can switch the kiosk into 'demo' mode where sample data is shown without exposing real user data.
- As a user, I can request a printed receipt or short code to take away as proof of verification.
- As a system admin, I can configure an inactivity timeout and automatic screen lock for the kiosk.

## Acceptance Criteria

- The kiosk presents only read-only verification information; no personal data entry is required.
- Kiosk session automatically clears after inactivity.
- Demo mode uses sanitized sample data.

## Implementation status

**Status: Implemented** (Issue #122)

Kiosk mode is now available on the public verification page. The following acceptance criteria are satisfied:

- **Activation via URL param** — Kiosk mode is activated by appending `?kiosk=1` to the verify page URL.
- **Full-screen, touch-friendly layout** — Kiosk mode renders a full-screen layout with large touch targets suitable for physical installations.
- **Auto-reset after inactivity** — The kiosk automatically resets to the home state after 60 seconds of inactivity.
- **No keyboard shortcut required** — The kiosk is fully usable without any keyboard shortcuts; all interactions are touch/pointer driven.
- **WCAG 2.1 AA compliance** — Kiosk mode meets WCAG 2.1 AA accessibility requirements (contrast, focus visibility, target sizing, and semantics).

### References

- Verify page: `src/pages/verify` (kiosk mode handling via `?kiosk=1`)
- Unit tests: `src/pages/verify` test suite (kiosk activation, inactivity auto-reset)
- E2E specs: `e2e/verify-kiosk` (full-screen layout, touch targets, 60s auto-reset, accessibility checks)

## Notes
- Consider accessibility (large font, high contrast) and touch-friendly UI for public use.