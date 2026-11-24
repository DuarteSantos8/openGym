// @vitest-environment happy-dom
// The exercise sheet (Ironvane redesign, step 4): Last · Best · estimated 1RM as tiles, how to do
// it in one block, Add to this workout / Start workout and Add to my plan as the main buttons,
// the picture switch when there is more than one, and the one-time settings folded under
// "Setup for this exercise".
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { exerciseDetailSheet } from './sheets.jsx'
import { EXIDX } from './lib/exercises.js'
import { resetPictureIndex, DEMO_BASE } from './lib/exercise-pictures.js'

vi.mock('./lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
bindUI(useUI)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BENCH = '0025', SQUAT = '0043'
const clip = { kind: 'video', hash: 'a'.repeat(64), mime: 'video/mp4', size: 1000, width: 720, height: 1280, dur: 6,
  poster: { hash: 'f'.repeat(64), mime: 'image/webp', size: 100, width: 360, height: 640 } }
let root, host
beforeEach(() => {
  const S = structuredClone(DEF)
  Object.assign(S, { unit: 'kg', weighIn: false })
  useStore.setState({ S, user: null, config: null })
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); resetPictureIndex() })
// Demonstration media for the bench press only (catalogue/demos/index.json's shape).
const DEMOS = { [BENCH]: [
  { kind: 'video', f: 'files/video-0025.mp4', poster: 'files/video-0025.webp', w: 720, h: 1280, license: 'CC-BY-SA-4.0', author: 'Your Move', source: 'https://example.org/v' },
  { kind: 'image', pose: 'sequence', f: 'files/atp-14-6.webp', caption: 'Figure 14-6', license: 'PD-USGov', author: 'U.S. Army (ATP 7-22.02)', source: 'https://example.org/atp' },
] }
const withDemos = () => vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () => (String(url).startsWith(DEMO_BASE) ? DEMOS : {}) })))
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

const patch = p => useStore.setState(s => ({ S: { ...s.S, ...p } }))
const open = id => {
  exerciseDetailSheet(EXIDX[id])
  const sheet = useUI.getState().sheets.at(-1)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const history = () => patch({ workouts: [{ id: 'w1', d: '2026-10-01', name: 'Push', entries: [{ id: BENCH, sets: [
  { w: 40, r: 10, done: true, warmup: true }, { w: 60, r: 8, done: true }, { w: 60, r: 9, done: true }, { w: 55, r: 10, done: true }] }] }] })

describe('the exercise sheet (redesign step 4)', () => {
  it('shows last time’s top work set, the best weight and the estimated 1RM as tiles', () => {
    history()
    open(BENCH)
    const vals = [...host.querySelectorAll('.ex-nums .ex-num-v')].map(e => e.textContent)
    expect(vals[0]).toBe('60×9')            // the heaviest work set, more reps breaking the tie
    expect(vals[1]).toMatch(/^60\s?kg$/)
    expect(vals[2]).toMatch(/kg$/)
    expect(vals[2]).not.toBe('–')
  })
  it('the 1RM tile opens the calculator, before there is any history too', () => {
    open(BENCH)
    expect(host.querySelector('.ex-calc')).toBeNull()
    const tile = host.querySelector('.ex-nums button[aria-expanded]')
    expect(tile.getAttribute('aria-expanded')).toBe('false')
    act(() => tile.click())
    expect(host.querySelector('.ex-calc').textContent).toContain('Estimated 1RM')
    expect(tile.getAttribute('aria-expanded')).toBe('true')
  })
  it('keeps the description, the steps and the YouTube search in one block', async () => {
    open(BENCH)
    // The steps arrive in their own chunk the first time a sheet asks (useLang).
    await vi.waitFor(() => expect(host.querySelectorAll('.ex-learn .steps-list li').length).toBeGreaterThan(0), { timeout: 5000 })
    const learn = host.querySelector('.ex-learn')
    expect(learn.querySelector('h4').textContent).toContain('How to')
    expect(learn.querySelector('.exnote')).not.toBeNull()
    expect([...learn.querySelectorAll('button')].some(b => b.textContent.includes('Watch on YouTube'))).toBe(true)
  })
  it('with no workout running, starts one with this exercise', () => {
    open(BENCH)
    act(() => btn('Start workout').click())
    const A = useStore.getState().S.active
    expect(A.entries.map(e => e.id)).toEqual([BENCH])
    expect(A.name).toBe('Freestyle')
  })
  it('during a workout, adds the exercise after the current one', () => {
    patch({ active: { id: 'a', d: '2026-10-09', start: Date.now(), routineIds: [], name: 'Freestyle', bw: null, cur: 0,
      workoutView: 'cards', entries: [{ id: SQUAT, target: { mode: 'reps', sets: 1, reps: 5 }, sets: [{ w: 100, r: 5, done: false }] }] } })
    open(BENCH)
    expect(btn('Start workout')).toBeUndefined()
    act(() => btn('Add to this workout').click())
    const A = useStore.getState().S.active
    expect(A.entries.map(e => e.id)).toEqual([SQUAT, BENCH])
    expect(A.cur).toBe(1)
    expect(useUI.getState().toastMsg).toContain('added')
  })
  it('in a workout that already has it, the plan is the one main button', () => {
    patch({ active: { id: 'a', d: '2026-10-09', start: Date.now(), routineIds: [], name: 'Freestyle', bw: null, cur: 0,
      workoutView: 'cards', entries: [{ id: BENCH, target: { mode: 'reps', sets: 1, reps: 5 }, sets: [{ w: 60, r: 5, done: false }] }] } })
    open(BENCH)
    expect(btn('Add to this workout')).toBeUndefined()
    expect(host.querySelector('.ex-acts').classList.contains('one')).toBe(true)
    expect(btn('Add to my plan').className).toContain('primary')
  })
  it('folds the one-time settings under Setup, where the tour points', () => {
    open(BENCH)
    const setup = host.querySelector('.ex-setup')
    expect(setup.getAttribute('data-tour')).toBe('ex-unit')
    expect(host.textContent).not.toContain('Plate loading')
    const head = setup.querySelector('.ex-setup-h')
    expect(head.textContent).toContain('Setup for this exercise')
    act(() => head.click())
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(setup.textContent).toContain('Weight unit')
    expect(setup.textContent).toContain('Plate loading')
    expect(setup.querySelector('.exalias-link')).not.toBeNull()
  })
  it('switches between the animation and your own clip above the picture', () => {
    patch({ exMedia: { [BENCH]: { m: clip, show: 'own', _ts: 1 } } })
    open(BENCH)
    const seg = host.querySelector('.ex-media-seg')
    expect([...seg.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Animation', 'Yours'])
    expect(host.querySelector('.own-flip')).toBeNull()      // the sheet's switch replaces the flip
    act(() => [...seg.querySelectorAll('button')][0].click())
    expect(useStore.getState().S.exMedia[BENCH].show).toBe('stock')
  })
  it('offers Video and Steps when the exercise has demonstrations, credited under each', async () => {
    withDemos()
    open(BENCH)
    await settle()
    const seg = host.querySelector('.ex-media-seg')
    expect([...seg.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Video', 'Steps', 'Animation'])
    act(() => [...seg.querySelectorAll('button')][0].click())
    const v = host.querySelector('.expics-video video')
    expect(v.getAttribute('src')).toBe(DEMO_BASE + 'files/video-0025.mp4')
    expect(host.querySelector('.expics-title')).toBeNull()        // the switch names it
    expect(host.querySelector('.expics figcaption').textContent).toContain('Your Move')
    act(() => [...seg.querySelectorAll('button')][1].click())
    expect(host.querySelector('.expics-video')).toBeNull()
    expect(host.querySelector('.expics-seq img').getAttribute('src')).toBe(DEMO_BASE + 'files/atp-14-6.webp')
    act(() => [...seg.querySelectorAll('button')][2].click())
    expect(host.querySelector('.expics')).toBeNull()
  })
  it('shows no switch with only the animation', () => {
    open(BENCH)
    expect(host.querySelector('.ex-media-seg')).toBeNull()
  })
})
