import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, enterAsGuest, openRoute } from './fixtures.mjs'

const routine = {
  id: 'weekly-push', name: 'Synthetic push', emoji: 'dumbbell',
  ex: [
    { id: 'weekly-press', sets: 3, reps: 8, mode: 'reps', warmupSets: 1 },
    { id: 'weekly-fly', sets: 2, reps: 8, mode: 'reps' },
  ],
}

async function seed(page, { lang = 'en', goal = 'muscle', empty = false } = {}) {
  await page.route(/\/exercise-media\/|\/anatomy\/|\/exercise-(?:stills|photos)\//, route => route.abort())
  await page.addInitScript(() => localStorage.setItem('gym_tour_v1', JSON.stringify({ done: true })))
  await enterAsGuest(page)
  await page.evaluate(({ routine, lang, goal, empty }) => {
    const state = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
    Object.assign(state, {
      lang, theme: 'dark', quiz: { goal },
      customEx: [
        { id: 'weekly-press', n: 'Synthetic press', bp: 'chest', primaries: ['chest'], secondaries: ['triceps'], custom: true },
        { id: 'weekly-fly', n: 'Synthetic fly', bp: 'chest', primaries: ['chest'], custom: true },
        { id: 'weekly-curl', n: 'Synthetic curl', bp: 'upper arms', primaries: ['biceps'], custom: true },
      ],
      routines: [routine, { id: 'weekly-arms', name: 'Synthetic arms', emoji: 'dumbbell', ex: [{ id: 'weekly-curl', sets: 3, reps: 8, mode: 'reps' }] }],
      week: empty ? {} : { 1: [routine.id], 2: [], 3: ['weekly-arms'], 5: [routine.id] },
      dayPlan: { '2026-11-23': ['weekly-arms'] },
      muscleTargets: { biceps: [1, 2] },
      newExDefaults: { sets: 2 },
    })
    localStorage.setItem('gym_state_v1', JSON.stringify(state))
  }, { routine, lang, goal, empty })
  await page.reload()
  await openRoute(page, '/plan/r/' + routine.id)
}

const panel = page => page.locator('.routine-weekly-sets')
const screenshot = async (page, name) => {
  if (process.env.WEEKLY_SETS_QA_DIR) {
    await panel(page).locator('summary').evaluate(el => el.scrollIntoView({ block: 'start' }))
    await page.screenshot({ path: join(process.env.WEEKLY_SETS_QA_DIR, `${test.info().project.name}-${name}.png`) })
  }
}
const row = (page, muscle) => panel(page).getByRole('listitem').filter({ hasText: new RegExp(`^${muscle}\\b`) })

test('shows the hand count and updates after keyboard edits, removal, undo and addition offline', async ({ page, context }) => {
  await seed(page)
  await expect(panel(page)).toBeVisible()
  const summary = panel(page).locator('summary')
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(row(page, 'Chest')).toContainText(/10.*10–20.*in range/i)
  await expect(row(page, 'Triceps')).toContainText(/2\.4.*6–16.*below range/i)
  await expect(row(page, 'Biceps')).toContainText(/3.*1–2.*above range.*personal target/i)
  await expect(panel(page).getByRole('link', { name: /RP Strength/ })).toBeVisible()
  await expect(panel(page)).toContainText('Draft')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  if (test.info().project.name === 'chromium') {
    await screenshot(page, 'dark-390-en')
    if (process.env.WEEKLY_SETS_QA_DIR) {
      const viewport = page.viewportSize()
      await page.setViewportSize({ width: 1440, height: 900 })
      await screenshot(page, 'dark-1440-en')
      await page.setViewportSize(viewport)
    }
  }
  const { violations } = await new AxeBuilder({ page }).include('.routine-weekly-sets').analyze()
  expect(violations).toEqual([])

  await context.setOffline(true)
  const readCounts = async () => {
    await expect(page.getByRole('dialog')).toHaveCount(0)
    if (await panel(page).getAttribute('open') === null) await summary.press('Enter')
  }
  const fly = page.getByRole('button', { name: /^Synthetic fly [0-9]/ })
  const config = page.getByRole('dialog', { name: 'Synthetic fly' })
  await fly.press('Enter')
  await config.getByRole('button', { name: 'Sets: Increase' }).press('Enter')
  await config.getByRole('button', { name: 'Save', exact: true }).press('Enter')
  await readCounts()
  await expect(row(page, 'Chest')).toContainText(/12.*10–20.*in range/i)
  await fly.press('Enter')
  await config.getByRole('button', { name: 'Remove from routine' }).press('Enter')
  await readCounts()
  await expect(row(page, 'Chest')).toContainText(/6.*10–20.*below range/i)
  await page.getByRole('button', { name: 'Undo', exact: true }).press('Enter')
  await readCounts()
  await expect(row(page, 'Chest')).toContainText(/12.*10–20.*in range/i)

  await page.getByRole('button', { name: 'Add exercise', exact: true }).press('Enter')
  await page.getByPlaceholder(/Search .* exercises/).fill('Synthetic curl')
  await page.getByRole('button', { name: /Add .Synthetic curl./ }).press('Enter')
  await page.keyboard.press('Escape')
  await readCounts()
  await expect(row(page, 'Biceps')).toContainText(/7.*1–2.*above range/i)
})

test('shows personal targets and counts without a saved goal', async ({ page }) => {
  await seed(page, { goal: null })
  await panel(page).locator('summary').press('Enter')
  await expect(row(page, 'Chest')).toHaveText('Chest · 10')
  await expect(row(page, 'Biceps')).toContainText(/3.*1–2.*personal target/i)
  await expect(panel(page).getByRole('link')).toHaveCount(0)
})

test('shows an empty estimate for an unscheduled routine, even with a dated override', async ({ page }) => {
  await seed(page, { empty: true })
  await panel(page).locator('summary').press('Enter')
  await expect(panel(page)).toContainText('No working sets in the recurring plan.')
  await expect(panel(page).getByRole('listitem')).toHaveCount(0)
})

for (const lang of ['de', 'ru', 'ar']) {
  test(`fits a 320 px dark phone in ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 })
    await seed(page, { lang })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveAttribute('lang', lang)
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
    await panel(page).locator('summary').press('Enter')
    await expect(panel(page).getByRole('listitem').first()).toBeVisible()
    expect(await panel(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect(panel(page)).not.toContainText('below range')
    await screenshot(page, `dark-320-${lang}`)
  })
}
