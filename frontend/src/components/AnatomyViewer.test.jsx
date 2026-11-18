// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ S: { workouts: [] } }))
vi.mock('../store/useStore.js', () => ({ useStore: sel => sel({ S: mocks.S }) }))
import AnatomyViewer from './AnatomyViewer.jsx'
import { muscleLevels3d } from '../lib/muscle-3d.js'
import { EXDB } from '../lib/exercises.js'
import { MUSCLES } from '../lib/muscles.js'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const day = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10)
const sq = EXDB.find(e => /squat/i.test(e.n || e.name || ''))?.id || EXDB[0].id
let host, root, scene, createScene, pick
beforeEach(() => {
  mocks.S = { workouts: [{ id: 'w1', d: day(1), entries: [{ id: sq, sets: [1, 2, 3].map(() => ({ w: 80, r: 5, done: true })) }] }] }
  scene = { setLevels: vi.fn(), highlight: vi.fn(), dispose: vi.fn() }
  createScene = vi.fn(async (el, opts) => { pick = opts.onPick; return scene })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async () => act(async () => { root.render(<AnatomyViewer createScene={createScene} now={NOW} />) })
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)
const click = async el => act(async () => { el.click() })

describe('the 3D muscle map (EP12)', () => {
  it('loads no WebGL or model until Show in 3D, yet lists every muscle with its level', async () => {
    await mount()
    expect(createScene).not.toHaveBeenCalled()
    expect(host.querySelectorAll('.addon-muscles li')).toHaveLength(MUSCLES.length)
    expect(host.textContent).toMatch(/Quads\s*(Light|Moderate|Solid|Most trained)/)
  })

  it('opens the scene from this build’s own model and paints the 2D map’s levels', async () => {
    await mount(); await click(btn('Show in 3D'))
    expect(createScene).toHaveBeenCalledTimes(1)
    expect(createScene.mock.calls[0][1].url).toMatch(/anatomy\/muscles\.glb$/)
    expect(createScene.mock.calls[0][1].url).not.toMatch(/https?:/)
    const expected = muscleLevels3d(mocks.S.workouts, { win: 7, now: NOW })
    expect(scene.setLevels).toHaveBeenLastCalledWith(expected)
  })

  it('a tapped muscle is picked in the list, and a picked list row lights the mesh', async () => {
    await mount(); await click(btn('Show in 3D'))
    await act(async () => { pick({ id: 'quadriceps' }) })
    const row = [...host.querySelectorAll('.addon-muscles button')].find(b => b.textContent.startsWith('Quads'))
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(scene.highlight).toHaveBeenLastCalledWith('quadriceps')
    await click([...host.querySelectorAll('.addon-muscles button')].find(b => b.textContent.startsWith('Calves')))
    expect(scene.highlight).toHaveBeenLastCalledWith('calves')
  })

  it('switching the window repaints with that window’s levels', async () => {
    await mount(); await click(btn('Show in 3D'))
    await act(async () => { const s = host.querySelector('select'); s.value = '30'; s.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(scene.setLevels).toHaveBeenLastCalledWith(muscleLevels3d(mocks.S.workouts, { win: 30, now: NOW }))
  })

  it('closing, or leaving the page, frees the scene', async () => {
    await mount(); await click(btn('Show in 3D')); await click(btn('Close 3D'))
    expect(scene.dispose).toHaveBeenCalledTimes(1)
    await click(btn('Show in 3D'))
    act(() => root.unmount()); root = createRoot(host)
    expect(scene.dispose).toHaveBeenCalledTimes(2)
  })

  it('without WebGL it says so and the list still carries the data', async () => {
    createScene = vi.fn(async () => { throw Object.assign(new Error('webgl'), { code: 'webgl' }) })
    await mount(); await click(btn('Show in 3D'))
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/cannot show 3D/)
    expect(host.querySelectorAll('.addon-muscles li')).toHaveLength(MUSCLES.length)
  })
})
