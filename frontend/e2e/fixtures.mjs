// Shared E2E fixtures: a guard that fails any test whose page reached another host or threw,
// and helpers for the guest flow. Clicks go through element.click() because the onboarding
// tour's overlay sits over the page and would swallow a pointer click.
import { test as base, expect } from '@playwright/test'

const LOCAL = new Set(['localhost', '127.0.0.1'])

export const test = base.extend({
  guard: [async ({ page }, use) => {
    const external = [], thrown = []
    page.on('request', r => {
      const u = new URL(r.url())
      if (/^https?:$/.test(u.protocol) && !LOCAL.has(u.hostname)) external.push(u.origin + u.pathname)
    })
    page.on('pageerror', e => thrown.push(e.message))
    await use({ external, thrown })
    expect([...new Set(external)], 'requests that left this device').toEqual([])
    expect(thrown, 'uncaught errors in the page').toEqual([])
  }, { auto: true }],
})
export { expect }

export const click = locator => locator.first().evaluate(el => el.click())

/** Dismiss the first-run tour if it is showing. */
export async function skipTour(page) {
  const skip = page.getByRole('button', { name: 'Skip' })
  if (await skip.first().isVisible({ timeout: 1500 }).catch(() => false)) await click(skip)
}

const today = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** One logged workout with `sets` done sets of exercise `id`, dated today. */
export const workout = (i, id, sets) => ({
  id: 'e2e' + i, d: today(), t: Date.now() - i * 3_600_000,
  entries: [{ id, sets: Array.from({ length: sets }, () => ({ w: 60, r: 8, done: true })) }],
})

/**
 * Start as a guest. A guest's state is only written on its first change, and the store merges a
 * partial state over its defaults, so seeding writes `workouts` alone and reloads.
 */
export async function enterAsGuest(page, workouts) {
  await page.goto('/')
  await click(page.getByRole('button', { name: 'Continue without account' }))
  await expect.poll(() => page.evaluate(() => localStorage.getItem('gym_guest'))).toBeTruthy()
  if (workouts?.length) {
    await page.evaluate(w => {
      const S = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
      S.workouts = [...w, ...(S.workouts || [])]
      localStorage.setItem('gym_state_v1', JSON.stringify(S))
    }, workouts)
    await page.reload()
  }
}

export async function openRoute(page, route) {
  await page.evaluate(r => { location.hash = '#' + r }, route)
  await page.waitForLoadState('networkidle')
  await skipTour(page)
}

// Catalogue ids (frontend/src/lib/exercises.js): a squat, a bench press, a row, a curl.
export const EX = { squat: '3948', bench: '1254', row: '0010', curl: '4437' }
