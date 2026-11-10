// @vitest-environment happy-dom
// Seasonal themes cost nothing when they are not showing (components/Seasonal.jsx): the theme's
// module is not in the main bundle, and it is not even fetched until a theme is on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const st = vi.hoisted(() => ({ S: {}, loaded: 0, xmas: 0, tour: false }))
vi.mock('../store/useStore.js', () => ({ useStore: sel => sel({ S: st.S }) }))
vi.mock('../lib/tour.js', () => ({ useTourRunning: () => st.tour }))
vi.mock('../seasonal/halloween.jsx', () => {
  st.loaded++
  return { Layer: () => <i className="layer" />, Deco: ({ spot }) => <i className={'deco-' + spot} /> }
})
vi.mock('../seasonal/christmas.jsx', () => {
  st.xmas++
  return {
    Layer: ({ hidden, workout }) => <i className={'xlayer' + (hidden ? ' hidden' : '') + (workout ? ' workout' : '')} />,
    Deco: ({ spot }) => <i className={'xdeco-' + spot} />,
    open: what => { st.opened = what; return true },
  }
})

const SRC = join(__dirname, '..')
const files = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== 'locales' && n !== 'node_modules') files(p, out) }
    else if (/\.(js|jsx)$/.test(n) && !/\.test\./.test(n)) out.push(p)
  }
  return out
}

describe('no theme code in the main bundle', () => {
  it.each(['halloween', 'christmas'])('only components/Seasonal.jsx names a theme module, and only through import() (%s)', id => {
    const re = new RegExp('seasonal/' + id + '|seasonal/advent-doors')
    const naming = files(SRC).filter(f => !f.includes(join('src', 'seasonal') + '/')).filter(f => re.test(readFileSync(f, 'utf8')))
    expect(naming.map(f => relative(SRC, f))).toEqual([join('components', 'Seasonal.jsx')])
    const text = readFileSync(join(SRC, 'components', 'Seasonal.jsx'), 'utf8')
    expect(text).not.toMatch(new RegExp('^\\s*import[^(]*seasonal/' + id, 'm'))
    expect(text).toContain(`import('../seasonal/${id}.jsx')`)
  })
  it('the theme\'s stylesheet comes with its module, not with index.css', () => {
    expect(readFileSync(join(SRC, 'index.css'), 'utf8')).not.toMatch(/hw-|halloween|xm-|christmas/)
    expect(readFileSync(join(SRC, 'seasonal', 'halloween.jsx'), 'utf8')).toMatch(/import '\.\/halloween\.css'/)
    expect(readFileSync(join(SRC, 'seasonal', 'christmas.jsx'), 'utf8')).toMatch(/import '\.\/christmas\.css'/)
  })
})

describe('fetched only while a theme shows', () => {
  let host, root
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 25, 12))
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); delete document.documentElement.dataset.season; st.tour = false })

  it('switched off in season: nothing rendered, nothing loaded, no data-season', async () => {
    st.S = { seasonal: { halloween: 'off' } }
    const { SeasonalLayer, SeasonDeco } = await import('./Seasonal.jsx')
    await act(async () => root.render(<><SeasonalLayer /><SeasonDeco spot="home-hero" /></>))
    expect(host.innerHTML).toBe('')
    expect(st.loaded).toBe(0)
    expect(document.documentElement.dataset.season).toBeUndefined()
  })

  it('a workout spot stays empty with Also during workouts switched off, and nothing is fetched for it', async () => {
    st.S = { seasonal: { halloweenWorkout: false } }
    const { SeasonDeco } = await import('./Seasonal.jsx')
    await act(async () => root.render(<SeasonDeco spot="workout-hdr" workout />))
    expect(host.innerHTML).toBe('')
    expect(st.loaded).toBe(0)
  })

  it('out of season on Auto: the same', async () => {
    vi.setSystemTime(new Date(2026, 10, 15, 12))   // mid-November: between Halloween and Christmas
    st.S = {}
    const { SeasonalLayer } = await import('./Seasonal.jsx')
    await act(async () => root.render(<SeasonalLayer />))
    expect(host.innerHTML).toBe('')
    expect(st.loaded).toBe(0)
    expect(st.xmas).toBe(0)
  })

  it('on: the module comes in and draws its spots', async () => {
    vi.useRealTimers()
    st.S = { seasonal: { halloween: 'on' } }
    const { SeasonalLayer, SeasonDeco } = await import('./Seasonal.jsx')
    const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }
    await act(async () => root.render(<SeasonDeco spot="home-hero" />))
    await settle()
    expect(st.loaded).toBe(1)
    expect(host.querySelector('.deco-home-hero')).not.toBeNull()
    await act(async () => root.render(<><SeasonDeco spot="home-hero" /><SeasonalLayer /></>))
    await settle()
    expect(host.querySelector('.layer')).not.toBeNull()
    expect(document.documentElement.dataset.season).toBe('halloween')
  })

  it('December on Auto: the Christmas module, not Halloween\'s', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 11, 5, 12))
    st.S = {}
    const before = st.loaded
    const { SeasonalLayer, SeasonDeco } = await import('./Seasonal.jsx')
    const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }
    await act(async () => root.render(<SeasonDeco spot="home-advent" />))
    await settle()
    await act(async () => root.render(<><SeasonDeco spot="home-advent" /><SeasonalLayer /></>))
    await settle()
    expect(st.xmas).toBe(1)
    expect(st.loaded).toBe(before)
    expect(host.querySelector('.xdeco-home-advent')).not.toBeNull()
    expect(document.documentElement.dataset.season).toBe('christmas')
  })

  it('on the workout screen the layer is told whether "Also during workouts" is on', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 11, 5, 12))
    const { SeasonalLayer } = await import('./Seasonal.jsx')
    const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }
    st.S = {}
    await act(async () => root.render(<SeasonalLayer hidden />))
    await settle()
    expect(host.querySelector('.xlayer.hidden.workout')).not.toBeNull()
    st.S = { seasonal: { christmasWorkout: false } }
    await act(async () => root.render(<SeasonalLayer hidden key="b" />))
    await settle()
    expect(host.querySelector('.xlayer.hidden')).not.toBeNull()
    expect(host.querySelector('.xlayer.workout')).toBeNull()
  })

  it('while the app tour runs: nothing at all, the layer and every spot step aside', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 11, 5, 12))
    st.S = {}
    st.tour = true
    const { SeasonalLayer, SeasonDeco } = await import('./Seasonal.jsx')
    await act(async () => root.render(<><SeasonalLayer /><SeasonDeco spot="home-advent" /><SeasonDeco spot="home-streak" /></>))
    expect(host.innerHTML).toBe('')
    expect(document.documentElement.dataset.season).toBeUndefined()
  })

  it('Off in December: nothing, and the Christmas module is never fetched', async () => {
    vi.setSystemTime(new Date(2026, 11, 5, 12))
    st.S = { seasonal: { christmas: 'off' } }
    const before = st.xmas
    const { SeasonalLayer, SeasonDeco } = await import('./Seasonal.jsx')
    await act(async () => root.render(<><SeasonalLayer /><SeasonDeco spot="home-advent" /></>))
    expect(host.innerHTML).toBe('')
    expect(st.xmas).toBe(before)
  })

  it('openSeasonal reaches the theme\'s own open()', async () => {
    const { openSeasonal } = await import('./Seasonal.jsx')
    expect(await openSeasonal('christmas', 'advent')).toBe(true)
    expect(st.opened).toBe('advent')
    expect(await openSeasonal('nope', 'advent')).toBe(false)
  })
})
