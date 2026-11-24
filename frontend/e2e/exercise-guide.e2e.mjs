// Form guidance on the exercise sheet (EP23), end to end as a guest: the cues and mistakes show
// for an exercise from the starter plans, the easier version opens from it, and an exercise
// without a guide looks as it always did. Scanned with axe; the fixture fails on any request
// that leaves this machine.
import AxeBuilder from '@axe-core/playwright'
import { test, expect, click, enterAsGuest, openRoute } from './fixtures.mjs'

async function seriousOn(page) {
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(300)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
}

test('a starter-plan exercise explains how to do it well and leads to an easier version', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await enterAsGuest(page)
  await openRoute(page, '/library')
  await page.getByPlaceholder(/Search/).fill('dumbbell goblet squat')
  await click(page.getByRole('button', { name: /^dumbbell goblet squat /i }).first())

  const guide = page.locator('.iv-guide')
  await expect(guide).toBeVisible({ timeout: 10_000 })
  await expect(guide).toHaveAttribute('data-guide', '1760')
  await expect(guide.locator('.iv-guide-cues li')).toHaveCount(4)
  await expect(guide.locator('.iv-guide-mistakes li').first()).toContainText('Keep it touching your breastbone')
  await expect(guide.locator('.iv-guide-facts')).toContainText('Front of the thighs and the glutes')
  await expect(guide.locator('.iv-guide-foot')).toHaveText('General guidance. Stop if something hurts.')
  await expect(guide).not.toContainText('Reviewed by')
  expect(await seriousOn(page)).toEqual([])

  await click(guide.locator('[data-rung="1197"]'))
  await expect(page.locator('.iv-guide')).toHaveAttribute('data-guide', '1197')
  await expect(page.locator('.exdetail-name')).toHaveText(/squat/i)
  // and from there the ladder leads back up
  await expect(page.locator('.iv-guide [data-rung="1760"]')).toBeVisible()
})

test('an exercise without a guide shows its sheet as before', async ({ page }) => {
  await enterAsGuest(page)
  await openRoute(page, '/library')
  await page.getByPlaceholder(/Search/).fill('barbell wrist curl')
  await click(page.getByRole('button', { name: /^barbell wrist curl /i }).first())
  await expect(page.locator('.exdetail-name')).toBeVisible()
  await expect(page.locator('.ex-learn')).toBeVisible()
  await page.waitForTimeout(800)
  await expect(page.locator('.iv-guide')).toHaveCount(0)
})
