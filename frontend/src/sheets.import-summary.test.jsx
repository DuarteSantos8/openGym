// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { importFromApp } from './sheets.jsx'
import { fmtDateRange } from './lib/format.js'

// The import summary's date range said "Sun, 3 Feb – Sun, 21 Dec" for a history that ran over
// two years: without the year, a span across a new year read as a few months.
const HEAD = 'Date,Exercise,Weight,Reps'
const csv = (...days) => [HEAD, ...days.map(d => `${d},Bench Press,60,5`)].join('\n')
let root, host

async function summaryFor(text) {
  const file = new File([text], 'export.csv', { type: 'text/csv' })
  importFromApp(file)
  for (let i = 0; i < 50 && !useUI.getState().sheets.length; i++) await new Promise(r => setTimeout(r, 5))
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet).toBeTruthy()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(sheet.render(() => {})))
  return host.querySelector('.muted.small').textContent
}

describe('the import summary’s dates', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], bodyweight: [] } }))
  })
  afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = '' })

  it('carry the year when the history spans two years', async () => {
    const text = await summaryFor(csv('2025-02-03', '2026-01-21'))
    expect(text).toContain('2025')
    expect(text).toContain('2026')
  })

  it('carry the year for a range that is not this year', () => {
    const now = new Date('2026-09-28T12:00:00')
    expect(fmtDateRange('2024-03-01', '2024-05-01', false, now)).toContain('2024')
    expect(fmtDateRange('2026-03-01', '2026-05-01', false, now)).not.toContain('2026')
    expect(fmtDateRange('2026-03-01', '2026-03-01', false, now)).not.toContain('–')
  })
})

// QA 10-06: the summary never said how many rows it had left out, and every count read "1 workouts
// imported", "1 sets bring an RPE".
describe('the import summary’s counts', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], bodyweight: [], wc: { ...s.S.wc, effort: 'rpe' } } }))
  })
  afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = '' })
  const lines = () => [...host.querySelectorAll('.small.dim')].map(d => d.textContent)

  it('says how many rows were skipped, singular and plural, and nothing when none were', async () => {
    await summaryFor([HEAD, '2026-01-02,Bench Press,60,5', 'not a date,Bench Press,60,5'].join('\n'))
    expect(lines()).toContain('1 row skipped (couldn’t read it)')
    act(() => root.unmount()); document.body.innerHTML = ''; useUI.setState({ sheets: [] })
    await summaryFor([HEAD, '2026-01-02,Bench Press,60,5', 'nope,Bench Press,60,5', '2026-01-03,,60,5'].join('\n'))
    expect(lines()).toContain('2 rows skipped (couldn’t read them)')
    act(() => root.unmount()); document.body.innerHTML = ''; useUI.setState({ sheets: [] })
    await summaryFor(csv('2026-01-02'))
    expect(lines().some(l => /skipped/.test(l))).toBe(false)
  })

  it('counts one workout and one rated set in the singular', async () => {
    await summaryFor(['Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Seconds,RPE', '2026-01-02 10:00:00,Push,Bench Press (Barbell),1,60,5,0,8'].join('\n'))
    expect(lines().join(' ')).toMatch(/\b1 set brings an RPE with it\./)
    const importBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Import')
    act(() => importBtn.click())
    expect(useUI.getState().toastMsg).toBe('1 workout imported')
  })
})

// 1.4.4 (#862): Liftosaur's JSON brings its programs, which arrive as routines beside the history.
describe('the import summary with routines', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], routines: [], customEx: [], bodyweight: [] } }))
  })
  afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = '' })

  const liftosaur = JSON.stringify({
    version: '1', settings: {}, stats: {},
    history: [{ vtype: 'history_record', id: 1, date: '2026-04-02T16:00:00.000Z', startTime: Date.parse('2026-04-02T16:00:00.000Z'), programId: 'p', programName: 'Basic', day: 1, dayName: 'A',
      entries: [{ vtype: 'history_entry', id: 'e', index: 0, exercise: { id: 'squat' }, warmupSets: [], sets: [{ vtype: 'set', index: 0, id: 's', completedReps: 5, completedWeight: { value: 100, unit: 'kg' }, isCompleted: true }] }] }],
    programs: [{ vtype: 'program', id: 'p', name: 'Basic', planner: { vtype: 'planner', name: 'Basic', weeks: [{ name: 'Week 1', days: [
      { name: 'A', exerciseText: 'Squat / 3x5 / 100kg / progress: lp(2.5kg)' }, { name: 'B', exerciseText: 'Deadlift / 1x5 / 140kg' }] }] } }],
  })

  it('shows the routines, says the script stays a note, and imports both', async () => {
    const file = new File([liftosaur], 'liftosaur.json', { type: 'application/json' })
    importFromApp(file)
    for (let i = 0; i < 50 && !useUI.getState().sheets.length; i++) await new Promise(r => setTimeout(r, 5))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(useUI.getState().sheets.at(-1).render(() => {})))
    expect(host.querySelector('h3').textContent).toBe('Import from Liftosaur')
    expect(host.textContent).toContain('Routines')
    expect(host.textContent).toContain('Liftoscript progressions come along as notes on the exercises.')
    const importBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Import')
    act(() => importBtn.click())
    expect(useUI.getState().toastMsg).toBe('1 workout imported · 2 routines imported')
    const S = useStore.getState().S
    expect(S.routines.map(r => r.name)).toEqual(['Basic · A', 'Basic · B'])
    expect(S.routines[0].ex[0]).toMatchObject({ id: '0043', sets: 3, reps: 5, weight: 100, note: 'progress: lp(2.5kg)' })
  })

  it('says so when a file looks like an app’s export and does not read as one', async () => {
    importFromApp(new File(['Date (yyyy/mm/dd),Workout,Exercise,Set 1 (Reps)\n2026/02/03,1,Squat,5'], 'sl.csv', { type: 'text/csv' }))
    for (let i = 0; i < 50 && !useUI.getState().toastMsg; i++) await new Promise(r => setTimeout(r, 5))
    expect(useUI.getState().toastMsg).toBe('This looks like a StrongLifts export, but we couldn’t read it. Nothing was imported.')
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})

// A Strava archive's activities.csv has no weigh-in in it: the sheet used to answer "Nothing to
// import from that file" to any file that was activities alone.
describe('the import summary for a file that is activities alone', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], bodyweight: [], activities: {} } }))
  })
  afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = '' })
  const STRAVA = [
    'Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Elapsed Time,Distance',
    '101,"Oct 5, 2026, 12:00:00 PM",Morning Run,Run,,2550,8.20,2550.0,8204.5',
    '102,"Oct 6, 2026, 12:00:00 PM",Evening Ride,Ride,,3600,30.00,3600.0,30000.0',
  ].join('\n')
  const tiles = () => Object.fromEntries([...host.querySelectorAll('.tile')].map(d => [d.querySelector('.l').textContent, d.querySelector('.v').textContent]))

  it('opens, counts the activities and leaves the weigh-in tile out', async () => {
    await summaryFor(STRAVA)
    expect(host.querySelector('h3').textContent).toBe('Import from Strava')
    expect(tiles()).toEqual({ Activities: '2', New: '2' })
  })

  it('does not call new a run the health read already brought in', async () => {
    const at = Date.UTC(2026, 9, 5, 12, 0, 30)
    useStore.setState(s => ({ S: { ...s.S, activities: { ah1: { d: '2026-10-05', sport: 'run', min: 42, at, src: 'ah', _ts: at } } } }))
    await summaryFor(STRAVA)
    expect(tiles()).toEqual({ Activities: '2', New: '1' })
  })
})
