// The text inks the 1.4.5 design review settled on, measured from index.css: every grey that
// carries words, the accent as text (--acc-ink) and the gold as text (--gold-ink) reach 4.5:1 on
// both the page (--bg) and a card (--surface), in both themes. The tertiary --label-3 is left out
// on purpose: it is for placeholders, disabled controls and hairline icons, not for reading.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = sel => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`))?.[1] || ''
}
const token = (decls, name) => decls.match(new RegExp(`${name}:\\s*([^;}]+)`))?.[1]?.trim()
const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) }
const parse = v => v.startsWith('#') ? { rgb: hex(v), a: 1 } : (p => ({ rgb: p.slice(0, 3), a: p[3] }))(v.match(/rgba\(([^)]+)\)/)[1].split(',').map(Number))
const lum = rgb => { const l = rgb.map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const over = ({ rgb, a }, bg) => rgb.map((c, i) => c * a + bg[i] * (1 - a))
const on = (ink, bg) => ratio(over(parse(ink), bg), bg)

const dark = rule(':root'), light = rule(':root[data-theme="light"]')
const grounds = decls => [hex(token(decls, '--bg')), hex(token(decls, '--surface'))]

describe('design review 1.4.5: text inks', () => {
  it('secondary text reads at 4.5:1 in both themes', () => {
    for (const decls of [dark, light]) for (const g of grounds(decls)) expect(on(token(decls, '--label-2'), g)).toBeGreaterThanOrEqual(4.5)
  })
  it('.dim text uses --label-dim, which reads at 4.5:1', () => {
    expect(rule('.dim')).toMatch(/color:var\(--label-dim\)/)
    for (const g of grounds(dark)) expect(on(token(dark, '--label-dim'), g)).toBeGreaterThanOrEqual(4.5)
    expect(token(light, '--label-dim')).toBe('var(--label-2)')
  })
  it('every preset accent as text reaches 4.5:1 in the light theme', () => {
    const inks = [...css.matchAll(/:root\[data-theme="light"\]\[data-accent="(\w+)"\]\s*\{\s*--acc-ink:(#\w+)/g)]
    expect(inks.map(m => m[1]).sort()).toEqual(['gold', 'lime', 'orange', 'pink', 'red', 'sky', 'teal', 'violet'])
    for (const [, name, ink] of inks) for (const g of grounds(light)) expect(on(ink, g), name).toBeGreaterThanOrEqual(4.5)
  })
  it('the gold ink reaches 4.5:1 in the light theme', () => {
    const gold = css.match(/--gold-ink:(#[0-9a-f]{6})/i)[1]
    for (const g of grounds(light)) expect(on(gold, g)).toBeGreaterThanOrEqual(4.5)
  })
})

// The shared rules the review fixed, each one a bug that showed on several screens.
describe('design review 1.4.5: shared rules', () => {
  it('raises the chosen segment in the dark theme (lighter than its track)', () => {
    const track = rule(':root:not([data-theme="light"]) .seg'), thumb = rule(':root:not([data-theme="light"]) .seg-sel')
    expect(track).toMatch(/background:rgba\(118,118,128,\.24\)/)
    expect(thumb).toMatch(/background:#636366/)
  })
  it('styles a subtitle and the small line over a title wherever they sit', () => {
    expect(rule('.ss')).toMatch(/color:var\(--label-2\)/)
    expect(rule('.lbl2')).toMatch(/color:var\(--label-2\)/)
    expect(rule('.lbl2')).not.toMatch(/uppercase/)
  })
  it('lets .dim win over the accent on a quiet text button', () => {
    expect(css).toMatch(/\.btn\.ghost\.dim,\.btn\.plain\.dim\{color:var\(--label-2\)\}/)
  })
  it('uses no undefined --dim', () => {
    expect(css).not.toMatch(/var\(--dim\)/)
  })
  it('keeps the small labels in sentence case', () => {
    for (const sel of ['.wday .lbl', '.sethead', '.cal-h']) expect(rule(sel), sel).not.toMatch(/uppercase/)
  })
})

// The 1.4.5 features pass: the new features' rules live in index.css (insights.css folded in) and
// follow the redesign's tokens.
describe('1.4.5 features pass', () => {
  const lightInk = name => css.match(new RegExp(`:root\\[data-theme="light"\\]\\{[^}]*${name}:(#[0-9a-f]{6})`, 'i'))?.[1]
  it('the status inks reach 4.5:1 in the light theme and are the system colours in the dark', () => {
    for (const name of ['--green-ink', '--orange-ink']) {
      const ink = lightInk(name)
      expect(ink, name).toBeTruthy()
      for (const g of grounds(light)) expect(on(ink, g), name).toBeGreaterThanOrEqual(4.5)
    }
    expect(css).toMatch(/--green-ink:var\(--green\); --orange-ink:var\(--orange\)/)
  })
  it('no separate insights stylesheet any more', async () => {
    const { existsSync } = await import('node:fs')
    expect(existsSync(resolve(process.cwd(), 'src/insights.css'))).toBe(false)
    expect(readFileSync(resolve(process.cwd(), 'src/main.jsx'), 'utf8')).not.toMatch(/insights\.css/)
  })
  it('set trends, weekly sets and levels colour text with the inks, never the bare system colours', () => {
    expect(rule('.settrend.up')).toMatch(/var\(--green-ink\)/)
    expect(rule('.settrend.down')).toMatch(/var\(--orange-ink\)/)
    expect(rule('.wsets-row.in .wsets-st')).toMatch(/var\(--green-ink\)/)
    expect(rule('.wsets-row.above .wsets-st')).toMatch(/var\(--orange-ink\)/)
    expect(rule('.wsets-st')).toMatch(/var\(--label-2\)/)
    expect(rule('.slevel-about')).toMatch(/var\(--acc-ink\)/)
    expect(rule('.wsets-home .icn:first-child')).toMatch(/var\(--green-ink\)/)
    const feature = [...css.matchAll(/(\.(?:settrend|setnote|wsets|slevel|recap)[^{]*)\{([^}]*)\}/g)]
    expect(feature.length).toBeGreaterThan(20)
    for (const [, sel, decls] of feature) expect(decls, sel).not.toMatch(/(^|;)color:var\(--(green|orange|blue|acc)\)/)
  })
  it('the trend chip floats on a raised surface and is no smaller than 11px', () => {
    const chip = rule('.setrow .n .settrend,.setrow-side>.n .settrend')
    expect(chip).toMatch(/background:var\(--surface-raised\)/)
    expect(chip).toMatch(/var\(--raised-line\)/)
    expect(Number(chip.match(/font-size:(\d+)px/)[1])).toBeGreaterThanOrEqual(11)
  })
  it('rows divide between themselves, not above the first (no :first-of-type that never matched)', () => {
    expect(css).not.toMatch(/\.(wsets|slevel)-row:first-of-type/)
    for (const sel of ['.wsets-row+.wsets-row', '.slevel-row+.slevel-row', '.wsets-edit+.wsets-edit']) expect(rule(sel), sel).toMatch(/border-top:var\(--hair\) solid var\(--sep\)/)
  })
  it('tapped lines are finger-sized and press like rows', () => {
    expect(rule('.setnote-line')).toMatch(/min-height:32px/)
    expect(rule('.setnote-line::before')).toMatch(/inset:-6px 0/)
    expect(rule('.setnote-line:active')).toMatch(/var\(--press-fill\)/)
    expect(rule('.wsets-home')).toMatch(/min-height:44px/)
    expect(rule('.wsets-home:active')).toMatch(/var\(--press-fill\)/)
  })
  it('the weekly-sets band keeps a plain colour before its color-mix, in both themes', () => {
    expect(rule('.wsets-band')).toMatch(/background:rgba\([^)]+\);background:color-mix/)
    expect(rule(':root[data-theme="light"] .wsets-band')).toMatch(/background:rgba\([^)]+\);background:color-mix/)
  })
  it('the features use text roles and logical properties', () => {
    const feature = [...css.matchAll(/(\.(?:settrend|setnote|wsets|slevel|recap|about-|wkleft)[^{]*)\{([^}]*)\}/g)]
    for (const [sel, , decls] of feature.map(m => [m[1], null, m[2]])) {
      expect(decls, sel).not.toMatch(/(margin|padding)-(left|right)|(^|;)(left|right):/)
      // px font sizes only for a glyph in a fixed box (the chip) or a display figure (a recap tile)
      if (!/settrend|recap-v/.test(sel)) expect(decls, sel).not.toMatch(/font-size:\d+px/)
    }
  })
})
