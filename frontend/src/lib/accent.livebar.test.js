import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { contrast, mix, liveBarAlpha, LIVEBAR_ALPHA, customAccentVars } from './accent.js'

const okOver = (acc, ink, a) =>
  contrast(ink, mix(acc, '#000000', 1 - a)) >= 4.5 && contrast(ink, mix(acc, '#ffffff', 1 - a)) >= 4.5

describe('liveBarAlpha', () => {
  it('finds a translucent fill that holds 4.5:1 over black and white', () => {
    const a = liveBarAlpha('#a3e635', '#0c0e12')
    expect(a).toBeGreaterThanOrEqual(LIVEBAR_ALPHA)
    expect(a).toBeLessThanOrEqual(1)
    expect(okOver('#a3e635', '#0c0e12', a)).toBe(true)
  })
  it('is 1 when only the solid fill passes', () => {
    expect(okOver('#767676', '#000000', 0.72)).toBe(false)
    expect(liveBarAlpha('#767676', '#000000')).toBe(1)
  })
  it('is the lowest passing step', () => {
    const a = liveBarAlpha('#a3e635', '#0c0e12')
    if (a > LIVEBAR_ALPHA) expect(okOver('#a3e635', '#0c0e12', Math.round((a - 0.04) * 100) / 100)).toBe(false)
  })
  it('a custom accent carries its own --livebar-a', () => {
    const v = customAccentVars('#a3e635', 'dark')
    expect(Number(v['--livebar-a'])).toBe(liveBarAlpha(v['--acc'], v['--on-acc']))
  })
})

// A preset that fails 4.5:1 even solid: the app's existing on-accent pairing, not this feature's to fix.
const KNOWN_SOLID = ['sky', 'violet', 'pink', 'red'].flatMap(n => [`${n}/dark`, `${n}/light`]) // white on a system colour is 3.4-4.1:1 even solid

// Top-level rules of index.css only (nested @media / @supports blocks dropped).
function topRules (css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  let depth = 0, start = 0, sel = ''
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) sel = css.slice(start, i).trim(); depth++ }
    else if (css[i] === '}') {
      depth--
      if (depth === 0) { out.push([sel, css.slice(css.lastIndexOf('{', i) + 1, i)]); start = i + 1 }
    }
  }
  return out
}

function props (rules, theme, accent) {
  const hits = []
  rules.forEach(([sel, body], order) => {
    if (sel.includes('@')) return
    for (const s of sel.split(',').map(x => x.trim())) {
      if (!s.startsWith(':root')) continue
      const th = s.includes(':not(') ? 'dark' : /\[data-theme="(\w+)"\]/.exec(s)?.[1] // :not([data-theme="light"]) is dark
      const ac = /\[data-accent="(\w+)"\]/.exec(s)?.[1]
      if (th && th !== theme) continue
      if (ac && ac !== accent) continue
      hits.push([(th ? 1 : 0) + (ac ? 1 : 0), order, body])
    }
  })
  const p = {}
  for (const [, , body] of hits.sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) p[m[1]] = m[2]
  }
  return p
}

const val = (p, k) => {
  let v = p[k]
  while (v && /^var\((--[\w-]+)\)$/.test(v)) v = p[/^var\((--[\w-]+)\)$/.exec(v)[1]]
  return v
}
const full = h => (h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h)

// The body of `@media (prefers-contrast: more)`, whose rules are layered on top when it applies.
function moreRules (css) {
  const at = css.indexOf('@media (prefers-contrast: more){') + '@media (prefers-contrast: more){'.length
  let depth = 1, i = at
  for (; depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0
  return topRules(css.slice(at, i - 1))
}

describe('index.css --livebar-a', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const rules = topRules(css)
  const more = [...rules, ...moreRules(css)]
  const presets = [...new Set([...rules.map(r => r[0]).join(' ').matchAll(/data-accent="(\w+)"/g)].map(m => m[1]))]
  it('finds the presets', () => expect(presets.length).toBe(9))
  for (const [mode, rs] of [['', rules], [' (prefers-contrast: more)', more]]) for (const theme of ['dark', 'light']) {
    for (const name of presets) {
      it(`${name}/${theme}${mode} is at least as opaque as its text needs`, () => {
        const p = props(rs, theme, name)
        const acc = full(val(p, '--acc')), ink = full(val(p, '--on-acc'))
        const css = Number(p['--livebar-a'] ?? '.86')
        if (!KNOWN_SOLID.includes(`${name}/${theme}`) && !mode) {
          expect(contrast(ink, acc), 'solid fill fails 4.5:1; add to KNOWN_SOLID').toBeGreaterThanOrEqual(4.5)
        }
        expect(css).toBeGreaterThanOrEqual(liveBarAlpha(acc, ink))
      })
    }
  }
})
