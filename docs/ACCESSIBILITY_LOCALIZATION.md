# Accessibility & Localization Contribution Guide

This guide covers how to contribute accessible UI and localised content to SolarProof.

---

## Accessibility (a11y)

SolarProof targets **WCAG 2.1 AA** compliance. Every UI contribution must meet the criteria below.

### Semantic HTML

- Use the correct HTML element for its meaning (`<button>` for actions, `<a>` for navigation, `<header>` / `<main>` / `<nav>` landmarks).
- Never use `<div>` or `<span>` as interactive elements without an explicit ARIA role.

### Keyboard navigation

- All interactive elements must be reachable and operable by keyboard alone.
- Tab order must be logical and follow visual reading order.
- Modals and dialogs must trap focus while open and return focus on close.

### Screen reader support

- Every `<img>` needs a meaningful `alt` attribute. Use `alt=""` for purely decorative images.
- Icon-only buttons must have `aria-label` or `aria-labelledby`.
- Dynamic content updates (loading states, errors) must use `aria-live` regions or `role="status"`.

```tsx
// Good
<button aria-label="Verify certificate">
  <CheckIcon aria-hidden="true" />
</button>

// Bad
<div onClick={verify}>
  <CheckIcon />
</div>
```

### Colour and contrast

- Text must meet a contrast ratio of at least **4.5 : 1** against its background (AA).
- Large text (18 pt / 14 pt bold) requires at least **3 : 1**.
- Never convey information by colour alone — pair colour cues with icons or text.

### Forms

- Every `<input>`, `<select>`, and `<textarea>` must have a visible `<label>` (or `aria-label`).
- Validation errors must be programmatically associated with their field via `aria-describedby`.

```tsx
<label htmlFor="kwh-input">Energy (kWh)</label>
<input
  id="kwh-input"
  type="number"
  aria-describedby="kwh-error"
/>
{error && <p id="kwh-error" role="alert">{error}</p>}
```

### Testing accessibility

Run the automated audit before opening a PR:

```bash
# Install once
pnpm add -D @axe-core/react

# Add to your dev environment or Storybook — see axe-core docs
```

Also test manually with:
- **Keyboard only** — tab through every interactive element on your page.
- **Screen reader** — [NVDA](https://www.nvaccess.org/) (Windows) or VoiceOver (`Cmd+F5` on macOS).

---

## Localization (l10n)

SolarProof uses a file-based translation approach. All user-visible strings must be externalised — no hard-coded English text in components.

### Adding a new string

1. Add the key to **`apps/web/src/locales/en.json`** (the source-of-truth file):

```json
{
  "verify.title": "Verify Certificate",
  "verify.placeholder": "Enter certificate ID or transaction hash"
}
```

2. Use the `t()` helper (or equivalent i18n hook) in your component:

```tsx
import { useTranslation } from '@/lib/i18n'

export function VerifyPage() {
  const { t } = useTranslation()
  return <h1>{t('verify.title')}</h1>
}
```

3. Do **not** add translations to other language files yourself — the team will coordinate translations via the `locales/` PR process.

### Adding a new language

1. Copy `apps/web/src/locales/en.json` to `apps/web/src/locales/<locale>.json` (e.g. `fr.json`, `es.json`).
2. Translate every key. Keep the same key names.
3. Register the locale in `apps/web/src/lib/i18n.ts`.
4. Open a PR labelled `localization`.

### Translation guidelines

| Rule | Example |
|---|---|
| Use natural phrasing, not literal word-for-word | ✅ "Proof is valid" / ❌ "Proof valid is" |
| Preserve placeholders verbatim | `"Hello, {name}"` — do not translate `{name}` |
| Keep UI strings short | Buttons max ~3 words |
| Flag culturally ambiguous strings | Add a comment `// l10n: context needed` |

### RTL languages

For right-to-left languages (Arabic, Hebrew):

- Add the locale to `apps/web/src/lib/locales.ts` and define its direction in `LOCALE_DIRECTIONS`; the root layout applies that value to `<html dir>`.
- Use logical CSS properties and Tailwind utilities (`margin-inline-start` / `ms-*`, `padding-inline-start` / `ps-*`, `start-*`, and `end-*`) instead of physical left/right properties where the component allows it.
- Add a Playwright smoke test that selects the locale and checks the rendered document direction.
- The `ar` locale is an RTL preview and intentionally reuses English messages. Replace that fallback with reviewed Arabic translations before presenting it as a translated locale.
- Check mixed-direction content such as hashes, numbers, and external identifiers separately; use `<bdi>` when a value's direction should remain isolated from surrounding text.

---

## PR checklist

Before opening a PR that touches UI or strings:

- [ ] All images have `alt` text
- [ ] All interactive elements are keyboard accessible
- [ ] Colour contrast passes AA (use [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/))
- [ ] No hard-coded user-visible strings — all text goes through `t()`
- [ ] axe-core shows zero critical violations in dev
