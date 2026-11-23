// The first-session load finder (EP22-T04), end to end as a guest: an exercise never logged
// offers "Find my weight", two answers settle a weight, and it lands in every open work set.
// Scanned with axe; the fixture fails on any request that leaves this machine.
import AxeBuilder from '@axe-core/playwright'
import { test, expect, click, enterAsGuest, openRoute } from './fixtures.mjs'

async function seriousOn(page) {
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(300)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
}

const state = page => page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1') || '{}'))

test('a never-logged exercise finds its starting weight from two test sets', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await enterAsGuest(page)
  // A session in progress with one barbell bench press (0025), three open sets and no weight yet.
  await page.evaluate(id => {
    const S = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
    S.active = { id: 'e2e-lf', d: new Date().toISOString().slice(0, 10), name: 'First session', start: Date.now(), cur: 0, routineIds: [], bw: null,
      entries: [{ id, target: { mode: 'reps', sets: 3, reps: 8 }, sets: [0, 1, 2].map(() => ({ w: 0, r: 8, done: false })) }] }
    localStorage.setItem('gym_state_v1', JSON.stringify(S))
  }, '0025')
  await page.reload()
  await openRoute(page, '/workout')

  const find = page.locator('[data-load-finder]')
  await expect(find).toBeVisible({ timeout: 10_000 })
  await click(find)
  const lf = page.locator('.iv-lf')
  await expect(lf).toBeVisible()
  const first = Number(await lf.getAttribute('data-weight'))
  expect(first).toBeGreaterThan(0)
  await expect(lf.locator('.iv-lf-try')).toContainText('8')
  expect(await seriousOn(page)).toEqual([])

  await click(lf.locator('[data-feel="easy"]'))
  await expect(lf).toHaveAttribute('data-tries', '1')
  const second = Number(await lf.getAttribute('data-weight'))
  expect(second).toBeGreaterThan(first)
  await click(lf.locator('[data-feel="right"]'))
  await expect(lf.locator('.iv-lf-found')).toContainText(String(second))
  expect(await seriousOn(page)).toEqual([])
  await click(lf.locator('[data-use]'))
  await expect(page.locator('.iv-lf')).toHaveCount(0)

  await expect.poll(async () => (await state(page)).active?.entries?.[0]?.sets?.filter(s => !s.warmup && !s.warm).map(s => s.w).slice(-3)).toEqual([second, second, second])
})

// EP23-T05: a Beginner's Library opens on the exercises that come with a form guide.
test('a Beginner\'s Library opens on guided exercises and one tap shows everything', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await enterAsGuest(page)
  await page.evaluate(() => {
    const S = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
    S.experience = 'beginner'
    localStorage.setItem('gym_state_v1', JSON.stringify(S))
  })
  await page.reload()
  await openRoute(page, '/library')
  const chip = page.locator('[data-guided]')
  await expect(chip).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
  await expect(chip).toContainText('With form guide')
  // the barbell squat has a guide and leads; nothing unguided is in the list
  await expect(page.locator('.item .tt', { hasText: /^barbell full squat$/i })).toHaveCount(1)
  const guidedRows = await page.locator('.item .tt').count()
  expect(guidedRows).toBeLessThan(60)
  expect(await seriousOn(page)).toEqual([])
  await click(chip)
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => page.locator('.item .tt').count()).toBeGreaterThan(guidedRows - 10)
})
