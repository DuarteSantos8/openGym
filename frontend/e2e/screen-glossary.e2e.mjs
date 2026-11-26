import AxeBuilder from '@axe-core/playwright'
import { test, expect, enterAsGuest, openRoute } from './fixtures.mjs'

for (const [screen, terms] of [
  ['workout', ['Warm-up', 'Working set', 'RIR', 'RPE', 'Drop set', 'Superset']],
  ['plan', ['Split', 'Rest day', 'Deload']],
  ['stats', ['PR', 'Volume', '1RM', 'Estimated 1RM']],
]) {
  test(`keyboard opens each ${screen} glossary definition`, async ({ page }) => {
    await enterAsGuest(page)
    await openRoute(page, '/' + screen)
    const glossary = page.locator('.iv-screen-glossary')
    const summary = glossary.locator('summary')
    await summary.focus()
    await page.keyboard.press('Enter')
    for (const name of terms) {
      const term = glossary.getByRole('button', { name, exact: true })
      await term.focus()
      await page.keyboard.press('Enter')
      const card = page.locator('.iv-term-card')
      await expect(card.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(card.locator('p')).not.toBeEmpty()
      await card.getByRole('button', { name: 'Got it' }).press('Enter')
      await expect(card).toHaveCount(0)
    }
    const { violations } = await new AxeBuilder({ page }).analyze()
    expect(violations).toEqual([])
  })
}
