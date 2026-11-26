import AxeBuilder from '@axe-core/playwright'
import { test, expect, enterAsGuest, openRoute } from './fixtures.mjs'

for (const lang of ['en', 'de', 'ru', 'ar', 'fa']) {
  const width = lang === 'en' ? 390 : 320
  test(`starter cards fit a ${width}px screen in ${lang}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await enterAsGuest(page)
    await page.evaluate(locale => {
      const state = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
      localStorage.setItem('gym_state_v1', JSON.stringify({ ...state, lang: locale, langAuto: false, theme: 'dark' }))
    }, lang)
    await page.reload()
    await openRoute(page, '/plan')
    const label = lang === 'en' ? 'Load starter plan' : (await import(`../src/locales/${lang}.js`)).default['Load starter plan']
    await page.getByRole('button', { name: label, exact: true }).click()
    const cards = page.locator('[data-plan]')
    await expect(cards).toHaveCount(8)
    await expect(page.locator('html')).toHaveAttribute('lang', lang)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await cards.evaluateAll(elements => elements.filter(card => {
      const box = card.getBoundingClientRect()
      return box.left < 0 || box.right > innerWidth || [...card.querySelectorAll('.tt, .ss')].some(line => line.scrollWidth > line.clientWidth)
    }).map(card => card.dataset.plan))).toEqual([])
    if (lang === 'en') {
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      expect(violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
      const path = testInfo.outputPath('starter-cards-390-dark.png')
      await page.screenshot({ path })
      await testInfo.attach('starter-cards-390-dark', { path, contentType: 'image/png' })
    }
  })
}

test('a device guest can open and load a fitted plan offline', async ({ page, context }) => {
  await enterAsGuest(page)
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
    const home = { id: 'home', name: 'Home dumbbells', equipment: ['dumbbell'] }
    localStorage.setItem('gym_state_v1', JSON.stringify({ ...state, equipProfiles: [home], activeEquipId: home.id, equipFilterOn: true }))
  })
  await page.reload()
  await openRoute(page, '/plan')
  const button = page.getByRole('button', { name: 'Load starter plan', exact: true })
  await expect(button).toBeVisible()
  await context.setOffline(true)
  await button.click()
  const plan = page.locator('[data-plan="5x5"]')
  await expect(page.locator('[data-plan="hotel"]')).toContainText('Two chairs')
  await expect(page.locator('[data-plan]').filter({ hasText: 'Two chairs' })).toHaveCount(1)
  await expect(plan).toContainText('dumbbell')
  await expect(plan).not.toContainText('Full gym')
  await plan.click()
  await expect.poll(() => page.evaluate(() => {
    const { week, routines } = JSON.parse(localStorage.getItem('gym_state_v1'))
    return [1, 3, 5].map(day => routines.find(r => r.id === week[day][0])?.name)
  })).toEqual(['5×5 A', '5×5 B', '5×5 C'])
})
