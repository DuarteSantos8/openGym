// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { importFromHevy } from './sheets.jsx'
import { bindUI } from './components/ui.jsx'

// The Hevy import sheet with the API's extras: the body measurements' row and switch, the
// routine links, the account's unit, and what Import writes.
const T = [{ id: 't1', title: 'Squat (Barbell)', type: 'weight_reps', primary_muscle_group: 'quadriceps' }]
const pages = {
  exercise_templates: T,
  workouts: [{ id: 'w1', title: 'Lower', routine_id: 'r1', description: 'Felt strong', start_time: '2026-10-14T16:27:30Z', end_time: '2026-10-14T17:40:00Z',
    exercises: [{ exercise_template_id: 't1', title: 'Squat (Barbell)', notes: 'belt on', sets: [{ type: 'normal', weight_kg: 100, reps: 5 }] }] }],
  routines: [{ id: 'r1', title: 'Lower', exercises: [{ exercise_template_id: 't1', rest_seconds: 150, sets: [{ type: 'normal', weight_kg: 100, reps: null, rep_range: { start: 8, end: 12 } }] }] }],
  body_measurements: [{ date: '2026-10-01', weight_kg: 80, neck_cm: 38, waist: 80 }],
}
const mounted = []
let realFetch

function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
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
  return host
}

describe('the Hevy import sheet: measurements, routine links and the unit', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], routines: [], bodyweight: [], measurements: [], customEx: [] } }))
    realFetch = globalThis.fetch
    globalThis.fetch = async url => {
      const key = new URL(url).pathname.split('/').pop()
      if (key === 'info') return { ok: true, status: 200, json: async () => ({ data: { weight_unit: 'lbs' } }) }
      return { ok: true, status: 200, json: async () => ({ page_count: 1, [key]: pages[key] }) }
    }
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) })
  })

  it('shows the measurements with their switch and says the account’s unit differs', async () => {
    const host = await fetched()
    expect(host.textContent).toContain('Import body measurements')
    expect(host.textContent).toContain('Your Hevy account shows weights in lb, this app in kg: they come in as kg.')
  })

  it('imports the measurements and files the workout under its imported routine', async () => {
    const host = await fetched()
    act(() => button(host, 'Import').click())
    const S = useStore.getState().S
    expect(S.measurements).toMatchObject([{ d: '2026-10-01', neck: 38, waist: 80 }])
    expect(S.routines[0].ex[0]).toMatchObject({ restSec: 150, reps: 12, repsMin: 8, prog: 'double' })
    expect(S.workouts[0]).toMatchObject({ note: 'Felt strong', routineId: S.routines[0].id })
    expect(S.workouts[0].entries[0].note).toBe('belt on')
  })

  it('leaves the measurements out when switched off', async () => {
    const host = await fetched()
    const row = [...host.querySelectorAll('.row')].find(r => r.textContent.includes('Import body measurements'))
    act(() => row.querySelector('[role="switch"]').click())
    act(() => button(host, 'Import').click())
    expect(useStore.getState().S.measurements).toEqual([])
  })
})
