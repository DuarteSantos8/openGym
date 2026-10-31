// The text inks the 1.4.5 design review settled on, measured from index.css: every grey that
// carries words, the accent as text (--acc-ink) and the gold as text (--gold-ink) reach 4.5:1 on
// both the page (--bg) and a card (--surface), in both themes. The tertiary --label-3 is left out
// on purpose: it is for placeholders, disabled controls and hairline icons, not for reading.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
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
    // the weekly sets moved into the Muscles card's bars (stats redesign): the fill in the inks
    expect(rule('.sbar-row.in .sbar-f')).toMatch(/var\(--green-ink\)/)
    expect(rule('.sbar-row.above .sbar-f')).toMatch(/var\(--orange-ink\)/)
    expect(rule('.sbar-f')).toMatch(/var\(--label-2\)/)
    expect(rule('.slevel-about')).toMatch(/var\(--acc-ink\)/)
    expect(rule('.wsets-home .icn:first-child')).toMatch(/var\(--green-ink\)/)
    const feature = [...css.matchAll(/(\.(?:settrend|setnote|wsets|slevel|recap|sbar|slegend|sstack)[^{]*)\{([^}]*)\}/g)]
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
    for (const sel of ['.sbar-row+.sbar-row', '.slevel-row+.slevel-row', '.wsets-edit+.wsets-edit']) expect(rule(sel), sel).toMatch(/border-top:var\(--hair\) solid var\(--sep\)/)
  })
  it('tapped lines are finger-sized and press like rows', () => {
    expect(rule('.setnote-line')).toMatch(/min-height:32px/)
    expect(rule('.setnote-line::before')).toMatch(/inset:-6px 0/)
    expect(rule('.setnote-line:active')).toMatch(/var\(--press-fill\)/)
    expect(rule('.wsets-home')).toMatch(/min-height:44px/)
    expect(rule('.wsets-home:active')).toMatch(/var\(--press-fill\)/)
  })
  it('the weekly-sets band keeps a plain colour before its color-mix, in both themes', () => {
    expect(rule('.sbar-band')).toMatch(/background:rgba\([^)]+\);background:color-mix/)
    expect(rule(':root[data-theme="light"] .sbar-band')).toMatch(/background:rgba\([^)]+\);background:color-mix/)
  })
  it('the features use text roles and logical properties', () => {
    const feature = [...css.matchAll(/(\.(?:settrend|setnote|wsets|slevel|recap|about-|wkleft)[^{]*)\{([^}]*)\}/g)]
    for (const [sel, , decls] of feature.map(m => [m[1], null, m[2]])) {
      expect(decls, sel).not.toMatch(/(margin|padding)-(left|right)|(^|;)(left|right):/)
      // px font sizes only for a glyph in a fixed box (the chip) or a display figure (a recap tile)
      if (!/settrend|recap-v/.test(sel)) expect(decls, sel).not.toMatch(/font-size:\d+px/)
    }
  })
  it('a ticked set fades its parts, not the number that carries the arrow', () => {
    expect(rule('.setrow.done')).toBe('')
    expect(rule('.setrow.done>*:not(.n)')).toMatch(/opacity:\.45/)
    expect(rule('.setrow.done .n')).toMatch(/background:var\(--acc\);color:var\(--on-acc\);\s*background:color-mix/)
  })
})

// The Integrations pass (REVIEW.md, "## Integrations pass"): Settings → Integrations and its sheets,
// built before the redesign, on its tokens.
describe('Integrations pass', () => {
  const intg = [...css.matchAll(/(\.intg-[^{]*)\{([^}]*)\}/g)]
  it('has its rules', () => expect(intg.length).toBeGreaterThan(25))
  it('pills and the problem line use the inks, with a plain colour before each color-mix', () => {
    expect(rule('.intg-pill.connected')).toMatch(/background:rgba\([^)]+\);background:color-mix\([^;]+;color:var\(--green-ink\)/)
    expect(rule('.intg-pill.attention')).toMatch(/background:rgba\([^)]+\);background:color-mix\([^;]+;color:var\(--orange-ink\)/)
    expect(rule('.intg-problem')).toMatch(/color:var\(--red-ink\)/)
    // words never in the bare system colours; a glyph (3:1 is its bar) may match its red row's text
    for (const [sel, decls] of intg.map(m => [m[1], m[2]])) if (!/-i$/.test(sel.trim())) expect(decls, sel).not.toMatch(/(^|;)color:var\(--(green|orange|red|acc)\)/)
  })
  it('the red ink reaches 4.5:1 in the light theme and is the system red in the dark', () => {
    const ink = css.match(/:root\[data-theme="light"\]\{[^}]*--red-ink:(#[0-9a-f]{6})/i)[1]
    for (const g of grounds(light)) expect(on(ink, g)).toBeGreaterThanOrEqual(4.5)
    expect(css).toMatch(/--red-ink:var\(--red\)/)
  })
  it('text roles, logical properties, the row press tier', () => {
    for (const [sel, decls] of intg.map(m => [m[1], m[2]])) {
      expect(decls, sel).not.toMatch(/(margin|padding)-(left|right)|(^|;)(left|right):/)
      // px only for a glyph's size
      if (!/\.icn|-i\b|-i\{|log-i/.test(sel)) expect(decls, sel).not.toMatch(/font-size:\d+px/)
    }
    expect(rule('.intg-open:active')).toMatch(/var\(--press-fill\)/)
    expect(rule('.intg-h .icn')).toMatch(/var\(--acc-ink\)/)
  })
})

// Card dismiss pass (1.4.4): a card or row that opens something is never a button holding another
// control (the recap's × inside a role=button card was the case in point). Every element spread with
// tappable() is walked in the JSX source, and must hold no control: no <button>, link, field, nested
// tappable, CardHead action button, or a component that renders one. A card that needs a control of
// its own uses the stretched primary instead (.tap-host + .tap-main, CardHead `open`).
describe('Card dismiss pass', () => {
  const SRC = resolve(process.cwd(), 'src')
  const files = (dir => { const out = []; const walk = d => readdirSync(d).forEach(f => { const p = resolve(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.jsx$/.test(f) && !/\.test\./.test(f)) out.push(p) }); walk(dir); return out })(SRC)
  // The end of the tag that opens at `i` (braces and quoted strings skipped), and whether it closes itself.
  const tagEnd = (s, i) => {
    let depth = 0
    for (let k = i + 1; k < s.length; k++) {
      const c = s[k]
      if (c === '"' || c === "'" || c === '`') { k = s.indexOf(c, k + 1); continue }
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) return { end: k, self: s[k - 1] === '/' }
    }
    return { end: s.length, self: true }
  }
  // Every tappable() element: its file, line, tag name and inner JSX.
  const tappables = files.flatMap(file => {
    const s = readFileSync(file, 'utf8'), out = []
    for (const m of s.matchAll(/\{\.\.\.tappable\(/g)) {
      let k = m.index, depth = 0
      for (; k > 0; k--) {   // back to the '<' that opens this tag, outside any attribute's braces
        if (s[k] === '}') depth++
        else if (s[k] === '{') depth--
        else if (s[k] === '<' && depth <= 0 && /[A-Za-z]/.test(s[k + 1])) break
      }
      const tag = s.slice(k + 1).match(/^[\w.]+/)[0]
      const open = tagEnd(s, k)
      const at = `${file.slice(SRC.length + 1)}:${s.slice(0, k).split('\n').length}`
      if (open.self) { out.push({ at, tag, inner: '' }); continue }
      let level = 1, p = open.end + 1, inner = ''
      const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g')
      re.lastIndex = p
      for (let hit; (hit = re.exec(s));) {
        if (hit[0].startsWith('</')) { if (--level === 0) { inner = s.slice(p, hit.index); break } }
        else if (!tagEnd(s, hit.index).self) level++
      }
      out.push({ at, tag, inner })
    }
    return out
  })
  const CONTROL = /<(button|a|input|select|textarea|Button|Segmented|Toggle|Switch|Stepper|WeeklySetsHomeLine|StreakParty|PartyBanner)[\s>/]|tappable\(|\bopen=\{\{/
  it('finds the tappable rows and cards it guards', () => expect(tappables.length).toBeGreaterThan(20))
  it('no tappable card or row holds a control of its own', () => {
    expect(tappables.filter(x => CONTROL.test(x.inner)).map(x => x.at)).toEqual([])
  })
  it('the cards and rows that hold a control use the stretched primary', () => {
    const src = f => readFileSync(resolve(SRC, f), 'utf8')
    expect(src('components/Recap.jsx')).toMatch(/className="card tap-host recap-card"[\s\S]*open=\{\{ onClick: \(\) => recapSheet\(r\)/)
    expect(src('views/Home.jsx')).toMatch(/className="card tap-host streak-card"/)
    expect(src('views/Home.jsx')).toMatch(/className="card tap-host checkin-card"/)
    for (const f of ['views/Library.jsx', 'components/MuscleExplorer.jsx', 'sheets.jsx', 'views/RoutineEdit.jsx']) expect(src(f), f).toMatch(/className="grow item-open tap-main"/)
    expect(src('components/CardHead.jsx')).toMatch(/className="card-head-main tap-main"/)
    // with nothing nested, no control has to stop its click from reaching a card any more
    for (const f of ['components/Recap.jsx', 'components/WeeklySets.jsx', 'views/Library.jsx', 'components/MuscleExplorer.jsx']) expect(src(f), f).not.toMatch(/stopPropagation/)
  })
  it('the cover spans the card, the other controls sit above it, and the press answers the primary only', () => {
    expect(rule('.tap-host')).toMatch(/position:relative/)
    expect(rule('.tap-main::after')).toMatch(/position:absolute;inset:0;z-index:1/)
    expect(css).toMatch(/:where\(\.tap-host\) :where\(button, a\[href\], input, select, textarea, \[role="button"\]\):not\(\.tap-main\)\{z-index:2\}/)
    expect(rule('.tap-main:focus-visible::after')).toMatch(/outline:2\.5px solid var\(--acc-ink\)/)
    expect(css).toMatch(/\.card\.tap-host:has\(\.tap-main:active\)\{transform:scale\(var\(--press-scale-card\)\)\}/)
    expect(css).toMatch(/\.item\.tap-host:has\(\.tap-main:active\),\.wd-ex\.tap-host:has\(\.tap-main:active\)\{background:var\(--press-fill\)\}/)
    // a row's own fill no longer fires when one of its buttons is pressed
    expect(rule('.item:active')).toBe('')
    expect(rule('.item:not(.tap-host):active')).toMatch(/var\(--press-fill\)/)
    expect(rule('.wd-ex:not(.tap-host):active')).toMatch(/var\(--press-fill\)/)
  })
  it('the card × is a 44 px target or more, reaching into its corner', () => {
    const size = Number(rule('.card-head>.iconbtn').match(/width:(\d+)px/)[1])
    const hit = rule('.card-head>.iconbtn::before')
    const [b] = hit.match(/inset-block:-(\d+)px/).slice(1).map(Number)
    const [s, e] = hit.match(/inset-inline:-(\d+)px -(\d+)px/).slice(1).map(Number)
    expect(size + 2 * b).toBeGreaterThanOrEqual(44)
    expect(size + s + e).toBeGreaterThanOrEqual(44)
    expect(s).toBeLessThanOrEqual(8)   // no further than the CardHead gap: never over the primary's own button
  })
})

// The Stats redesign (REVIEW.md, "## Stats redesign"): one bar system, one legend style.
describe('Stats redesign', () => {
  it('one bar: the track, the fill in the inks by tone, the band with a plain colour first', () => {
    expect(rule('.sbar-t')).toMatch(/height:8px;border-radius:4px;background:var\(--surface-2\)/)
    expect(rule('.sbar-row.in .sbar-f')).toMatch(/var\(--green-ink\)/)
    expect(rule('.sbar-row.above .sbar-f')).toMatch(/var\(--orange-ink\)/)
    expect(rule('.slegend-m.band')).toMatch(/background:rgba\([^)]+\);background:color-mix/)
    expect(rule('.sbar-v')).toMatch(/font-variant-numeric:tabular-nums/)
  })
  it('tapped rows are 44px and fill on press; nothing physical, no px type', () => {
    expect(rule('.sbar-row.tap')).toMatch(/min-height:44px/)
    expect(rule('.sbar-row.tap:active')).toMatch(/var\(--press-fill\)/)
    expect(rule('.ex-day')).toMatch(/min-height:44px/)
    expect(rule('.ex-day:active')).toMatch(/var\(--press-fill\)/)
    expect(rule('.card-fold')).toMatch(/min-height:44px/)
    const own = [...css.matchAll(/(\.(?:sbar|slegend|sstack|mus-|kpis|card-fold|ex-day|ex-eff|effort-)[^{]*)\{([^}]*)\}/g)]
    expect(own.length).toBeGreaterThan(30)
    for (const [, sel, decls] of own) {
      expect(decls, sel).not.toMatch(/(margin|padding)-(left|right)|(^|;)(left|right):/)
      expect(decls, sel).not.toMatch(/font-size:\d+px/)
      expect(decls, sel).not.toMatch(/transition:all/)
    }
  })
  it('untrained muscles are a quiet chip, not an orange alarm', () => {
    expect(rule('.mchip.miss')).toBe('background:var(--surface-2);color:var(--label)')
  })
})
