// Accessibility (EP16): axe-core, WCAG 2.1 A and AA rules, on the main screens as a guest with
// some training logged. A serious or critical violation fails the test.
import AxeBuilder from '@axe-core/playwright'
import { test, expect, click, enterAsGuest, openRoute, workout, EX } from './fixtures.mjs'

const SCREENS = ['/home', '/plan', '/stats', '/library', '/addons']

// Violations already in upstream openGym's own screens (code this fork has not changed), recorded
// 2026-11-15 so the test still fails on anything new. They belong upstream (docs/next/a11y.md);
// remove an entry once it is fixed there. Never add an entry for a screen this fork changed.
const UPSTREAM_BASELINE = {
  '/home': ['label-content-name-mismatch'],
  '/plan': ['label-content-name-mismatch'],
  '/stats': ['label-content-name-mismatch'],
}

for (const route of SCREENS) {
  test(`axe: no serious or critical violations on ${route}`, async ({ page }) => {
    // axe reads colours as they are at that instant: a card mid fade-in measures as low contrast
    // (seen once on /home). Reduce motion, then wait until no animation is running.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await enterAsGuest(page, [workout(1, EX.squat, 6), workout(2, EX.bench, 6)])
    await openRoute(page, route)
    if (route === '/addons') await click(page.getByRole('button', { name: 'Show in 3D' }))
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const known = UPSTREAM_BASELINE[route] || []
    const serious = violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    for (const id of known) if (!serious.some(v => v.id === id)) console.log(`${route}: baseline "${id}" no longer fires; remove it`)
    const bad = serious
      .filter(v => !known.includes(v.id))
      .map(v => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
    expect(bad).toEqual([])
  })
}
