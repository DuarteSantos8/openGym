// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contrast, luminance } from './accent.js'
import {
  STEPS, toneOfStep, cleanPalette, toneIn, dynamicLook, dynamicAccentVars, applySurfaces, SURFACE_VARS,
  dynamicChosen, setDynamicChosen, refreshPalette, activePalette, dynamicSnapshot, subscribeDynamic,
  deviceAccentValue, resetDynamicForTests,
} from './dynamic-color.js'

// Material's baseline tonal palettes (the purple seed), in the plugin's order: system_*_0 (tone 100)
// to system_*_1000 (tone 0). What a phone with that wallpaper hands over.
const PALETTE = {
  available: true,
  accent1: ['#ffffff', '#fffbfe', '#f6edff', '#eaddff', '#d0bcff', '#b69df8', '#9a82db', '#7f67be', '#6750a4', '#4f378b', '#381e72', '#21005d', '#000000'],
  neutral1: ['#ffffff', '#fffbfe', '#f4eff4', '#e6e1e5', '#c9c5ca', '#aeaaae', '#939094', '#787579', '#605d62', '#484649', '#313033', '#1c1b1f', '#000000'],
  neutral2: ['#ffffff', '#fffbfe', '#f5eefa', '#e7e0ec', '#cac4d0', '#aea9b4', '#938f99', '#79747e', '#605d66', '#49454f', '#322f37', '#1d1a22', '#000000'],
}

describe('toneOfStep', () => {
  it('maps the system steps to Material tones', () => {
    expect(STEPS.map(toneOfStep)).toEqual([100, 99, 95, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0])
  })
})

describe('cleanPalette', () => {
  it('keeps a full answer and lowercases it', () => {
    const p = cleanPalette({ ...PALETTE, accent1: PALETTE.accent1.map(c => c.toUpperCase()) })
    expect(p.accent1).toEqual(PALETTE.accent1)
    expect(Object.keys(p)).toEqual(['accent1', 'neutral1', 'neutral2'])
  })
  it('says no to anything short, malformed or unavailable', () => {
    expect(cleanPalette(null)).toBe(null)
    expect(cleanPalette({ available: false })).toBe(null)
    expect(cleanPalette({ ...PALETTE, available: undefined })).toBe(null)
    expect(cleanPalette({ ...PALETTE, neutral2: PALETTE.neutral2.slice(1) })).toBe(null)
    expect(cleanPalette({ ...PALETTE, accent1: [...PALETTE.accent1.slice(1), 'red;}'] })).toBe(null)
  })
})

describe('toneIn', () => {
  const grey = STEPS.map(s => { const v = Math.round(toneOfStep(s) * 2.55).toString(16).padStart(2, '0'); return '#' + v + v + v })
  it('returns the system tone where there is one', () => {
    expect(toneIn(grey, 100)).toBe('#ffffff')
    expect(toneIn(grey, 50)).toBe(grey[7])
    expect(toneIn(grey, 0)).toBe('#000000')
  })
  it('mixes between neighbours and clamps the ends', () => {
    expect(toneIn(grey, 5)).toBe('#0d0d0d')
    expect(toneIn(grey, 120)).toBe('#ffffff')
    expect(toneIn(grey, -3)).toBe('#000000')
  })
})

describe('dynamicLook', () => {
  it('keeps the dark theme nearly black, with cards a step lighter than the page', () => {
    const { surfaces, accent } = dynamicLook(PALETTE, 'dark')
    expect(Object.keys(surfaces)).toEqual(SURFACE_VARS)
    expect(luminance(surfaces['--bg'])).toBeLessThan(0.01)
    expect(luminance(surfaces['--surface'])).toBeGreaterThan(luminance(surfaces['--bg']))
    expect(luminance(surfaces['--surface-2'])).toBeGreaterThan(luminance(surfaces['--surface']))
    expect(luminance(surfaces['--surface-3'])).toBeGreaterThan(luminance(surfaces['--surface-2']))
    expect(contrast(accent, surfaces['--surface'])).toBeGreaterThan(3)
  })
  it('keeps light cards brighter than the page and the accent dark enough to read', () => {
    const { surfaces, accent } = dynamicLook(PALETTE, 'light')
    expect(luminance(surfaces['--surface'])).toBeGreaterThan(luminance(surfaces['--bg']))
    expect(luminance(surfaces['--surface-2'])).toBeLessThan(luminance(surfaces['--surface']))
    expect(contrast(accent, surfaces['--bg'])).toBeGreaterThan(3)
  })
  it('is null without a palette', () => {
    expect(dynamicLook(null, 'dark')).toBe(null)
    expect(dynamicAccentVars(null, 'dark')).toBe(null)
  })
  it('gives the accent the same variables as a colour of the user’s own', () => {
    expect(Object.keys(dynamicAccentVars(PALETTE, 'light'))).toEqual(['--acc', '--acc-2', '--on-acc', '--acc-ink', '--knob-ring'])
  })
})

describe('applySurfaces', () => {
  it('sets the tokens and takes them off again', () => {
    const el = document.createElement('div')
    applySurfaces(el, dynamicLook(PALETTE, 'dark').surfaces)
    for (const k of SURFACE_VARS) expect(el.style.getPropertyValue(k)).toMatch(/^#|^rgb/)
    applySurfaces(el, null)
    for (const k of SURFACE_VARS) expect(el.style.getPropertyValue(k)).toBe('')
  })
})

describe('the device choice and the palette store', () => {
  beforeEach(() => { localStorage.clear(); resetDynamicForTests() })
  afterEach(() => { localStorage.clear(); resetDynamicForTests() })

  it('is off until chosen, and kept in this device’s storage', () => {
    expect(dynamicChosen()).toBe(false)
    setDynamicChosen(true)
    expect(dynamicChosen()).toBe(true)
    expect(dynamicSnapshot().chosen).toBe(true)
    setDynamicChosen(false)
    expect(localStorage.getItem('og_dynamic_color')).toBe(null)
  })

  it('draws with the palette only when it is chosen and the phone has one', async () => {
    setDynamicChosen(true)
    expect(activePalette()).toBe(null)
    await refreshPalette(async () => PALETTE)
    expect(activePalette().accent1).toEqual(PALETTE.accent1)
    setDynamicChosen(false)
    expect(activePalette()).toBe(null)
  })

  it('tells listeners about a new palette, not about the same one again', async () => {
    const fn = vi.fn()
    const off = subscribeDynamic(fn)
    await refreshPalette(async () => PALETTE)
    await refreshPalette(async () => ({ ...PALETTE }))
    expect(fn).toHaveBeenCalledTimes(1)
    await refreshPalette(async () => { throw new Error('no plugin') })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(dynamicSnapshot().palette).toBe(null)
    off()
  })

  it('hands the native countdown the wallpaper accent while it is used', async () => {
    const S = { accent: 'sky' }
    expect(deviceAccentValue(S)).toBe('sky')
    await refreshPalette(async () => PALETTE)
    expect(deviceAccentValue(S)).toBe('sky')
    setDynamicChosen(true)
    expect(deviceAccentValue(S)).toBe(dynamicLook(PALETTE, 'dark').accent)
  })
})
