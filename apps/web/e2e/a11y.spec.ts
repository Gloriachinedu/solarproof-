/**
 * Accessibility tests using axe-core — issue #124.
 *
 * These tests run axe-core on every major page and fail if critical or serious
 * violations are found. Baseline violations (if any) are documented below.
 */

import { test, expect } from '@playwright/test'
import { checkA11y } from './helpers/a11y'

test.describe('Accessibility (axe-core)', () => {
  test('skip link moves keyboard users to main content', async ({ page }) => {
    await page.goto('/')

    const skipLink = page.getByRole('link', { name: 'Skip to main content' })
    await page.keyboard.press('Tab')
    await expect(skipLink).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
  })

  test('verify page has no critical/serious violations', async ({ page }) => {
    await page.goto('/verify')
    await checkA11y(page)
  })

  test('home page has no critical/serious violations', async ({ page }) => {
    await page.goto('/')
    await checkA11y(page)
  })
})

/**
 * Baseline violations (if any):
 *
 * None documented yet. If baseline violations are discovered that cannot be
 * fixed immediately, document them here with:
 *   - Rule ID
 *   - Impact level
 *   - Element selector
 *   - Reason for deferral
 *   - Tracking issue number
 *
 * Example:
 *   - color-contrast (moderate) on .footer-link — deferred to #999
 */
