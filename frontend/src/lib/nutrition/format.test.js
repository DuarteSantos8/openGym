import { afterEach, expect, test } from 'vitest'
import { _setLangState } from '../i18n-core.js'
import { formatNutrition } from './format.js'
afterEach(() => _setLangState('en', {}, null, null))
test('nutrition uses the UI locale and retains three places without padding whole amounts', () => {
  _setLangState('en', {}, null, null)
  expect(formatNutrition(0.024)).toBe('0.024')
  expect(formatNutrition(300)).toBe('300')
  _setLangState('de', {}, null, null)
  expect(formatNutrition(0.024)).toBe('0,024')
  expect(formatNutrition(2.4)).toBe('2,4')
})
