import { expect, it } from 'vitest'
import { pageMotion } from './page-motion.js'

it('slides a settings page in from the right and its parent back in from the left', () => {
  expect(pageMotion('/settings', '/settings/workout', 'PUSH')).toBe('push')
  expect(pageMotion('/settings/workout', '/settings', 'POP')).toBe('pop')
})

it('keeps the fade for tabs, fresh loads, siblings and back into a deeper page', () => {
  expect(pageMotion(null, '/settings', 'POP')).toBe('fade')
  expect(pageMotion('/', '/settings', 'PUSH')).toBe('fade')
  expect(pageMotion('/settings/workout', '/settings/data', 'PUSH')).toBe('fade')
  expect(pageMotion('/settings', '/settings/workout', 'POP')).toBe('fade')
  expect(pageMotion('/settings/account', '/settings', 'PUSH')).toBe('fade')
  expect(pageMotion('/settingsx', '/settings', 'POP')).toBe('fade')
})

// Settings → Reminders on Android in the light theme (Discord, 1.4.3): the page that slid in kept
// its slide's background and edge shadow for as long as it stayed open, a shadowed box inset by
// #app's padding and only as tall as its rows. The page itself keeps its class (`vpush`) after
// the slide, so whatever only belongs to the slide lives in the keyframes, which end with it.
it('a page that slid in keeps no background or shadow once the slide is over', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]*\.page\.v(?:push|pop)[^{}]*)\{([^{}]*)\}/g)]
  expect(rules.length).toBeGreaterThan(0)
  for (const [, selector, body] of rules) {
    expect(body, selector.trim()).not.toMatch(/(^|;)\s*(background|box-shadow)/)
  }
  // Not even while it slides (TestFlight 1.4.4 build 45): the page sits inside #app's side padding,
  // so a background or shadow on it showed as an inset box for the length of the slide.
  for (const name of ['viewpush', 'viewpush-rtl']) {
    const frames = css.match(new RegExp('@keyframes ' + name + '\\{(.*?\\})\\}'))?.[1] || ''
    expect(frames, name).toMatch(/transform/)
    expect(frames, name).not.toMatch(/box-shadow|background/)
  }
})
