import { describe, it, expect } from 'vitest'
import { brandText, APP_NAME, KEEP_KEYS } from './brand.js'
import { t, _setLangState } from './i18n-core.js'

describe('brand: the app reads as Ironvane, data and upstream names stay openGym', () => {
  it('renames the app wherever people read its name', () => {
    expect(APP_NAME).toBe('Ironvane')
    expect(brandText('Back to openGym')).toBe('Back to Ironvane')
    expect(brandText('Here’s my PR on openGym 💪')).toBe('Here’s my PR on Ironvane 💪')
    expect(brandText('openGym’s battery use')).toBe('Ironvane’s battery use')
    expect(brandText('Ask openGym Coach')).toBe('Ask Ironvane Coach')
    expect(brandText('openGym-Grün und openGym.')).toBe('Ironvane-Grün und Ironvane.')
  })

  it('keeps upstream apps, the licensed media, paths, credits and identifiers', () => {
    for (const s of ['openGym Offline has no internet permission', 'Get openGym for Garmin', 'Get openGym for Wear OS',
      'it is not an openGym animation', 'DOCUMENTS/openGym/', 'Documents/openGym', 'Based on openGym', 'based on openGym', 'openGymSheet'])
      expect(brandText(s), s).toBe(s)
    expect(brandText(42)).toBe(42)
    expect(brandText(undefined)).toBe(undefined)
  })

  it('t() brands every language on the way out, except whole keys kept on purpose', () => {
    _setLangState('fr', { 'Back to openGym': 'Retour à openGym', 'openGym green': 'Vert openGym' })
    expect(t('Back to openGym')).toBe('Retour à Ironvane')
    expect(KEEP_KEYS.has('openGym green')).toBe(true)
    expect(t('openGym green')).toBe('Vert openGym')
    _setLangState('en', {})
    expect(t('Install the openGym app on your phone to use this.')).toBe('Install the Ironvane app on your phone to use this.')
  })
})

describe('brand: what still points at openGym keeps its name', () => {
  it('donations, store ratings and the updater are openGym’s, and say so', () => {
    for (const k of ['Support openGym', 'Rate openGym on the App Store', 'Rate openGym on Google Play', 'Update to openGym v{0}'])
      expect(t(k, '9.9.9'), k).toContain('openGym')
  })
})
