import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js'
import { test, expect, click, enterAsGuest, openRoute } from './fixtures.mjs'

test('guest loads an OpenNutriTracker ZIP locally, confirms, and reopens the diary offline', async ({ page, context }, testInfo) => {
  await enterAsGuest(page)
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
    state.modules = { ...state.modules, nutrition: true }
    state.theme = 'dark'
    localStorage.setItem('gym_state_v1', JSON.stringify(state))
  })
  await page.reload()
  await openRoute(page, '/nutrition')
  const day = await page.evaluate(() => new Intl.DateTimeFormat('sv-SE').format(new Date()))
  const file = { name: 'nutrition-test.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({
    'user_intake.csv': strToU8('id,date_time,type,amount,unit,meal_name,meal_unit,protein_per_100g\n' +
      'c21dd305-aa9e-4e52-b38c-c58fcc3ef899,' + day + 'T12:00:00.000,lunch,50,g,QA lentils,g,10'),
    'goal_settings.json': strToU8('not part of the diary'),
  })) }
  await page.getByLabel('Import OpenNutriTracker export').setInputFiles(file)
  await expect(page.getByText('Import into the diary on this device?')).toBeVisible()
  await expect(page.getByText('QA lentils', {exact:true})).toHaveCount(0)
  await page.getByRole('button', { name: 'Import', exact: true }).scrollIntoViewIfNeeded()
  const screenshot = testInfo.outputPath('nutrition-import-confirmation.png')
  await page.screenshot({ path: screenshot })
  await testInfo.attach('nutrition-import-confirmation', { path: screenshot, contentType: 'image/png' })
  await click(page.getByRole('button', {name:'Import',exact:true}))
  await expect(page.getByRole('status').filter({hasText:'Added: 1. Updated: 0. Unchanged: 0.'})).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready))
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await context.setOffline(true)
  try {
    const response = await page.reload()
    expect(response.fromServiceWorker()).toBe(true)
    await expect(page.locator('.nutrition-entry strong')).toHaveText('QA lentils')
    await page.getByLabel('Import OpenNutriTracker export').setInputFiles(file)
    await click(page.getByRole('button', {name:'Import',exact:true}))
    await expect(page.getByText('Added: 0. Updated: 0. Unchanged: 1.')).toBeVisible()
    await expect(page.locator('.nutrition-entry strong')).toHaveCount(1)
  } finally { await context.setOffline(false) }
})
