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
