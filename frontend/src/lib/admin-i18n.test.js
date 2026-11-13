import { afterEach, describe, expect, it } from 'vitest'
import { _setLangState } from './i18n-core.js'
import { adminT } from './admin-i18n.js'

afterEach(() => _setLangState('en', {}, null, null))

describe('admin pilot locale', () => {
  it('uses Italian only when Italian is selected and keeps the English fallback elsewhere', () => {
    _setLangState('it', {}, null, null)
    expect(adminT('Users')).toBe('Utenti')
    expect(adminT('{0} min ago', 4)).toBe('4 min fa')
    _setLangState('fr', {}, null, null)
    expect(adminT('Users')).toBe('Users')
  })

  it('preserves technical and unknown values', () => {
    _setLangState('it', {}, null, null)
    expect(adminT('COACH_DISABLED')).toBe('COACH_DISABLED')
    expect(adminT('Provider: {0}', 'fixture')).toBe('Provider: fixture')
  })
})
