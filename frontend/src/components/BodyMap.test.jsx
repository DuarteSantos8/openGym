// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import BodyMap, { BodyMapLegend } from './BodyMap.jsx'
import { _setLangState } from '../lib/i18n-core.js'

const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
const pack = code => packs[`../locales/${code}.js`]

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

// BodyMap fetches its ~90 KB of geometry with a dynamic import on first render, and the
// waitFor below allows one second for it. That is ample once the module is in the ESM
// registry and not always ample when it is not: on a loaded CI runner the first map render
// in this file paid the cold import and timed out, while every later test passed on the
// component's warm CACHE. Import it here so the wait covers rendering, not module loading,
// and the file stops depending on how fast the machine is.
beforeAll(() => import('../lib/body-paths.js'))

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function renderMap(props = {}) {
  await act(async () => {
    root.render(<BodyMap load={{ chest: 2 }} {...props} />)
  })
  await vi.waitFor(() => expect(container.querySelectorAll('.bm-v')).toHaveLength(2))
  return container.querySelector('.bm-m[aria-label="Chest"]')
}

describe('BodyMap interaction semantics', () => {
  it('keeps noninteractive maps as images without focusable muscle controls', async () => {
    await renderMap()
    expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(2)
    expect(container.querySelector('[role="button"]')).toBeNull()
  })

  it('exposes interactive muscles as translated pressed buttons inside groups', async () => {
    const path = await renderMap({ selected: 'chest', onMuscle: vi.fn() })
    expect(container.querySelectorAll('svg[role="group"]')).toHaveLength(2)
    expect(path).toBeTruthy()
    expect(path.tabIndex).toBe(0)
    expect(path.getAttribute('aria-pressed')).toBe('true')
  })

  it.each(['Enter', ' '])('activates a muscle once with %s', async key => {
    const onMuscle = vi.fn()
    const path = await renderMap({ onMuscle })
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })

    act(() => path.dispatchEvent(event))

    expect(onMuscle).toHaveBeenCalledTimes(1)
    expect(onMuscle).toHaveBeenCalledWith('chest')
    expect(event.defaultPrevented).toBe(key === ' ')
  })

  // P4: a muscle is several shapes (and on both views); one of them is its button, every one
  // still takes the tap. Fourteen "Forearms" in a row was what a screen reader got before.
  it('has one button per muscle, however many shapes draw it', async () => {
    const onMuscle = vi.fn()
    await renderMap({ onMuscle })
    const buttons = [...container.querySelectorAll('[role="button"]')]
    const names = buttons.map(b => b.getAttribute('aria-label'))
    expect(names.length).toBeGreaterThan(10)
    expect(new Set(names).size).toBe(names.length)
    const shapes = [...container.querySelectorAll('.bm-m')]
    expect(shapes.length).toBeGreaterThan(buttons.length)
    const extra = shapes.find(p => !p.hasAttribute('role'))
    expect(extra.getAttribute('aria-hidden')).toBe('true')
    expect(extra.hasAttribute('tabindex')).toBe(false)
    act(() => extra.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onMuscle).toHaveBeenCalledTimes(1)
  })

  it('labels the existing legend direction for assistive technology', () => {
    act(() => root.render(<BodyMapLegend />))
    expect(container.querySelector('.hm-legend').getAttribute('aria-label')).toBe('Less More')
  })
})

// A muscle is drawn as several shapes, on both views, so a map that is not interactive used to
// hand a screen reader one unnamed image holding every shape in it: on a routine's page that is
// 116 symbols over 20 muscle names, "obliques" sixteen times and "forearms" fourteen, with the
// six muscles the routine actually hits sounding exactly like the fourteen it does not, because
// the difference is carried by fill colour alone. The interactive branch above already solves
// this by naming one shape per muscle and hiding the rest; this is the same treatment for the
// branch that has no tap handler, where there is nothing to name per shape.
// The guard at the end of this file reads source rather than the rendered tree, so a new call
// site cannot be added without deciding what a screen reader gets from it. It is here at module
// scope, and fed made-up sources by its own test, because both ways it can fail are silent: it
// can miss a site, and it can excuse one that needs naming.

// The element's own opening tag, ending at the first ">" outside braces so that a prop holding an
// arrow function (onMuscle={() => pick(m)}) does not cut it short. A window of lines around the
// call is not the same thing: it takes in a <button> that closed above the map and a sibling's
// aria-hidden below it, neither of which says anything about the map between them.
const openTag = (text, from) => {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') depth--
    else if (text[i] === '>' && depth === 0) return text.slice(from, i + 1)
  }
  return text.slice(from)
}

// Two sites are decoration without a marker on the map itself, because the element wrapped around
// them carries it. Both were read in Chrome's accessibility tree, not assumed:
//  - the session's header button, whose aria-label names it. A <button aria-label> hides its
//    subtree where role="img" does not, so the 116 shapes under it are not exposed;
//  - the Wrapped card, whose wrapper is aria-hidden, the way MiniBodyMap hides itself.
// Matched on the text of the call, not on a line number (any unrelated edit above would move it)
// and not on neighbouring lines. Reformat one and the guard fails and points at it.
const DECORATION_BY_ANCESTOR = [
  '<BodyMap className="bm-mini bm-session"',
  '<BodyMap load={st.load} body={body} />',
]

/** The maps in `text` that are neither tappable, named, nor hidden. */
function unnamedMaps(text) {
  const lines = text.split('\n')
  const out = []
  // \b, not a space: a call site written over several lines starts with "<BodyMap" alone, and a
  // guard that quietly stopped seeing it would be worse than no guard. Still excludes
  // <BodyMapLegend, which is a different component.
  for (const m of text.matchAll(/<BodyMap\b/g)) {
    const tag = openTag(text, m.index)
    if (/onMuscle|aria-hidden|hits=/.test(tag)) continue
    if (DECORATION_BY_ANCESTOR.some(named => tag.startsWith(named))) continue
    const no = (text.slice(0, m.index).match(/\n/g) || []).length + 1
    out.push({ line: no, snippet: (lines[no - 1] || '').trim() })
  }
  return out
}

describe('BodyMap as a read-only picture', () => {
  // Leaving the app in German would send every later test in this file looking for German names.
  afterEach(() => _setLangState('en', null, null, null))

  // Stable on purpose. An inline literal is a new array every render, so a memo that forgot the
  // language would be forced to recompute and the language test below would pass while the bug
  // was present.
  const HITS = ['chest', 'lats']
  const LOAD = { chest: 12, lats: 8 }

  async function renderReadOnly(props = {}) {
    await act(async () => {
      root.render(<BodyMap load={LOAD} {...props} />)
    })
    await vi.waitFor(() => expect(container.querySelectorAll('.bm-v')).toHaveLength(2))
    return container
  }

  it('does not read every shape of a muscle it has already named', async () => {
    const c = await renderReadOnly({ hits: ['chest', 'lats'] })
    const shapes = [...c.querySelectorAll('.bm-m')]
    expect(shapes.length).toBeGreaterThan(20)
    expect(shapes.every(p => p.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('names the muscles the map stands for, in the order given', async () => {
    const c = await renderReadOnly({ hits: ['chest', 'lats'] })
    expect(c.querySelector('.bm-v').getAttribute('aria-label')).toBe('Chest, Lats')
  })

  // The two views draw one body, not two loads: naming both would read the muscle list twice.
  it('names the front view and leaves the back view to it', async () => {
    const c = await renderReadOnly({ hits: ['chest', 'lats'] })
    const [front, back] = [...c.querySelectorAll('.bm-v')]
    expect(front.getAttribute('aria-label')).toBe('Chest, Lats')
    expect(back.getAttribute('aria-label')).toBeNull()
    expect(back.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps the interactive map naming one shape per muscle instead of the whole picture', async () => {
    await renderReadOnly({ hits: ['chest'], onMuscle: vi.fn() })
    expect(container.querySelector('.bm-v').getAttribute('aria-label')).toBeNull()
    const named = [...container.querySelectorAll('[role="button"]')].map(b => b.getAttribute('aria-label'))
    expect(named).toContain('Chest')
    expect(new Set(named).size).toBe(named.length)
  })

  it('says nothing rather than an empty label when the map has no muscles', async () => {
    const c = await renderReadOnly({ hits: [] })
    const named = [...c.querySelectorAll('.bm-v')].filter(v => v.hasAttribute('aria-label'))
    expect(named).toHaveLength(0)
  })

  it('ignores a load key that is not a muscle', async () => {
    const c = await renderReadOnly({ hits: ['chest', 'nonsense'] })
    expect(c.querySelector('.bm-v').getAttribute('aria-label')).toBe('Chest')
  })

  // The names come from t(), so a language change made with a map on screen has to reach them.
  // App.jsx holds the language with useLang() and re-renders the whole shell over it; a label
  // remembered from the previous language reads as a picture of a different workout.
  it('renames the muscles when the language changes under it', async () => {
    const c = await renderReadOnly({ hits: HITS })
    expect(c.querySelector('.bm-v').getAttribute('aria-label')).toBe('Chest, Lats')
    // The packs load lazily in the app; handing the German one over is the state a change in
    // Settings leaves the app in.
    _setLangState('de', pack('de'), null, null)
    await act(async () => { root.render(<BodyMap load={LOAD} hits={HITS} />) })
    expect(c.querySelector('.bm-v').getAttribute('aria-label')).toBe('Brust, Latissimus')
  })

  // A read-only map with no `hits` is silent: its shapes are hidden and nothing replaces them.
  // Right for decoration, a hole for content, so every call site has to say which it is. This
  // walks the tree rather than a list of files so a new one cannot slip in unnamed.
  it('gives every call site one of the three treatments', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = path.resolve(__dirname, '..')
    const files = []
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'locales') walk(p) } else if (/\.jsx$/.test(e.name) && !/\.test\.jsx$/.test(e.name)) files.push(p)
    })
    walk(src)
    const offenders = []
    for (const f of files) {
      if (f.endsWith('BodyMap.jsx') || f.endsWith('MiniBodyMap.jsx')) continue
      const rel = path.relative(src, f).split(path.sep).join('/')
      unnamedMaps(fs.readFileSync(f, 'utf8')).forEach(o => offenders.push(rel + ':' + o.line + '  ' + o.snippet.slice(0, 70)))
    }
    expect(offenders).toEqual([])
  })

  // The two ways that guard fails are silent, so they are tested rather than trusted. Every case
  // here was a live hole at some point while this was being written.
  it.each([
    ['a button that closed above the map', '<button aria-label="Open">Open</button>\n<BodyMap load={{}} />'],
    ['a sibling aria-hidden below the map', '<BodyMap load={{}} />\n<div aria-hidden="true" />'],
    ['a call site written over several lines', '<BodyMap\n  load={{}}\n  body="male"\n/>'],
  ])('still reports %s', (_case, source) => {
    expect(unnamedMaps(source)).toHaveLength(1)
  })

  it.each([
    ['a prop holding an arrow function', '<BodyMap load={{}} onMuscle={() => pick("chest")} />'],
    ['hits= on a line of its own', '<BodyMap\n  load={{}}\n  hits={["chest"]}\n/>'],
    ['a legend beside the map', '<BodyMap load={{}} hits={["chest"]} />\n<BodyMapLegend />'],
  ])('does not report %s', (_case, source) => {
    expect(unnamedMaps(source)).toHaveLength(0)
  })
})
