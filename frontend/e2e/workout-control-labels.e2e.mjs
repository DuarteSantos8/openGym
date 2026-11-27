import AxeBuilder from '@axe-core/playwright'
import { test, expect, enterAsGuest, openRoute, click } from './fixtures.mjs'

async function textFits(locator) {
  return locator.evaluateAll(els => els.every(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const box = el.closest('button').getBoundingClientRect()
    return [...range.getClientRects()].every(r => r.left >= Math.max(0, box.left) - 1
      && r.right <= Math.min(innerWidth, box.right) + 1)
      && el.scrollWidth <= el.clientWidth + 1
  }))
}
async function doubleText(page) {
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll('body *')].filter(el => el instanceof HTMLElement)
      .map(el => [el, parseFloat(getComputedStyle(el).fontSize)])
    for (const [el, size] of sizes) el.style.setProperty('font-size', size * 2 + 'px', 'important')
  })
}
async function overlaysFit(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('#tabbar')
    const timer = document.querySelector('#timer')
    const app = document.querySelector('#app')
    if (!bar || !timer || !app) return false
    const start = bar.querySelector('.start').getBoundingClientRect()
    const timerBox = timer.getBoundingClientRect()
    const tolerance = 1
    if (timerBox.bottom > Math.min(bar.getBoundingClientRect().top, start.top) + tolerance) return false
    let top = timerBox.top
    if (document.body.classList.contains('totop-on')) {
      const button = document.querySelector('#totop')
      const box = button.getBoundingClientRect()
      if (box.bottom > timerBox.top + tolerance) return false
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      if (!button.contains(hit)) return false
      top = Math.min(top, box.top)
    }
    return parseFloat(getComputedStyle(app).paddingBottom) >= innerHeight - top - tolerance
  })
}
for (const lang of ['de', 'ru', 'ar', 'fa']) {
  test('workout labels stay readable and named at 320px in ' + lang, async ({page}, testInfo) => {
    await page.setViewportSize({width:320,height:844})
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
    await enterAsGuest(page)
    await page.evaluate(lang => {
      const s = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
      s.lang = lang; s.langAuto = false; s.theme = 'dark'; s.workoutView = 'cards'
      s.active = { id:'qa', d:'2026-11-27', start:Date.now(), name:'QA', cur:0, entries:[
        {id:'0025',target:{mode:'reps',sets:2,reps:8},sets:[{w:60,r:8,done:false},{w:60,r:8,done:false}],
          plan:{policy:'linear',kind:'up',weight:62.5,why:['Every rep last time. {0} {1} more.',2.5,'kg']}},
      ] }
      localStorage.setItem('gym_state_v1', JSON.stringify(s))
    },lang)
    await page.reload()
    for (const route of ['workout', 'settings']) {
      await openRoute(page, '/' + route)
      const sel = route === 'workout'
        ? '.wk-acts button span, .progline > span:not(.vh)'
        : '#tabbar button:not(.start) > span:last-child, #tabbar .tab-resume'
      const labels = page.locator(sel)
      await expect(labels.first()).toBeVisible()
      expect.soft(await textFits(labels)).toBe(true)
      if (route === 'settings') await expect.poll(() => overlaysFit(page)).toBe(true)
      if (lang === 'de' && route === 'workout') {
        await page.setViewportSize({width:390,height:844})
        await labels.first().scrollIntoViewIfNeeded()
        await page.screenshot({path:testInfo.outputPath('actions-390-dark.png'),mask:[page.locator('img,canvas,video')]})
        await page.setViewportSize({width:320,height:844})
      }
      const target = route === 'workout' ? '.progline' : '#tabbar .start'
      await expect(page.locator(target).first()).toBeVisible()
      if (route === 'settings') {
        const tab = page.locator(target)
        const resume = await tab.locator('.tab-resume').evaluate(el => el.firstChild.textContent.trim())
        await expect(tab).toHaveAccessibleName(resume, { exact: true })
        await expect(tab.locator('.tab-time')).toHaveAttribute('aria-hidden', 'true')
      } else {
        const line = page.locator(target).first()
        const visible = (await line.locator('span:not(.vh)').innerText()).trim()
        const purpose = (await line.locator('.vh').textContent()).trim()
        await expect(line).toHaveAccessibleName(visible + ' ' + purpose)
      }
      const {violations} = await new AxeBuilder({page}).include(target).withRules(['label-content-name-mismatch']).analyze()
      expect.soft(violations.map(v => v.id)).toEqual([])
      if (route === 'workout') {
        await click(page.locator('[data-tour="tick"]').first())
        await expect(page.locator('#timer')).toBeVisible()
      }
      await doubleText(page)
      expect.soft(await textFits(labels)).toBe(true)
      if (route === 'settings') {
        await expect.poll(() => overlaysFit(page)).toBe(true)
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await expect(page.locator('body')).toHaveClass(/totop-on/)
        await expect.poll(() => overlaysFit(page)).toBe(true)
      }
      if (lang === 'de') {
        await labels.first().scrollIntoViewIfNeeded()
        await testInfo.attach(route + '-de-320-double-text', {body: await page.screenshot({mask:[page.locator('img,canvas,video')]}), contentType:'image/png'})
      }
      if (route === 'workout') {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        const last = page.locator('#app button:visible').last()
        await expect.poll(() => last.evaluate(el =>
          el.getBoundingClientRect().bottom <= document.querySelector('#timer').getBoundingClientRect().top + 1
        )).toBe(true)
      } else {
        const pause = page.locator('#timer .pause')
        for (let i = 0; i < 100 && !await pause.evaluate(el => el === document.activeElement); i++) {
          await page.keyboard.press('Tab')
        }
        await expect(pause).toBeFocused()
        await page.setViewportSize({ width: 390, height: 844 })
        await expect(pause).toBeFocused()
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Tab')
        await expect(pause).toBeFocused()
        await page.reload()
        await expect(page.locator('#tabbar .start .tab-resume')).toBeVisible()
        await expect(page.locator('#timer')).toBeVisible()
        await openRoute(page, '/workout')
        const rows = page.locator('[data-tour="tick"]')
        await expect(rows).toHaveCount(2)
        await expect(rows.first()).toBeChecked()
        await expect(rows.last()).not.toBeChecked()
      }
    }
  })
}
