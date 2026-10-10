// @vitest-environment happy-dom
// A past workout's detail sheet. Discord (rubik_97): drop-set weights were counted in the volume
// but never listed, and supersets were not shown at all. Discord 'Improvement ideas': an exercise
// opens its own history from here, and the workout can be copied as text.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { workoutDetailSheet } from './sheets.jsx'
import { EXDB } from './lib/exercises-data.js'

const lifts = EXDB.filter(e => e.bp !== 'cardio' && e.eq === 'barbell').slice(0, 3).map(e => e.id)
const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []

function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

// A saved workout of the generic engine, written from v1-style entries: rows with a drop chain keep it
// as segments (each drop at its own load).
const perfRow = (s, over = {}) => ({
  role: s.phase === 'warmup' ? 'warmup' : 'work', status: s.done ? 'completed' : 'skipped',
  observations: [{ metric: 'repetitions', value: s.r }], resistance: { kind: 'external-load', value: s.w },
  segments: s.type === 'dropset' ? s.drops.map(d => perfRow({ ...d, done: true })) : [],
  ...(s.type === 'restpause' ? { clusters: s.clusters } : {}), ...over,
})
const exposureOf = (e, i) => ({
  exposureId: 'x' + i, exerciseId: e.id, mode: 'reps', ...(e.rid ? { routineId: e.rid } : {}), ...(e.sg ? { sg: e.sg } : {}),
  performance: { sets: e.sets.map(s => perfRow(s)) },
})
const workout = (entries, extra = {}) => ({
  id: 'w1', d: '2026-09-15', start: Date.UTC(2026, 8, 15, 17), end: Date.UTC(2026, 8, 15, 18), name: 'Push',
  vol: 0, prs: [], routineIds: [], exposures: entries.map(exposureOf), ...extra,
})
const done = (w, r, more = {}) => ({ w, r, done: true, ...more })

let toast
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  toast = vi.fn()
  useUI.setState({ sheets: [], toast })
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', routines: [], workouts: [], active: null })
  useStore.setState({ S, A: null, user: null })
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  vi.unstubAllGlobals()
})

describe('workout detail', () => {
  it('lists a drop-set\'s drops and a rest-pause set\'s bursts', () => {
    workoutDetailSheet(workout([
      { id: lifts[0], target: { mode: 'reps' }, sets: [done(100, 8, { type: 'dropset', drops: [{ w: 80, r: 6 }, { w: 60, r: 5 }] })] },
      { id: lifts[1], target: { mode: 'reps' }, sets: [done(60, 16, { type: 'restpause', clusters: [{ r: 10, restSec: 15 }, { r: 4, restSec: 15 }, { r: 2, restSec: 15 }] })] },
    ]))
    const rows = [...mountTopSheet().querySelectorAll('.wd-ex .ss')].map(el => el.textContent)
    expect(rows).toEqual(['100×8 ↘ 80×6 ↘ 60×5', '60×10+4+2'])
  })

  it('keeps a superset together under one label, in a flat and in a combined workout', () => {
    const entries = [
      { id: lifts[0], sg: 'sg1', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], sg: 'sg1', target: { mode: 'reps' }, sets: [done(20, 12)] },
      { id: lifts[2], target: { mode: 'reps' }, sets: [done(60, 5)] },
    ]
    workoutDetailSheet(workout(entries))
    let host = mountTopSheet()
    let groups = host.querySelectorAll('.wd-ss')
    expect(groups).toHaveLength(1)
    expect(groups[0].querySelector('.ss-label').textContent).toBe('Superset')
    expect(groups[0].querySelectorAll('.wd-ex')).toHaveLength(2)
    expect(host.querySelectorAll('.wd-ex')).toHaveLength(3)

    useUI.setState({ sheets: [] })
    const combined = entries.map((e, i) => ({ ...e, rid: i < 2 ? 'A' : 'B' }))
    workoutDetailSheet(workout(combined, { routineIds: ['A', 'B'] }))
    host = mountTopSheet()
    expect(host.textContent).toContain('Freestyle')           // routines since deleted
    expect(host.querySelectorAll('.wd-ss .wd-ex')).toHaveLength(2)
  })

  it('shows an unpaired exercise without a superset label', () => {
    workoutDetailSheet(workout([
      { id: lifts[0], sg: 'sg1', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], target: { mode: 'reps' }, sets: [done(20, 12)] },
    ]))
    expect(mountTopSheet().querySelector('.wd-ss')).toBeNull()
  })

  it('opens the exercise\'s history from its row', () => {
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5)] }])
    useStore.setState(s => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const row = mountTopSheet().querySelector('.wd-ex')
    expect(row.getAttribute('role')).toBe('button')
    act(() => { row.click() })
    expect(useUI.getState().sheets).toHaveLength(2)
    const history = mountTopSheet()
    expect(history.textContent).toContain('Exercise history')
    expect(history.textContent).toContain('60×5')
  })

  it('copies the workout as text, with the note as it stands in the box', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5, { phase: 'warmup' }), done(80, 5)] }])
    useStore.setState(s => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host = mountTopSheet()
    const note = host.querySelector('textarea')
    act(() => {
      Object.getOwnPropertyDescriptor(note.constructor.prototype, 'value').set.call(note, 'Good day')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { button(host, 'Copy as text').click() })
    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0][0]
    expect(text.split('\n')[0]).toMatch(/^Push · /)
    expect(text).toContain('\n80×5\n')
    expect(text).not.toContain('60×5')
    expect(text.endsWith('\n\nGood day')).toBe(true)
    expect(toast).toHaveBeenCalledWith('Copied')
  })

  // One rule for both: a superset paired across two routines of a combined session is shown apart
  // in the sheet, each under its own routine, and the copied text does not call it a superset.
  it('groups a combined session\'s supersets the same way in the sheet and in the copied text', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const w = workout([
      { id: lifts[0], rid: 'A', sg: 'x', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], rid: 'B', sg: 'x', target: { mode: 'reps' }, sets: [done(20, 12)] },
      { id: lifts[2], rid: 'B', target: { mode: 'reps' }, sets: [done(60, 5)] },
    ], { routineIds: ['A', 'B'] })
    useStore.setState(s => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host = mountTopSheet()
    expect(host.querySelector('.wd-ss')).toBeNull()
    expect(host.querySelectorAll('.wd-ex')).toHaveLength(3)
    await act(async () => { button(host, 'Copy as text').click() })
    expect(writeText.mock.calls[0][0]).not.toContain('Superset')
  })

  it('says so when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    document.execCommand = () => false
    workoutDetailSheet(workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5)] }]))
    const host = mountTopSheet()
    await act(async () => { button(host, 'Copy as text').click() })
    expect(toast).toHaveBeenCalledWith('Could not copy')
    delete document.execCommand
  })
})

// #447: the workout as a Garmin .fit activity, saved as a download in the browser.
describe('export as .fit', () => {
  it('saves the saved record as a .fit file named after its day and time', async () => {
    const blobs = []
    const createObjectURL = vi.fn(blob => { blobs.push(blob); return 'blob:fit' })
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL: vi.fn() }))
    const clicked = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked.push(this.download) })
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5), done(60, 5)] }])
    useStore.setState(s => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host = mountTopSheet()
    await act(async () => { button(host, 'Export as .fit file').click() })
    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toMatch(/^opengym-2026-09-15-\d{4}\.fit$/)
    const bytes = new Uint8Array(await blobs[0].arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('.FIT')
    expect(toast).toHaveBeenCalledWith('Saved. Garmin Connect can take it from here.')
    click.mockRestore()
  })

  it('says so when the workout cannot be written', async () => {
    workoutDetailSheet({ id: 'x', name: 'Nowhen', entries: [], prs: [] })
    const host = mountTopSheet()
    await act(async () => { button(host, 'Export as .fit file').click() })
    expect(toast).toHaveBeenCalledWith('Could not create the file')
  })
})

// #143: the detail sheet is the door to the editor, which opens a draft of this workout in A.
describe('editing a saved workout from its detail sheet', () => {
  it('opens the editor on the workout\'s own rows, and not while a session runs', () => {
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5)] }])
    useStore.setState(s => ({ S: { ...s.S, workouts: [w] }, A: null }))
    workoutDetailSheet(w)
    const host = mountTopSheet()   // mounted before the click's own act(), or it renders only after
    act(() => { button(host, 'Edit workout').click() })
    const A = useStore.getState().A
    expect(A).toMatchObject({ editingWorkoutId: 'w1', entries: [{ id: lifts[0], sets: [{ w: 60, r: 5, done: true }] }] })
    expect(useStore.getState().S.workouts).toEqual([w])

    useUI.setState({ sheets: [] })
    workoutDetailSheet(w)
    expect(button(mountTopSheet(), 'Edit workout').disabled).toBe(true)
  })
})

describe('an exercise note on a saved workout', () => {
  it('is shown under its exercise, flagged when pinned', () => {
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5)] }])
    w.exposures[0].performance = { ...w.exposures[0].performance, note: 'go narrower', notePin: true }
    workoutDetailSheet(w)
    const row = mountTopSheet().querySelector('.wd-ex')
    expect(row.textContent).toContain('go narrower')
  })
})
