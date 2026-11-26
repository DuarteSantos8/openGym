import { test, expect, click, enterAsGuest, openRoute, workout } from './fixtures.mjs'

for (const reduced of [false, true]) {
  test('a device workout saves with ' + (reduced ? 'reduced motion' : 'workout haptics'), async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
    await page.addInitScript(() => {
      window.workoutBuzzes = []
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value(pattern) { window.workoutBuzzes.push(pattern); return true },
      })
    })
    await enterAsGuest(page, [workout(1, '0025', 2)])
    await page.evaluate(() => {
      const S = JSON.parse(localStorage.getItem('gym_state_v1'))
      Object.assign(S, {sound: false, vibrate: true, workoutView:'list', active: {
        id:'active', d:S.workouts[0].d, start:Date.now(), name:'Test session', cur:0, workoutView:'list',
        entries:[{id:'0025',target:{mode:'reps',sets:2,reps:8},sets:[
          {w:70,r:8,done:false}, {w:60,r:8,done:false},
        ]}],
      }})
      localStorage.setItem('gym_state_v1', JSON.stringify(S))
    })
    await page.reload()
    await openRoute(page, '/workout')
    await context.setOffline(true)
    await click(page.locator('[data-tour="tick"]'))
    await expect(page.locator('.setrec').first()).toBeVisible()
    await click(page.locator('[data-tour="finish"]'))
    const finish = page.getByRole('button', {name:/Finish and save/})
    await expect(finish).toBeVisible()
    const hasCompletion = () => page.evaluate(() => window.workoutBuzzes.some(p => JSON.stringify(p) === '[40,60,120]'))
    expect(await hasCompletion()).toBe(false)
    await click(finish)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1')).active)).toBeNull()
    expect(await hasCompletion()).toBe(!reduced)
    const buzzes = await page.evaluate(() => window.workoutBuzzes)
    expect(buzzes.includes(30)).toBe(!reduced)
    expect(buzzes.some(p => JSON.stringify(p) === '[40,60,40,60,120]')).toBe(!reduced)
  })
}
