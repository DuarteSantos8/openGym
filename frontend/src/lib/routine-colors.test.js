import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ROUTINE_COLORS, colorOf, tileStyle, nextColor } from './routine-colors.js'

describe('routine colours', () => {
  it('colorOf accepts only a known token', () => {
    expect(colorOf({ color: 'blue' })).toBe('blue')
    expect(colorOf({ color: 'chartreuse' })).toBeNull()
    expect(colorOf({})).toBeNull()
  })
  it('tileStyle sets the tint and its ink, or nothing', () => {
    expect(tileStyle({ color: 'teal' })).toEqual({ '--tint': 'var(--teal)', '--on-tint': 'var(--on-teal)' })
    expect(tileStyle({})).toBeUndefined()
  })
  it('nextColor takes the first unused colour, else the least used', () => {
    expect(nextColor([{ color: 'blue' }, { color: 'indigo' }])).toBe('purple')
    expect(nextColor(ROUTINE_COLORS.map((c) => ({ color: c })))).toBe('blue')
    expect(nextColor([...ROUTINE_COLORS, 'blue'].map((c) => ({ color: c })))).toBe('indigo')
  })
})

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const from = (start, end) => { const i = css.indexOf(start); return css.slice(i, css.indexOf(end, i + start.length)) }
const vars = (text, prefix) => Object.fromEntries(
  [...text.matchAll(new RegExp(`--${prefix}(${ROUTINE_COLORS.join('|')}):\\s*(#[0-9a-f]{3,6})`, 'gi'))].map((m) => [m[1], m[2]]),
)
const rgb = (h) => (h.length === 4 ? [...h.slice(1)].map((x) => x + x) : [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)]).map((x) => parseInt(x, 16) / 255)
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

const ink = from('/* Routine tile ink', '/* The flame:')
const at = (text, start, end) => text.slice(text.indexOf(start), end ? text.indexOf(end) : undefined)
const hc = at(ink, '@media (prefers-contrast: more)')
const darkTiles = vars(from(':root {', ':root[data-theme="light"] {'), '')
const lightTiles = { ...darkTiles, ...vars(from(':root[data-theme="light"] {', ':root[data-accent="brand"]'), '') }
const darkInk = vars(at(ink, ':root{', ':root[data-theme="light"]{--on'), 'on-')
const lightInk = { ...darkInk, ...vars(at(ink, ':root[data-theme="light"]{--on', '@media'), 'on-') }
const palettes = {
  dark: [darkTiles, darkInk],
  light: [lightTiles, lightInk],
  'contrast dark': [{ ...darkTiles, ...vars(from('@media (prefers-contrast: more){', ':root:not([data-theme="light"]){ --on-acc'), '') },
    { ...darkInk, ...vars(at(hc, ':root:not([data-theme="light"])', ':root[data-theme="light"]'), 'on-') }],
  'contrast light': [{ ...lightTiles, ...vars(from(':root[data-theme="light"]{\n    --blue', '--label-2'), '') },
    { ...lightInk, ...vars(at(hc, ':root[data-theme="light"]'), 'on-') }],
}

describe('tile ink', () => {
  for (const [name, [tiles, inks]] of Object.entries(palettes)) {
    it(`reaches 4.5:1 on every colour, ${name}`, () => {
      for (const c of ROUTINE_COLORS) {
        expect(tiles[c], `${c} tile`).toBeTruthy()
        expect(inks[c], `${c} ink`).toBeTruthy()
        expect(contrast(tiles[c], inks[c]), `${c} on ${name}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
