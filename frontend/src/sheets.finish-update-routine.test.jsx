// @vitest-environment happy-dom
// The finish summary's Update routine (lib/routine-update.js): a session that swapped, dropped or
// reordered its routine's exercises offers to make the routine match, after a preview. The saved
// workout is never touched, closing the summary without the tap changes nothing, and the update
// is one change with an Undo.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkoutNow, beginWorkout, swapActiveWorkoutToBackup } from './sheets.jsx'
import { EXIDX } from './lib/exercises.js'
import { exerciseNameText } from './lib/format.js'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []

function renderTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const settle = () => act(async () => {})
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const name = id => exerciseNameText(EXIDX[id])

const routine = () => ({ id: 'r1', name: 'Pull A', ex: [
  { id: '0198', sets: 3, reps: 12, repsMin: 8, weight: 50, restSec: 90, note: 'Pause at the chest' },
  { id: '0027', sets: 3, reps: 8, weight: 60 },
  { id: '0313', sets: 3, reps: 12, weight: 14 },
] })
const done = (w, n = 3) => Array.from({ length: n }, () => ({ w, r: 10, done: true }))
// The lat pulldown swapped for pull-ups (slot 0), the row done, the hammer curl taken out.
const swapped = { id: '0652', rid: 'r1', slotAt: 0, target: { sets: 3, reps: 12, weight: 0 }, sets: done(0) }
const row = { id: '0027', rid: 'r1', slotAt: 1, target: { sets: 3, reps: 8, weight: 60 }, sets: done(60) }
const raise = { id: '0334', rid: 'r1', addedInSession: true, target: { sets: 2, reps: 12, weight: 8 }, sets: done(8, 2) }

function install(entries) {
  const st = clone(DEF)
  st.routines = [routine()]
  st.active = {
    id: 'fin', d: '2026-11-19', start: Date.now() - 30 * 60000, routineIds: ['r1'], name: 'Pull A', bw: null, cur: 0,
    entries, startSlots: { r1: ['0198', '0027', '0313'] },
  }
  useStore.setState({ S: st, user: null })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null, toastAction: null })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
})

describe('finish summary: update the routine from the session', () => {
  it('offers the update with a preview, and the tap rewrites only the routine', async () => {
    install([clone(swapped), clone(row), clone(raise)])
    act(() => finishWorkoutNow())
    const summary = renderTopSheet()
    await settle()
    const offer = summary.querySelector('[data-update-routine]')
    expect(offer).toBeTruthy()
    expect(offer.textContent).toContain(`Swap: ${name('0198')} → ${name('0652')}`)
    expect(offer.textContent).toContain(`Removed: ${name('0313')}`)
    expect(offer.textContent).toContain(`Added: ${name('0334')}`)
    // The addition is part of the update, not a second button beside it.
    expect(summary.querySelector('[data-keep-in-routine]')).toBeNull()
    // Nothing changed yet.
    expect(S().routines[0]).toEqual(routine())
    const saved = JSON.stringify(S().workouts.at(-1))

    act(() => button(summary, 'Update “Pull A”').click())
    const preview = renderTopSheet()
    expect(preview.querySelector('[data-update-routine-preview]')).toBeTruthy()
    expect(preview.textContent).toContain('This workout stays as you logged it.')
    expect(S().routines[0]).toEqual(routine())
    act(() => button(preview, 'Update routine').click())

    const now = S().routines[0]
    expect(now.ex.map(x => x.id)).toEqual(['0652', '0027', '0334'])
    // The pull-ups took over the slot's settings; bodyweight, so no load carried.
    expect(now.ex[0]).toMatchObject({ sets: 3, reps: 12, repsMin: 8, restSec: 90, note: 'Pause at the chest', weight: 0 })
    // Stamped like any routine edit, so other devices merge it.
    expect(now._ts).toBeGreaterThan(0)
    expect(now._f?.ex).toBeGreaterThan(0)
    // The workout history is as it was saved.
    expect(JSON.stringify(S().workouts.at(-1))).toBe(saved)
    expect(JSON.stringify(S().workouts.at(-1))).not.toMatch(/slotAt|startSlots|swapPlan/)
    await settle()
    expect(summary.textContent).toContain('“Pull A” now matches this workout')

    // One change, one Undo.
    const undo = useUI.getState().toastAction
    expect(undo?.label).toBe('Undo')
    act(() => undo.run())
    expect(S().routines[0].ex).toEqual(routine().ex)
    expect(JSON.stringify(S().workouts.at(-1))).toBe(saved)
  })

  it('leaves the routine alone when the summary is closed without the tap', async () => {
    install([clone(swapped), clone(row)])
    act(() => finishWorkoutNow())
    const summary = renderTopSheet()
    await settle()
    expect(summary.querySelector('[data-update-routine]')).toBeTruthy()
    act(() => summary.querySelector('.fin-x button').click())
    expect(S().routines[0]).toEqual(routine())
  })

  it('says nothing when the session followed the routine, and keeps "New in this workout" for additions alone', async () => {
    const curl = { id: '0313', rid: 'r1', slotAt: 2, target: { sets: 3, reps: 12, weight: 14 }, sets: done(14) }
    const pulldown = { id: '0198', rid: 'r1', slotAt: 0, target: { sets: 3, reps: 12, weight: 50 }, sets: done(50) }
    install([clone(pulldown), clone(row), clone(curl), clone(raise)])
    act(() => finishWorkoutNow())
    const summary = renderTopSheet()
    await settle()
    expect(summary.querySelector('[data-update-routine]')).toBeNull()
    expect(summary.querySelector('[data-keep-in-routine]')).toBeTruthy()
  })
})

describe('the session keeps what an update reads', () => {
  it('a workout started from a routine knows its slots, and a backup swap keeps the slot', () => {
    const st = clone(DEF)
    st.routines = [routine()]
    st.routines[0].ex[0].subs = ['0652']
    useStore.setState({ S: st, user: null })
    act(() => beginWorkout(['r1'], null))
    expect(S().active.startSlots).toEqual({ r1: ['0198', '0027', '0313'] })
    expect(S().active.entries.map(e => e.slotAt)).toEqual([0, 1, 2])
    act(() => swapActiveWorkoutToBackup(0, '0652'))
    expect(S().active.entries[0]).toMatchObject({ id: '0652', slotAt: 0, rid: 'r1' })
    // The backup opened at the slot's plan: nothing of its own to keep.
    expect(S().active.entries[0].swapPlan).toBeUndefined()
  })
})
