// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { importFromHevy } from './sheets.jsx'
import { bindUI } from './components/ui.jsx'
import { parseHevyWorkouts } from './lib/import-hevy.js'
import { importId } from './lib/import-csv.js'

// The Hevy import sheet with routine links and folders: the line that says how many workouts it
// will file under their routine, the count after the import, and an import that only links.
const T = [{ id: '4E5257DE', title: 'Lat Pulldown - Close Grip (Cable)', type: 'weight_reps', primary_muscle_group: 'lats' }]
const WORKOUT = {
  id: 'w1', title: 'Pull', routine_id: 'r1', start_time: '2026-10-14T16:27:30Z', end_time: '2026-10-14T17:40:00Z',
  exercises: [{ exercise_template_id: '4E5257DE', title: 'Latzug', sets: [{ type: 'normal', weight_kg: 50, reps: 8 }] }],
}
const ROUTINE = { id: 'r1', title: 'Pull', folder_id: 7, exercises: [{ exercise_template_id: '4E5257DE', sets: [{ type: 'normal', weight_kg: 50, reps: 8 }] }] }
let pages
const mounted = []

function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet?.(sheet.id))))
  return host
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)

async function fetched() {
  importFromHevy()
  const host = render(useUI.getState().sheets.at(-1))
  const input = host.querySelector('input')
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'key')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { button(host, 'Fetch from Hevy').click() })
  for (let i = 0; i < 50 && !button(host, 'Back'); i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  return host
}

describe('the Hevy import sheet: routine links and folders', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [], toasts: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], routines: [], bodyweight: [], customEx: [] } }))
    pages = { exercise_templates: T, workouts: [WORKOUT], routines: [ROUTINE], routine_folders: [{ id: 7, title: 'Back day', index: 0 }], body_measurements: [] }
    vi.stubGlobal('fetch', vi.fn(async url => {
      const key = new URL(String(url)).pathname.split('/').pop()
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ page_count: 1, [key]: pages[key] }) }
    }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) })
  })

  it('says how many workouts it will link, then files the workout under its routine, in its folder', async () => {
    const host = await fetched()
    expect(host.textContent).toContain('Workouts to link to their routine: 1')
    act(() => button(host, 'Import').click())
    expect(useUI.getState().toastMsg).toContain('Workouts linked to their routine: 1')
    const S = useStore.getState().S
    expect(S.routines[0]).toMatchObject({ hevyId: 'r1', folder: 'Back day', hevyFolder: 'Back day' })
    expect(S.workouts[0].routineId).toBe(S.routines[0].id)
  })

  it('imports when there is only something to link', async () => {
    // An earlier CSV import of the same session, and the routine from an earlier Hevy import.
    const api = parseHevyWorkouts([WORKOUT], T, { unit: 'kg' }).workouts[0]
    const csv = { id: 'iwcsv', d: api.d, start: api.start - 30000, end: api.end, routineId: null, name: 'Pull', entries: api.entries, prs: [] }
    useStore.setState(s => ({ S: { ...s.S, workouts: [csv], routines: [{ id: 'R', name: 'Pull', hevyId: 'r1', ex: [] }] } }))
    pages.routines = []
    const host = await fetched()
    expect(host.textContent).toContain('Workouts to link to their routine: 1')
    const imp = button(host, 'Import')
    expect(imp).toBeTruthy()
    expect(imp.disabled).toBe(false)
    act(() => imp.click())
    expect(useUI.getState().toastMsg).toContain('Workouts linked to their routine: 1')
    const S = useStore.getState().S
    expect(S.workouts).toHaveLength(1)
    expect(S.workouts[0]).toMatchObject({ id: 'iwcsv', routineId: 'R', hevyRoutineId: 'r1' })
  })

  it('says nothing about links and has nothing to import when every workout already has its routine', async () => {
    const api = parseHevyWorkouts([WORKOUT], T, { unit: 'kg' }).workouts[0]
    const done = { id: 'iwcsv', d: api.d, start: api.start, routineId: 'R', name: 'Pull', entries: api.entries, prs: [] }
    useStore.setState(s => ({ S: { ...s.S, workouts: [done], routines: [{ id: 'R', name: 'Pull', hevyId: 'r1', ex: [] }] } }))
    pages.routines = []
    const host = await fetched()
    expect(host.textContent).not.toContain('Workouts to link to their routine')
    expect(button(host, 'Nothing new to import').disabled).toBe(true)
  })
})

// Body measurements beside the weigh-ins, a custom exercise's muscles from Hevy, and the line that
// says the Hevy account shows weights in another unit.
describe('the Hevy import sheet: body measurements, custom exercises and the account unit', () => {
  const GRIP = { id: 'C0FFEE01', title: 'Grip Crusher (Cable)', type: 'weight_reps', is_custom: true, equipment: 'machine', primary_muscle_group: 'forearms', secondary_muscle_groups: ['biceps'] }
  let info
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [], toasts: [], toastMsg: '' })
    useStore.setState(s => ({ S: {
      ...s.S, unit: 'kg', workouts: [], routines: [], bodyweight: [], customEx: [],
      measurements: [{ d: '2026-10-01', t: 1, neck: 40 }], measurementEnabled: ['neck', 'waist'], customMeasurements: [],
    } }))
    pages = {
      exercise_templates: [...T, GRIP], workouts: [WORKOUT], routines: [], routine_folders: [],
      body_measurements: [{ date: '2026-10-01', neck_cm: 38 }, { date: '2026-10-05', neck_cm: 39, waist: 81, fat_percent: 18 }],
    }
    info = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: { weight_unit: 'kg' } }) })
    vi.stubGlobal('fetch', vi.fn(async url => {
      const path = new URL(String(url)).pathname
      if (path === '/v1/user/info') return info()
      const key = path.split('/').pop()
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ page_count: 1, [key]: pages[key] }) }
    }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) })
  })
  const row = (host, title) => [...host.querySelectorAll('.row')].find(r => r.textContent.includes(title))
  const HINT = 'Your Hevy account shows weights in'

  it('has its own row for the measurements, imports the new day only and switches its fields on', async () => {
    const bare = { id: importId('im', 'Hevy|C0FFEE01'), n: 'grip crusher (cable)', custom: true, eq: 'custom', tg: '', desc: '', bp: 'lower arms' }
    useStore.setState(s => ({ S: { ...s.S, customEx: [bare] } }))
    const host = await fetched()
    const r = row(host, 'Import body measurements')
    expect(r.textContent).toContain('1 new · 1 days already here')
    expect(r.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
    act(() => button(host, 'Import').click())
    expect(useUI.getState().toastMsg).toContain('Body measurements imported: 1')
    const S = useStore.getState().S
    expect(S.measurements.map(e => [e.d, e.neck])).toEqual([['2026-10-01', 40], ['2026-10-05', 39]])
    expect(S.measurements[1]).toMatchObject({ waist: 81, bodyFat: 18 })
    expect(S.measurementEnabled).toEqual(['neck', 'waist', 'bodyFat'])
    // The custom exercise an earlier import made gets its muscles and equipment.
    expect(S.customEx.find(c => c.id === bare.id)).toMatchObject({ eq: 'cable', tg: 'forearm', secondaries: ['biceps'] })
  })

  it('leaves the measurements out when switched off', async () => {
    const host = await fetched()
    act(() => row(host, 'Import body measurements').querySelector('[role="switch"]').click())
    act(() => button(host, 'Import').click())
    expect(useUI.getState().toastMsg).not.toContain('Body measurements')
    expect(useStore.getState().S.measurements.map(e => e.d)).toEqual(['2026-10-01'])
  })

  it('imports when there are only measurements', async () => {
    pages.workouts = []
    const host = await fetched()
    expect(useUI.getState().toastMsg).not.toContain('Nothing to import')
    const imp = button(host, 'Import')
    expect(imp.disabled).toBe(false)
    act(() => imp.click())
    expect(useUI.getState().toastMsg).toBe('Body measurements imported: 1')
  })

  it('says so when the Hevy account shows weights in another unit, and nothing when it can’t tell', async () => {
    let host = await fetched()
    expect(host.textContent).not.toContain(HINT)
    act(() => { mounted.splice(0).forEach(([root, el]) => { root.unmount(); el.remove() }) })

    info = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: { weight_unit: 'lbs' } }) })
    host = await fetched()
    expect(host.textContent).toContain('Your Hevy account shows weights in lb, this app in kg: they come in as kg.')
    act(() => { mounted.splice(0).forEach(([root, el]) => { root.unmount(); el.remove() }) })

    info = async () => { throw new TypeError('offline') }
    host = await fetched()
    expect(button(host, 'Import')).toBeTruthy()
    expect(host.textContent).not.toContain(HINT)
  })
})
