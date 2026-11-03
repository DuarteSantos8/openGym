// @vitest-environment happy-dom
/* Someone who installed openGym v1.0.0 (2026-07-20) and never cleared the app updates to this
 * build. Their phone still holds the state exactly as v1.0.0 saved it: a smaller DEF, the week as
 * one routine id per weekday (not a list), workouts with `routineId` instead of `routineIds`, sets
 * with no mode, cardio as minutes and speed, `exWeights` as { w, d }. The app overlays that on
 * today's DEF and every reader copes with the old shapes on its own; nothing migrates it in one
 * place. So this file holds a v1.0.0 state built from that release's own writers
 * (sheets.jsx doFinishWorkout, Plan.jsx, RoutineEdit.jsx at the tag) and checks what the user
 * would notice: the history is there and readable, the numbers are the same, the plan still
 * starts the right routine, and the next save, a sync and a backup keep all of it.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('./lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: vi.fn(() => Promise.reject(new Error('offline'))), beacon: vi.fn() }))

const clone = v => JSON.parse(JSON.stringify(v))
const BENCH = '0025', SQUAT = '0043', STEPMILL = '2311'

// ---- the state as v1.0.0 wrote it ----------------------------------------------------------
const set = (w, r, done = true) => ({ w, r, done })
const V1_STATE = {
  unit: 'kg', restSec: 120, sound: true, theme: 'dark', accent: 'lime', targetW: 78,
  bodyweight: [{ d: '2026-07-01', w: 81.2 }, { d: '2026-07-08', w: 80.4 }, { d: '2026-07-15', w: 79.9 }],
  routines: [
    { id: 'rA', name: 'Push day', emoji: '💪', ex: [{ id: BENCH, sets: 3, reps: 8, weight: 60 }, { id: STEPMILL, sets: 1, min: 15, speed: 6 }] },
    { id: 'rB', name: 'Legs', emoji: '🦵', ex: [{ id: SQUAT, sets: 5, reps: 5, weight: 100 }] },
  ],
  // One routine id per weekday (0 = Sunday), a rest day left out.
  week: { 1: 'rA', 3: 'rB', 5: 'rA' },
  dayPlan: { '2026-07-16': 'rest' },
  exWeights: { [BENCH]: { w: 65, d: '2026-07-13' }, [SQUAT]: { w: 105, d: '2026-07-15' } },
  workouts: [
    { id: 'old1', d: '2026-07-13', start: Date.UTC(2026, 6, 13, 17), end: Date.UTC(2026, 6, 13, 18), routineId: 'rA', name: 'Push day', bw: 80.4,
      entries: [{ id: BENCH, sets: [set(60, 8), set(62.5, 8), set(65, 6), set(65, 4, false)], topW: null }, { id: STEPMILL, sets: [{ min: 15, speed: 6, done: true }], topW: null }],
      prs: [BENCH], vol: 60 * 8 + 62.5 * 8 + 65 * 6 },
    { id: 'old2', d: '2026-07-15', start: Date.UTC(2026, 6, 15, 17), end: Date.UTC(2026, 6, 15, 18, 10), routineId: 'rB', name: 'Legs', bw: 79.9,
      entries: [{ id: SQUAT, sets: [set(100, 5), set(100, 5), set(105, 5), set(105, 5), set(105, 4)], topW: 105 }],
      prs: [], vol: 100 * 10 + 105 * 14 },
  ],
  active: null,
}

let useStore, DEF, H, views
const mounted = []
const render = el => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<MemoryRouter>{el}</MemoryRouter>))
  return host
}
// The store reads the saved copy when it is first imported, as on an app start: once, for all.
beforeAll(async () => {
  localStorage.clear()
  localStorage.setItem('gym_state_v1', JSON.stringify(V1_STATE))
  ;({ useStore, DEF } = await import('./store/useStore.js'))
  H = await import('./lib/history.js')
  views = {
    History: (await import('./views/History.jsx')).default,
    Stats: (await import('./views/Stats.jsx')).default,
    Plan: (await import('./views/Plan.jsx')).default,
  }
}, 120000)
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; document.body.innerHTML = '' })
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })
afterAll(() => localStorage.clear())

describe('a phone that has kept its v1.0.0 data updates to this build', () => {
  it('opens with every workout, routine and weigh-in it had, and today\'s settings filled in', () => {
    const S = useStore.getState().S
    expect(S.workouts.map(w => w.id)).toEqual(['old1', 'old2'])
    expect(S.routines.map(r => r.name)).toEqual(['Push day', 'Legs'])
    expect(S.bodyweight.map(b => b.w)).toEqual([81.2, 80.4, 79.9])
    expect(S.restSec).toBe(120)
    // Settings v1.0.0 did not have come from today's defaults rather than being missing.
    for (const k of ['customEx', 'measurements', 'favEx', 'gymCards']) expect(S[k]).toEqual(DEF[k])
  })

  it('counts the same: volume, sets done, best weight and the last sets of each lift', () => {
    const S = useStore.getState().S
    expect(H.workoutVolume(S.workouts[0])).toBe(60 * 8 + 62.5 * 8 + 65 * 6)   // the unchecked set left out
    expect(H.workoutVolume(S.workouts[1])).toBe(100 * 10 + 105 * 14)
    expect(H.bestWeightFor(S, SQUAT)).toBe(105)
    expect(H.bestWeightFor(S, BENCH)).toBe(65)
    expect(H.lastEntryFor(S, BENCH)?.sets?.filter(s => s.done).length).toBe(3)
  })

  it('still starts Monday\'s routine from the old one-id-per-day week, and keeps the rest day', () => {
    const S = useStore.getState().S
    const ids = d => H.effectiveRoutineIds(S, d)
    expect(ids('2026-07-20')).toEqual(['rA'])   // a Monday
    expect(ids('2026-07-22')).toEqual(['rB'])   // a Wednesday
    expect(ids('2026-07-21')).toEqual([])       // a Tuesday: nothing planned
    expect(ids('2026-07-16')).toEqual([])       // the day set to rest
  })

  it('draws History, Stats and the plan without throwing, with the old workouts in them', () => {
    const { History, Stats, Plan } = views
    const host = render(<History />)
    expect(host.textContent).toContain('Push day')
    expect(host.textContent).toContain('Legs')
    expect(render(<Stats />).textContent.length).toBeGreaterThan(0)
    expect(render(<Plan />).textContent).toContain('Push day')
  })

  // Last: it saves a change.
  it('keeps all of it through the next save, a sync with a server and a backup', async () => {
    const { mergeStates } = await import('./lib/sync-merge.js')
    act(() => useStore.getState().update(s => { s.restSec = 90 }))
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    const server = { ...clone(DEF), _ts: 1, workouts: [{ id: 'new1', d: '2026-10-01', start: 1, end: 2, entries: [] }] }
    for (const S of [saved, mergeStates(saved, server), mergeStates(server, saved), JSON.parse(JSON.stringify(saved))]) {
      expect(S.workouts.map(w => w.id)).toEqual(expect.arrayContaining(['old1', 'old2']))
      const old1 = S.workouts.find(w => w.id === 'old1')
      expect(old1.entries[0].sets).toEqual(V1_STATE.workouts[0].entries[0].sets)
      expect(old1.entries[1].sets).toEqual([{ min: 15, speed: 6, done: true }])
      expect(S.routines.find(r => r.id === 'rA').ex).toEqual(V1_STATE.routines[0].ex)
      expect(S.bodyweight.map(b => b.w)).toEqual([81.2, 80.4, 79.9])
    }
  })
})
