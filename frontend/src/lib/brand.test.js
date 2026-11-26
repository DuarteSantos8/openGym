import { describe, it, expect } from 'vitest'
import { brandText, APP_NAME, KEEP_KEYS, keepsName } from './brand.js'
import { t, tn, tnf, _setLangState } from './i18n-core.js'

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

describe('brand: names that stay openGym in every language, and the person’s own words', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true })

  it('every kept key keeps openGym in every pack', () => {
    for (const [file, mod] of Object.entries(packs)) {
      _setLangState(file.match(/([\w-]+)\.js$/)[1], mod.default)
      for (const k of KEEP_KEYS) {
        const v = mod.default[k]
        if (typeof v === 'string' && v.includes('openGym')) expect(t(k, '9.9.9'), file + ': ' + k).toContain('openGym')
      }
      const offline = Object.keys(mod.default).filter(k => keepsName(k))
      for (const k of offline) if (String(mod.default[k]).includes('openGym')) expect(t(k), file + ': ' + k).not.toContain(APP_NAME)
    }
    _setLangState('en', {})
  })

  it('the credit and the watch apps keep their name in French too', () => {
    _setLangState('fr', packs['../locales/fr.js'].default)
    expect(t('Based on openGym')).toContain('openGym')
    expect(t('Get openGym for Garmin')).not.toContain(APP_NAME)
    expect(t('Get openGym for Wear OS')).not.toContain(APP_NAME)
    _setLangState('en', {})
  })

  it('an argument that says openGym is the person’s own word and stays as typed', () => {
    _setLangState('fr', { 'Back to {0}': 'Retour à {0}', '{0} set': '{0} série', '{0} sets': { one: '{0} série openGym', other: '{0} séries openGym' } })
    expect(t('Back to {0}', 'my-openGym-notes')).toBe('Retour à my-openGym-notes')
    expect(tn('{0} set', '{0} sets', 2, 'openGym')).toBe('2 séries Ironvane')
    expect(tnf('{0} set', '{0} sets', 2, 'openGym')).toBe('openGym séries Ironvane')
    _setLangState('en', {})
    expect(t('Your backups go to “{0}”.', 'openGym')).toBe('Your backups go to “openGym”.')
  })
})
