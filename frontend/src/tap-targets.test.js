// @vitest-environment node

/* Touch targets: every small control in the kit is at least 44px (--tap-min) to tap, in both
 * directions, without being painted any bigger. jsdom has no layout, so this reads the rules that
 * do it (the ::before hit-area extension in index.css) and works out the box they give a control of
 * each size: max(its size, 44px), centred on the painted box. A control that is already 44px or
 * more keeps the slop it had. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const INDEX = read('./index.css').replace(/\/\*[\s\S]*?\*\//g, '')
const KIT = read('./ui-kit.css')
const TAP = Number(/--tap-min:\s*(\d+)px/.exec(KIT)[1])

// Every top-level rule as { selectors, decls }, in source order. Rules inside an @media or
// @supports block are skipped: the hit area is not conditional.
function rules(css) {
  const out = []
  let depth = 0, start = 0, head = ''
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '{') { if (depth === 0) head = css.slice(start, i).trim(); depth++; if (depth === 1) start = i + 1 }
    else if (c === '}') {
      depth--
      if (depth === 0) {
        if (head && !head.startsWith('@')) {
          const decls = {}
          for (const d of css.slice(start, i).split(';')) {
            const at = d.indexOf(':')
            if (at > 0) decls[d.slice(0, at).trim()] = d.slice(at + 1).trim()
          }
          out.push({ selectors: split(head).map(s => s.trim().replace(/\s+/g, ' ')), decls })
        }
        start = i + 1
      }
    }
  }
  return out
}
const ALL = rules(INDEX)

// Does this entry of a selector list name `sel`: itself, or inside a :where(…) list.
const names = (entry, sel) => entry === sel
  || (entry.startsWith(':where(') && split(entry.slice(7, -1)).map(s => s.trim()).includes(sel))

// What those rules say for one selector: the declarations of every rule that names it, the later
// one winning a property, as the cascade does between rules of equal weight.
const declsFor = selector => Object.assign({}, ...ALL.filter(r => r.selectors.some(s => names(s, selector))).map(r => r.decls))

// A length like max(calc(100% + 12px), var(--tap-min)) for a box of `size` px.
function evaluate(value, size) {
  const v = value.replace(/var\(--tap-min\)/g, `${TAP}px`).replace(/\s+/g, ' ').trim()
  const num = s => {
    s = s.trim()
    let m
    if ((m = /^max\((.*)\)$/.exec(s))) return Math.max(...split(m[1]).map(num))
    if ((m = /^calc\((.*)\)$/.exec(s))) return num(m[1])
    if ((m = /^(.+?) \+ (.+)$/.exec(s))) return num(m[1]) + num(m[2])
    if (s === '100%') return size
    if ((m = /^(-?[\d.]+)px$/.exec(s))) return Number(m[1])
    throw new Error(`cannot evaluate "${s}"`)
  }
  return num(v)
}
// Top-level comma split (not inside parentheses).
function split(s) {
  const out = []
  let depth = 0, from = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') depth--
    else if (s[i] === ',' && depth === 0) { out.push(s.slice(from, i)); from = i + 1 }
  }
  out.push(s.slice(from))
  return out
}

// The sizes these controls are painted at (px): a 36px .btn.sm (padding 8 + 15px type), a 27px
// .btn.xs, a 30px chip, a 36px icon button, the 26px one in a .subrow, a 44px one already.
const SIZES = [26, 27, 30, 36, 44, 52]
const TARGETS = ['.iconbtn', '.chip', '.helpbtn', '.btn.sm', '.btn.xs', '.seg button']

describe('the hit area of small controls', () => {
  it('is 44px in 44px: the floor is the same token the kit already names', () => {
    expect(TAP).toBe(44)
  })

  for (const sel of TARGETS) {
    it(`${sel} gets at least ${TAP}px to tap, whatever size it is painted at`, () => {
      const d = declsFor(`${sel}::before`)
      expect(d.content, `${sel}::before has a box`).toBe("''")
      expect(d.position).toBe('absolute')
      for (const size of SIZES) {
        const h = evaluate(d.height, size)
        expect(h, `${sel}: height for a ${size}px control`).toBeGreaterThanOrEqual(Math.min(TAP, Infinity))
        if (sel !== '.seg button') expect(evaluate(d.width, size), `${sel}: width for a ${size}px control`).toBeGreaterThanOrEqual(TAP)
      }
    })

    it(`${sel} paints no bigger: the extension is a pseudo-element, not a minimum size`, () => {
      const own = declsFor(sel)
      // (A segmented button has a 30px minimum of its own, its design, not something added here.)
      if (sel !== '.seg button') {
        expect(own['min-height'], `${sel} min-height`).toBeUndefined()
        expect(own['min-width'], `${sel} min-width`).toBeUndefined()
      }
      // And it is the box the pseudo-element is positioned against.
      const positioned = ALL.some(r => r.decls.position === 'relative' && r.selectors.some(s => names(s, sel)))
      expect(positioned, `${sel} is position:relative`).toBe(true)
    })
  }

  it('a control already bigger than 44px keeps the 6px of slop the icon buttons, chips and help buttons always had', () => {
    for (const sel of ['.iconbtn', '.chip', '.helpbtn']) expect(evaluate(declsFor(`${sel}::before`).height, 60), sel).toBe(72)
    // …and the buttons, which never had any, get none.
    for (const sel of ['.btn.sm', '.btn.xs']) expect(evaluate(declsFor(`${sel}::before`).height, 60), sel).toBe(60)
  })

  it('segmented buttons stay flush: no sideways extension into the neighbour', () => {
    expect(declsFor('.seg button::before').width).toBe('100%')
  })

  it('a chip inside a scrolling strip gets the full floor, in a strip that is itself that tall so nothing overflows it', () => {
    const d = { ...declsFor('.chip::before'), ...declsFor('.chips .chip::before') }
    const strip = ALL.filter(r => r.selectors.includes('.chips:not(.wchips)')).reduce((a, r) => ({ ...a, ...r.decls }), {})
    expect(evaluate(strip['min-height'], 0)).toBe(TAP)
    expect(strip['align-items']).toBe('center')
    // Centred on the chip (the general rule), so centred on the strip.
    expect(d.top).toBe('50%')
    for (const size of SIZES.filter(s => s <= TAP)) {
      expect(evaluate(d.height, size), `height for a ${size}px chip`).toBe(TAP)
      expect(evaluate(d.width, size)).toBeGreaterThanOrEqual(TAP)
    }
    // A chip taller than the floor gets exactly its own height: no slop to overflow the strip.
    expect(evaluate(d.height, 52)).toBe(52)
  })

  it('a button that something positions itself keeps its position: the rule for .btn.sm/.xs has no weight', () => {
    expect(INDEX).toMatch(/:where\(\.btn\.sm,\.btn\.xs\)\{position:relative\}/)
  })
})
