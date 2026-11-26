import { test, expect, enterAsGuest } from './fixtures.mjs'

test('beginner completes the eight stops by keyboard and can replay from Settings', async ({ page }) => {
  await enterAsGuest(page)
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
    localStorage.setItem('gym_state_v1', JSON.stringify({ ...state, experience: 'beginner' }))
    localStorage.removeItem('gym_tour_v1')
  })
  await page.reload()
  const dialog = page.getByRole('dialog')
  const press = async button => {
    await expect(button).toBeVisible()
    await button.focus()
    await page.keyboard.press('Enter')
  }
  await press(dialog.getByRole('button', { name: 'Show me' }))
  const targets = [
    ['start-home', 'start', 'Show me'], ['tick', 'tick', 'Show me'],
    ['rest', 'rest', 'Next'], ['swap', 'exercise-options', 'Next'], ['finish', 'finish', 'Next'],
    ['go-plan', 'tab-plan', 'Show me'], ['learn', 'settings-learn', 'Show me'],
    ['go-settings', 'settings-gear', 'Show me'],
  ]
  for (const [id, anchor, action] of targets) {
    await expect(page.locator('.tour')).toHaveAttribute('data-step', id)
    await expect(page.locator('[data-tour="' + anchor + '"]').first()).toBeVisible()
    await press(dialog.getByRole('button', { name: action }))
  }
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await page.goto('/#/settings/about')
  await press(page.getByRole('button', { name: /Show the tour again/ }))
  await expect(page.locator('.tour')).toHaveAttribute('data-step', 'start-home')
})
