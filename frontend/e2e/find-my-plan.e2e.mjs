// Find my plan and Learn (EP21, EP22, EP24), end to end in a real browser as a guest: the welcome
// card, six questions, a plan with its reasons, "Use this plan", the level it sets, and Learn.
// The fixtures' guard fails every test here if any request leaves this machine, and both new
// screens are scanned with axe (WCAG 2.1 A and AA; serious or critical fails).
import AxeBuilder from '@axe-core/playwright'
import { test, expect, click, enterAsGuest, openRoute } from './fixtures.mjs'

const option = (page, value) => page.locator(`.iv-quiz [data-option="${value}"]`)
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1') || '{}'))

async function settle(page) {
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(300)
}
async function seriousOn(page) {
  await settle(page)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
}
async function answer(page, values) {
  for (const v of values) {
    await expect(option(page, v)).toBeVisible()
    await click(option(page, v))
  }
}

test('a new guest answers six questions, gets a plan with reasons and starts with it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await enterAsGuest(page)
  await openRoute(page, '/home')
  await click(page.locator('[data-start="quiz"]'))
  await expect(page).toHaveURL(/#\/start$/)
  await expect(page.locator('.iv-quiz-q')).toHaveText('What do you want most?')
  expect(await seriousOn(page)).toEqual([])

  await answer(page, ['general', '3', '45', 'none', 'never'])
  await expect(page.locator('.iv-quiz-q')).toHaveText('Anything to be careful with?')
  expect(await seriousOn(page)).toEqual([])
  await click(page.getByRole('button', { name: 'Show my plan' }))

  const plan = page.locator('.iv-quiz-plan')
  await expect(plan).toHaveAttribute('data-plan', 'home-bw')
  await expect(plan).toContainText('Beginner')
  await expect(plan).toContainText('3 days per week')
  await expect(page.locator('[data-why]')).toHaveCount(2)
  await expect(page.locator('.iv-quiz-day')).toHaveCount(3)
  expect(await seriousOn(page)).toEqual([])

  // the word explains itself, in place
  await click(page.locator('.iv-term'))
  await expect(page.locator('.iv-term-card')).toContainText('A group of reps done without stopping')
  await click(page.locator('.iv-term-card').getByRole('button', { name: 'Got it' }))

  await click(page.getByRole('button', { name: 'Use this plan' }))
  await expect(page).toHaveURL(/#\/home$/)
  const S = await state(page)
  expect(S.routines.map(r => r.name)).toEqual(['Bodyweight A', 'Bodyweight B'])
  expect(S.experience).toBe('beginner')
  expect(S.modules.effort).toBe(false)
  expect(S.quiz).toEqual({ goal: 'general', days: 3, minutes: 45, equipment: 'none', experience: 'never' })
  // the welcome card has done its job and is gone
  await expect(page.locator('[data-start="quiz"]')).toHaveCount(0)
})

test('a limitation makes the plan gentler, asks for a professional first and is not kept', async ({ page }) => {
  await enterAsGuest(page)
  await openRoute(page, '/start')
  await answer(page, ['strength', '5', '60', 'gym', 'never', 'pregnancy'])
  await click(page.getByRole('button', { name: 'Show my plan' }))
  await expect(page.locator('.iv-quiz-ask')).toContainText('check with a doctor or physiotherapist')
  await expect(page.locator('[data-why="caution"]')).toBeVisible()
  await expect(page.locator('[data-why="days-capped"]')).toBeVisible()
  await expect(page.locator('.iv-quiz-plan')).toContainText('2 sets of 12 reps to start.')
  await click(page.getByRole('button', { name: 'Use this plan' }))
  await expect(page).toHaveURL(/#\/home$/)
  expect(JSON.stringify(await state(page))).not.toContain('pregnancy')
})

test('Learn opens a guide in place and searches the glossary, offline content only', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await enterAsGuest(page)
  await openRoute(page, '/learn')
  await expect(page.getByRole('heading', { name: 'Learn', level: 1 })).toBeVisible()
  await expect(page.locator('[data-guide]')).toHaveCount(8)
  expect(await seriousOn(page)).toEqual([])

  const guide = page.locator('[data-guide="how-heavy"]')
  await click(guide.locator('button'))
  await expect(guide.locator('.iv-learn-body')).toContainText('starting weight')
  expect(await seriousOn(page)).toEqual([])

  await page.locator('.iv-learn .searchf input').fill('reps in reserve')
  await expect(page.locator('[data-term]').first()).toHaveAttribute('data-term', 'rir')
  await page.locator('.iv-learn .searchf input').fill('zzzzqq')
  await expect(page.getByText('No term matches.')).toBeVisible()
  await expect(page.locator('.iv-learn a[href]')).toHaveCount(0)
})
