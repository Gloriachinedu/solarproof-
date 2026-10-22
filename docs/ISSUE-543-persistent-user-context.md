# Issue #543 — Persistent user context for cooperative pages

Proposed approach for adding persistent user context across cooperative pages.

## Motivation

Some cooperative pages benefit from remembering the user's last-selected organization, role, or filter state across sessions to improve workflow continuity.

## Proposal

- Store minimal user context in an encrypted, signed cookie or in localStorage with explicit opt-in.
- Provide UI affordance to clear saved context.
- Ensure context storage respects privacy and data minimization principles.

## Acceptance Criteria

- Users can opt in to persist selection state across visits.
- Admins can clear persisted contexts from the server if needed.

## Implemented approach — dashboard filter persistence

Dashboard filters (date range, meter selection, and certificate status) are now persisted across sessions using `localStorage`. This is the first concrete implementation of the persistent user context described above.

### Behavior

- **Persist on change:** Whenever a dashboard filter changes, the current filter state is written to `localStorage`.
- **Restore on load:** On the next page load, the stored filter state is read back and applied, so the dashboard opens with the user's last-used filters.
- **Reset affordance:** A "Reset filters" button restores the default filter state and clears the stored entry for the current user, so no stale preferences remain.
- **Per-user storage:** Preferences are namespaced per user, so one user's filter settings are never applied to another user on the same browser.

### Namespaced key format

Stored entries use a namespaced key so they are scoped to the feature, the user, and the specific filter set:

```
coop:dashboard:filters:<userId>
```

- `coop` — application namespace, avoiding collisions with other `localStorage` entries.
- `dashboard:filters` — feature/scope identifier, allowing future pages to add their own scopes (e.g. `coop:<page>:<scope>:<userId>`).
- `<userId>` — the identifier of the signed-in user, ensuring preferences are stored per-user rather than globally.

The value is a JSON object containing only the filter fields (date range, meter selection, certificate status). No other data is stored.

### Privacy and data minimization

- Only the minimal filter state needed to restore the dashboard is stored — no personal data, credentials, or derived analytics.
- Storage is scoped per user via the namespaced key, so clearing one user's context does not affect others.
- The "Reset filters" affordance gives users an explicit way to clear their stored context at any time.
- Because the data lives in the browser's `localStorage`, it is not transmitted to or retained on the server; clearing browser storage removes it entirely.
- If a stored entry is missing, malformed, or belongs to a different user, the dashboard falls back to default filters rather than failing.

### Relationship to the original proposal

This implementation uses `localStorage` (rather than an encrypted, signed cookie) for the dashboard filter case, since the stored data is non-sensitive UI state. The per-user namespacing and the reset affordance satisfy the original acceptance criteria for user-controlled persistence and clearing of saved context. Server-side admin clearing of persisted contexts remains out of scope for this change and can be revisited if server-stored context is introduced.