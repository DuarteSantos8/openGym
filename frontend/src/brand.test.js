import { describe, it, expect, afterEach } from 'vitest'
import { BRAND, LINKS, brandText } from './brand.js'
import { t, tn, _setLangState } from './lib/i18n-core.js'

describe('brand', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  it('swaps upstream\'s name for the brand name in English source strings', () => {
    expect(t('Update to openGym v{0}', '1.2.3')).toBe(`Update to ${BRAND.name} v1.2.3`)
  })

  it('does it for a locale pack without the pack being edited', () => {
    _setLangState('de', { 'Welcome to openGym': 'Willkommen bei openGym' }, null, null)
    expect(t('Welcome to openGym')).toBe(`Willkommen bei ${BRAND.name}`)
  })

  it('does it for plural forms', () => {
    expect(tn('{0} openGym set', '{0} openGym sets', 2)).toBe(`2 ${BRAND.name} sets`)
  })

  it('leaves a name that arrives as an argument alone, so the upstream credit survives', () => {
    expect(t('Built on {0} by {1}.', 'openGym', 'Duarte Santos')).toBe('Built on openGym by Duarte Santos.')
  })

  it('picks the article for the new name', () => {
    expect(t('That file isn’t an openGym backup.')).toBe(`That file isn’t a ${BRAND.name} backup.`)
  })

  it('leaves a path or URL alone: Documents/openGym is a real folder on the phone', () => {
    expect(t('openGym copies go to Documents/openGym again.')).toBe(`${BRAND.name} copies go to Documents/openGym again.`)
  })

  it('makes a possessive without doubling the s, straight or curly apostrophe', () => {
    expect(brandText('an answer that is not openGym\'s')).toBe('an answer that is not Gains\'')
    expect(brandText('Something other than openGym’s health')).toBe('Something other than Gains’ health')
  })

  it('handles a name at the start of a sentence and "An openGym" at the start', () => {
    expect(brandText('openGym is free.')).toBe('Gains is free.')
    expect(brandText('An openGym backup.')).toBe('A Gains backup.')
    expect(brandText('Is this an openGym server?')).toBe('Is this a Gains server?')
  })

  it('answers the same for a repeated string (cached)', () => {
    expect(brandText('Use openGym')).toBe(brandText('Use openGym'))
  })

  it('keeps "openGym" where it is the upstream credit or the licence notice', () => {
    expect(t('Built on {0} by {1}.', 'openGym', 'Duarte Santos')).toBe('Built on openGym by Duarte Santos.')
    expect(LINKS.copyright[0]).toContain('openGym')
    expect(LINKS.upstream.name).toBe('openGym')
    expect(LINKS.upstream.url).toContain('/openGym')
  })

  it('passes non-strings through', () => {
    expect(brandText(undefined)).toBeUndefined()
  })
})
