// @vitest-environment happy-dom
// Seasonal themes cost nothing when they are not showing (components/Seasonal.jsx): the theme's
// module is not in the main bundle, and it is not even fetched until a theme is on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const st = vi.hoisted(() => ({ S: {}, loaded: 0 }))
vi.mock('../store/useStore.js', () => ({ useStore: sel => sel({ S: st.S }) }))
vi.mock('../seasonal/halloween.jsx', () => {
  st.loaded++
  return { Layer: () => <i className="layer" />, Deco: ({ spot }) => <i className={'deco-' + spot} /> }
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
  it('only components/Seasonal.jsx names a theme module, and only through import()', () => {
    const naming = files(SRC).filter(f => !f.includes(join('src', 'seasonal') + '/')).filter(f => /seasonal\/halloween/.test(readFileSync(f, 'utf8')))
    expect(naming.map(f => relative(SRC, f))).toEqual([join('components', 'Seasonal.jsx')])
    const text = readFileSync(join(SRC, 'components', 'Seasonal.jsx'), 'utf8')
    expect(text).not.toMatch(/^\s*import[^(]*seasonal\/halloween/m)
    expect(text).toMatch(/import\('\.\.\/seasonal\/halloween\.jsx'\)/)
  })
  it('the theme\'s stylesheet comes with its module, not with index.css', () => {
    expect(readFileSync(join(SRC, 'index.css'), 'utf8')).not.toMatch(/hw-|halloween/)
    expect(readFileSync(join(SRC, 'seasonal', 'halloween.jsx'), 'utf8')).toMatch(/import '\.\/halloween\.css'/)
  })
})

describe('fetched only while a theme shows', () => {
  let host, root
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 25, 12))
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); delete document.documentElement.dataset.season })

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
    vi.setSystemTime(new Date(2026, 11, 3, 12))
    st.S = {}
    const { SeasonalLayer } = await import('./Seasonal.jsx')
    await act(async () => root.render(<SeasonalLayer />))
    expect(host.innerHTML).toBe('')
    expect(st.loaded).toBe(0)
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
})
