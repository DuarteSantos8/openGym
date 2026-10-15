// The UI guards: a ratchet on the markup and styling the UI kit replaces (components/layout.jsx,
// blocks.jsx, sheet-layout.jsx, ui-kit.css; see components/README-ui-kit.md). Like
// page-width.test.js they read the sources. Each file's count must equal its entry in
// src/ui-guards.baseline.json: above it is a regression (a file the baseline lacks starts at 0),
// below it is a migration that lowers its entry in the same PR with
// `node scripts/ui-guards-baseline.mjs`. Never regenerate the baseline to turn a rise green.
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BASELINE, LEGACY_CSS, LOWER, PAGE_EXEMPT, cssColours, cssFiles, handBuilt, jsColours, measure,
  newCssViolations, ratchet, routeViewsWithoutPage, sheetsImporters, staticStyles,
} from '../scripts/ui-guards-baseline.mjs'

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
const now = measure()

describe('UI guards (ratchet)', () => {
  it('G1: no file changes its literal inline style properties; use Stack, Inline, Spacer, mb-N, .ink-*', () => {
    expect(ratchet(now.G1, baseline.G1)).toEqual([])
  })

  it('G2: no legacy stylesheet changes its colours outside the theme :root rules', () => {
    expect(ratchet(now.G2css, baseline.G2css)).toEqual([])
  })

  it('G2: no source file changes its colour literals; use a token', () => {
    expect(ratchet(now.G2js, baseline.G2js)).toEqual([])
  })

  it('G3: no file changes its hand-built .card/.item/.tile(s)/.empty/.lrow/.tag/.chip(s)/.big/.row/h4.sec/h3 markup; use the primitive', () => {
    expect(ratchet(now.G3, baseline.G3)).toEqual([])
  })

  it('G4: every routed view renders <Page>, other than the baselined ones and the full-screen views', () => {
    expect(ratchet(now.G4, baseline.G4)).toEqual([])
  })

  it('G6: nothing outside sheets.jsx and src/sheets/ imports src/sheets/* (the vi.mock facade)', () => {
    expect(sheetsImporters()).toEqual([])
  })

  it('G7: a new stylesheet holds no colour (outside a theme file\'s :root) and no page width', () => {
    const fresh = cssFiles().filter(f => !LEGACY_CSS.includes(f.file))
    expect(fresh.map(f => f.file)).toContain('ui-kit.css')
    expect(fresh.filter(f => newCssViolations(f.text, f.file) > 0).map(f => f.file)).toEqual([])
  })
})

describe('the ratchet', () => {
  it('fails a rise, a new file above 0, and a fall that did not lower the baseline', () => {
    expect(ratchet({ 'a.jsx': 3, 'b.jsx': 1, 'c.jsx': 1 }, { 'a.jsx': 2, 'c.jsx': 2, 'd.jsx': 4 })).toEqual([
      'a.jsx: 3 (baseline 2)',
      'b.jsx: 1 (baseline 0)',
      `c.jsx: 1 (baseline 2), ${LOWER}`,
      `d.jsx: 0 (baseline 4), ${LOWER}`,
    ])
    expect(ratchet({ 'a.jsx': 2 }, { 'a.jsx': 2 })).toEqual([])
  })

  it('compares a list an entry at a time', () => {
    expect(ratchet(['Home', 'Plan'], ['Plan', 'Stats'])).toEqual(['Home: new, not allowed', `Stats: fixed, ${LOWER}`])
  })
})

// The measurements themselves, so a guard cannot pass by miscounting.
describe('G1 counts every literal style property, wherever it hides', () => {
  const n = src => staticStyles(src)
  it('in an inline object, each literal one, beside dynamic siblings and custom properties', () => {
    expect(n(`<div style={{ height: 8, marginTop: '4px', color: 'var(--red-ink)' }} />`)).toBe(3)
    expect(n(`<div style={{ width: pct + '%', marginTop: 8, '--tint': 'var(--blue)', '--x': 3 }} />`)).toBe(1)
    expect(n(`<div style={{ width: w }} /><div style={{ '--tint': tint }} />`)).toBe(0)
  })

  it('with spaces around the =', () => {
    expect(n(`<div style = {{ marginTop: 8 }} />`)).toBe(1)
  })

  it('in a ternary, a logical and a nullish branch', () => {
    expect(n(`<i style={on ? { opacity: .5 } : { opacity: 1, marginTop: 2 }} />`)).toBe(3)
    expect(n(`<i style={on && { marginTop: 2 }} /><i style={s || { marginTop: 2 }} />`)).toBe(3)
    expect(n(`<i style={on ? { width: w } : null} />`)).toBe(0)
  })

  it('a template literal with nothing in it is a literal; one with ${} is not', () => {
    expect(n('<i style={{ margin: `0 4px`, width: `${w}px` }} />')).toBe(1)
  })

  it('a constant used as a value', () => {
    expect(n(`const GAP = 8\nconst W = props.w\nfunction A() { return <i style={{ gap: GAP, width: W }} /> }`)).toBe(1)
  })

  it('in a spread, of an object constant or inline', () => {
    expect(n(`const base = { marginTop: 8, fontSize: 13 }\n<i style={{ ...base, width: w }} />`)).toBe(2)
    expect(n(`<i style={{ ...{ marginTop: 8 }, ...(on ? { opacity: 1 } : {}) }} />`)).toBe(2)
  })

  it('in a module or function constant passed whole, and its members', () => {
    expect(n(`const S = { marginTop: 8 }\nfunction A() { return <i style={S} /> }`)).toBe(1)
    expect(n(`function A() {\n  const box = on ? { padding: 4 } : { padding: 6 }\n  return <i style={box} />\n}`)).toBe(2)
    expect(n(`const css = { row: { gap: 6, alignItems: 'center' } }\n<i style={css.row} />`)).toBe(2)
  })

  it('returned by a local helper', () => {
    expect(n(`function pill(c) { return { color: c, padding: '3px 7px' } }\n<i style={pill(x)} />`)).toBe(1)
    expect(n(`const box = on => ({ marginTop: on ? 8 : 4, height: 2 })\n<i style={box(true)} />`)).toBe(1)
    expect(n(`const bar = pct => ({ width: pct + '%' })\n<i style={bar(3)} />`)).toBe(0)
  })

  it('counts a style it cannot follow as one, but not a style passed through', () => {
    expect(n(`<i style={theme.card} /><i style={makeStyle()} /><i style={s} />`)).toBe(3)
    expect(n(`function A({ style }) { return <i style={style} /> }\n<i style={props.style} />`)).toBe(0)
  })

  it('skips comments', () => {
    expect(n(`{/* <div style={{ height: 2 }} /> */}\n// <i style={{ height: 2 }} />`)).toBe(0)
  })
})

describe('G2 counts colours', () => {
  it('in a stylesheet: hex, rgb()/hsl() and names, outside a theme file\'s :root rules', () => {
    const css = `:root{--a:#fff;--b:rgba(0,0,0,.3)} :root[data-theme="light"]{--a:#000}
      .x{color:#123456;background:rgb(1 2 3)} /* #abc red */ .y{border:1px solid white;color:var(--red)}
      :root[data-theme="light"] .z{color:hsl(0 0% 0%)}`
    expect(cssColours(css, true)).toBe(4)
    expect(cssColours(css, false)).toBe(7)
  })

  it('in code: hex, rgb()/hsl() and a quoted colour name given as a value', () => {
    expect(jsColours(`// #fff\nconst c = '#30d158'; const s = 'https://x/#top'\nconst k = { color: 'white', bg: 'rgba(0,0,0,.5)' }`)).toBe(3)
    expect(jsColours(`if (accent === 'green') t('Red')`)).toBe(0)
  })
})

describe('G3 counts hand-built primitive markup', () => {
  it('however the className is built', () => {
    expect(handBuilt(`<div className="card"><div className={'chip' + on}><span className={\`tag \${x}\`}>`)).toBe(3)
    expect(handBuilt(`<div className={cx('card', on && 'on')}><div className={on ? 'item on' : 'item'}>`)).toBe(2)
    expect(handBuilt(`<div className={['hub', 'card'].join(' ')}><div className = "row between"><div className="big">`)).toBe(3)
    expect(handBuilt(`const cls = cx('tiles', wide && 'wide')\nel.className = "empty"`)).toBe(2)
  })

  it('h4.sec and a sheet title h3', () => {
    expect(handBuilt(`<h4 className="sec">a</h4><h3>Title</h3><h3 style={{ marginBottom: 2 }}>T</h3><div className="sec">`)).toBe(3)
  })

  it('not a class that only starts like one', () => {
    expect(handBuilt(`<div className="card-x"><div className="hub-card"><div className="items"><div className="rows">`)).toBe(0)
  })
})

describe('G4 and G7', () => {
  it('finds the routed components and exempts the full-screen ones', () => {
    const views = routeViewsWithoutPage()
    expect(views).toContain('Workout')
    expect(views).not.toContain('SettingsRoute')
    expect(PAGE_EXEMPT).toEqual(['FocusView', 'Login', 'MobileOnboarding', 'Workout'])
    expect(now.G4).not.toContain('Workout')
  })

  it('checks the routed component itself, through double-quoted, named and lazy imports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ui-guards-'))
    try {
      mkdirSync(join(dir, 'views'))
      writeFileSync(join(dir, 'App.jsx'), [
        `import A from "./views/A.jsx"`,
        `import { BRoute, Other as C } from './views/B.jsx'`,
        `const D = lazy(() => import('./views/D.jsx'))`,
        `const E = React.lazy(() => import("./views/E.jsx").then(m => ({ default: m.ERoute })))`,
        `<Route path="/a" element={<A />} /><Route path="/b" element={<BRoute />} /><Route path="/c" element={ok ? <C /> : <Navigate to="/" />} />`,
        `<Route path="/d" element={<D />} /><Route path="/e" element={<E />} />`,
      ].join('\n'))
      writeFileSync(join(dir, 'views', 'A.jsx'), `export default function A() { return <Page title="A">x</Page> }`)
      // The file renders <Page>, but not in the routed component.
      writeFileSync(join(dir, 'views', 'B.jsx'), `export function BRoute() { return <div /> }\nexport function Other() { return <Inner /> }\nfunction Inner() { return <Page title="C" /> }`)
      writeFileSync(join(dir, 'views', 'D.jsx'), `const D = () => <div><Page title="D" /></div>\nexport default D`)
      writeFileSync(join(dir, 'views', 'E.jsx'), `export function ERoute() { return <section /> }\nexport function Unused() { return <Page /> }`)
      expect(routeViewsWithoutPage(dir)).toEqual(['BRoute', 'E'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('flags a page width and a colour in a new stylesheet, :root included unless it is a theme file', () => {
    expect(newCssViolations('.a{max-width:560px}', 'x.css')).toBe(1)
    expect(newCssViolations('.a{max-inline-size:560px}', 'x.css')).toBe(1)
    expect(newCssViolations(':root{--x:#123}', 'x.css')).toBe(1)
    expect(newCssViolations('.a{color:tomato;background:hsl(0 0% 0%)}', 'x.css')).toBe(2)
    expect(newCssViolations(':root{--x:#fff} .a{color:var(--x)}', 'ui-kit.css')).toBe(0)
  })
})
