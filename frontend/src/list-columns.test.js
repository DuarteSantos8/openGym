// How many columns a `.list` gets on a computer (≥1000px). The desktop layout puts the lists of
// the full-width pages in two columns; a `.narrow` page (Home, Workout, Settings, Admin, …) is
// one 640px column and its lists are meant to stay one column in it. The rule saying so lost to
// `#app .list` on specificity, so those lists showed two-up anyway. happy-dom does not apply
// media queries or the cascade, so this resolves it from index.css itself: the desktop block's
// rules and the base rules, highest specificity first and the later rule on a tie.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// The inside of one @media block, by brace depth.
function mediaBody(query) {
  const at = css.indexOf(`@media ${query}{`)
  expect(at, query).toBeGreaterThanOrEqual(0)
  let depth = 0
  const open = css.indexOf('{', at)
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return { body: css.slice(open + 1, i), start: open + 1, end: i }
  }
  throw new Error('unclosed ' + query)
}

// Flat `selector{declarations}` rules, in source order.
const rulesIn = (text, offset = 0) => [...text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
  .map(m => ({ selectors: m[1].split(',').map(s => s.trim()), decls: m[2], order: offset + m.index }))

const desktop = mediaBody('(min-width:1000px)')
// Top-level rules only: every other @media block is left out, since none of them touches `.list`.
const topLevel = rulesIn(css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, m => ' '.repeat(m.length)))
const rules = [...topLevel, ...rulesIn(desktop.body, desktop.start)].filter(r => /display:/.test(r.decls))

const compound = text => ({
  ids: [...text.matchAll(/#([\w-]+)/g)].map(m => m[1]),
  classes: [...text.matchAll(/\.([\w-]+)/g)].map(m => m[1]),
  other: text.replace(/#[\w-]+|\.[\w-]+/g, ''),
})
const fits = (c, el) => !c.other && c.ids.every(id => el.id === id) && c.classes.every(k => (el.classes || []).includes(k))
// Descendant selectors only, which is all the list rules use: the last compound is the element,
// the others have to be found among its ancestors, in order.
function matches(selector, el, ancestors) {
  if (/[>+~:[]/.test(selector)) return false
  const parts = selector.split(/\s+/).map(compound)
  if (!fits(parts.at(-1), el)) return false
  let i = ancestors.length - 1
  for (const part of parts.slice(0, -1).reverse()) {
    while (i >= 0 && !fits(part, ancestors[i])) i--
    if (i < 0) return false
    i--
  }
  return true
}
const specificity = selector => {
  const c = selector.split(/\s+/).map(compound)
  return [c.reduce((n, x) => n + x.ids.length, 0), c.reduce((n, x) => n + x.classes.length, 0)]
}
const beats = (a, b) => a.spec[0] - b.spec[0] || a.spec[1] - b.spec[1] || a.order - b.order

// The `display` a list resolves to, given its own classes and its ancestors from the root down.
function displayOf(classes, ancestors) {
  let best = null
  for (const rule of rules) {
    const display = rule.decls.match(/(?:^|;)\s*display:([\w-]+)/)?.[1]
    if (!display) continue
    for (const selector of rule.selectors) {
      if (!matches(selector, { classes }, ancestors)) continue
      const hit = { display, spec: specificity(selector), order: rule.order }
      if (!best || beats(hit, best) > 0) best = hit
    }
  }
  return best?.display
}

const app = { id: 'app' }
const page = cls => ({ classes: [cls] })
const modal = { id: 'modal-root' }

describe('lists on a computer', () => {
  it('stay one column on a .narrow page (Home, Workout, Settings, Admin, the coach pages)', () => {
    expect(displayOf(['list'], [app, page('narrow')])).toBe('flex')
    // a list inside a card on the page, not a direct child of it
    expect(displayOf(['list'], [app, page('narrow'), page('card')])).toBe('flex')
    expect(displayOf(['list', 'routine-list'], [app, page('narrow')])).toBe('flex')
  })

  it('keep two columns on the full-width pages (Library, History, Stats, Plan)', () => {
    expect(displayOf(['list'], [app])).toBe('grid')
    expect(displayOf(['list'], [app, page('card')])).toBe('grid')
  })

  it('stay one column in a sheet, and the routine editor’s list at any width', () => {
    expect(displayOf(['list'], [modal])).toBe('flex')
    expect(displayOf(['list', 'menu-list'], [modal])).toBe('flex')
    expect(displayOf(['list', 'routine-list'], [app])).toBe('flex')
  })

  it('reads the base rule outside the desktop block too', () => {
    expect(displayOf(['list'], [])).toBe('flex')
  })
})
