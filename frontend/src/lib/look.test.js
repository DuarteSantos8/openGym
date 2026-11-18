import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { lookOf, LOOKS, DEFAULT_LOOK } from './look.js'
import { accentKey, accentValue, NEW_ACCENT, HEX_PRESETS, applyAccent } from './accent.js'
import { ACCENTS, ACCENT_INK, ACCENT_NAMES } from './format.js'

describe('Ironvane looks', () => {
  it('Bold unless Refined was picked; junk and old profiles are Bold', () => {
    expect(DEFAULT_LOOK).toBe('bold')
    expect(LOOKS).toEqual(['bold', 'refined'])
    expect(lookOf({})).toBe('bold')
    expect(lookOf(null)).toBe('bold')
    expect(lookOf({ look: 'bold' })).toBe('bold')
    expect(lookOf({ look: 'refined' })).toBe('refined')
    expect(lookOf({ look: '<script>' })).toBe('bold')
  })

  it('the Bold rules and the bundled font exist, and the font ships its licence', () => {
    const css = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    expect(css).toMatch(/:root\[data-look="bold"\]\{/)
    for (const m of css.matchAll(/url\('\.\/(assets\/fonts\/[^']+)'\)/g))
      expect(fs.existsSync(new URL('../' + m[1], import.meta.url)), m[1]).toBe(true)
    expect(fs.readFileSync(new URL('../assets/fonts/SpaceGrotesk-OFL.txt', import.meta.url), 'utf8')).toMatch(/SIL Open Font License/)
  })
})

describe('Ironvane orange accent', () => {
  it('is what a new profile starts on, named and inked', () => {
    expect(NEW_ACCENT).toBe('ironvane')
    expect(ACCENTS.ironvane).toBe('#ff6b2c')
    expect(ACCENT_INK.ironvane).toBe('#000000')
    expect(ACCENT_NAMES.ironvane).toBe('Ironvane orange')
  })

  it('is drawn through the own-colour path: a hex value, contrast-checked per theme', () => {
    expect(HEX_PRESETS.has('ironvane')).toBe(true)
    expect(accentKey({ accent: 'ironvane' })).toBe('ironvane')
    expect(accentValue({ accent: 'ironvane' })).toBe('#ff6b2c')
    const props = {}
    const el = { dataset: {}, style: { setProperty: (k, v) => { props[k] = v }, removeProperty: k => { delete props[k] } } }
    applyAccent(el, accentValue({ accent: 'ironvane' }), 'light')
    expect(el.dataset.accent).toBe('custom')
    expect(props['--acc']).toBeTruthy()
    expect(props['--acc-ink']).not.toBe('#ff6b2c')   // darkened to be read on white
  })
})
