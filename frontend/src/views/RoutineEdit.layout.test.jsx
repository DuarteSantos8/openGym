// @vitest-environment happy-dom
// The routine editor's page: a bar with the ⋯ menu, the routine's icon and name as its title, a flat
// list with each slot's chips and a link to the one above between neighbours, and the muscles the
// plan reaches as bars. The decisions stay where they were — these only read what the page shows.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(), quickOccurrence: vi.fn(), supersetSheet: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { confirmSheet, menuSheet } from '../sheets.jsx'
import { editPlan } from '../lib/prescription/index.js'
import { ruleOccurrence } from '../lib/test-fixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host

function mount(ex, patch = {}) {
  const S = JSON.parse(JSON.stringify(DEF))
  S.routines = [{ id: 'r1', name: 'Push day', emoji: 'dumbbell', ex }]
  Object.assign(S, patch)
  useStore.setState({ S, user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /><Route path="/plan" element={<div id="plan" />} /></Routes></MemoryRouter>))
}
const rows = () => [...host.querySelectorAll('[data-routine-row]')]
const stored = () => useStore.getState().S.routines[0]
const slot = (exerciseId, occurrenceId, options = {}) => {
  const occ = ruleOccurrence(exerciseId, { occurrenceId })
  return { ...occ, rule: editPlan(occ.rule, options) }
}
const three = () => [
  slot('0025', 'a', { sets: { min: 4, max: 4 }, reps: { min: 8, max: 8 }, load: { mode: 'absolute', value: 60, unit: 'kg' } }),
  slot('0025', 'b', { sets: { min: 3, max: 3 } }),
  slot('0025', 'c', { sets: { min: 2, max: 2 } }),
]

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('RoutineEdit — the page', () => {
  it('titles the bar, and counts the exercises and the sets under the routine name', () => {
    mount(three())
    expect(host.querySelector('.re-bar h1').textContent).toBe('Edit routine')
    expect(host.querySelector('.re-name').value).toBe('Push day')
    expect(host.querySelector('.re-info').textContent).toBe('3 exercises · 9 sets')
  })

  it('goes back to the plan from the bar', () => {
    mount(three())
    act(() => host.querySelector('.re-bar button[aria-label="Plan"]').click())
    expect(host.querySelector('#plan')).toBeTruthy()
  })

  it('shows a slot with its targets and what is switched on', () => {
    const first = three()[0]
    mount([{ ...first, warmup: { mode: 'smart', count: 2 }, side: true }])
    const row = rows()[0]
    expect(row.querySelector('.ss').textContent).toBe('4 × 8 @ 60 kg')
    expect([...row.querySelectorAll('.re-chip')].map(chip => chip.textContent)).toEqual(['Linear', 'Per side', 'Warm-ups'])
  })

  it('shows three chips at most, so a busy slot keeps its row', () => {
    const first = three()[0]
    mount([{ ...first, warmup: { mode: 'smart', count: 2 }, side: true, backoff: true, lastToFailure: true }])
    expect(rows()[0].querySelectorAll('.re-chip')).toHaveLength(3)
  })

  it('draws one bar per muscle the plan reaches, longest for the most sets', () => {
    mount(three())
    const muscles = [...host.querySelectorAll('.re-muscle')]
    expect(muscles.length).toBeGreaterThan(0)
    expect(muscles[0].querySelector('.track i').style.width).toBe('100%')
    expect(muscles[0].querySelector('.tnum').textContent).toMatch(/ sets$/)
  })
})

describe('RoutineEdit — linking neighbours', () => {
  it('offers the link to every exercise but the first', () => {
    mount(three())
    expect(rows().map(row => !!row.querySelector('.re-link button'))).toEqual([false, true, true])
  })

  it('links an exercise to the one above and shows it linked', () => {
    mount(three())
    const link = () => rows()[1].querySelector('.re-link button')
    expect(link().textContent).toBe('Link to previous')
    expect(link().getAttribute('aria-pressed')).toBe('false')
    act(() => link().click())
    const [a, b] = stored().ex
    expect(a.sg).toBeTruthy()
    expect(b.sg).toBe(a.sg)
    expect(link().textContent).toBe('Linked')
    expect(link().getAttribute('aria-pressed')).toBe('true')
    // the first member names the group
    expect(host.querySelector('.ss-label-btn')).toBeTruthy()
    expect(rows()[0].querySelector('.ss-pos').textContent).toBe('A1')
    expect(rows()[1].querySelector('.ss-pos').textContent).toBe('A2')
  })

  it('takes it apart again from the same button', () => {
    mount(three())
    act(() => rows()[1].querySelector('.re-link button').click())
    act(() => rows()[1].querySelector('.re-link button').click())
    expect(stored().ex.every(e => !e.sg)).toBe(true)
    expect(host.querySelector('.ss-label-btn')).toBeNull()
  })
})

describe('RoutineEdit — the ⋯ menu', () => {
  const items = () => {
    act(() => host.querySelector('button[aria-label="More"]').click())
    return menuSheet.mock.calls.at(-1)[0].items
  }

  it('holds copy, print and delete, named after the routine', () => {
    mount(three())
    const list = items()
    expect(menuSheet.mock.calls[0][0].title).toBe('Push day')
    expect(list.map(item => item.label)).toEqual(['Copy routine', 'Print / Save as PDF', 'Delete routine'])
    expect(list[2].danger).toBe(true)
  })

  it('copies the routine and opens the copy', () => {
    mount(three())
    act(() => items()[0].onClick())
    const { routines } = useStore.getState().S
    expect(routines).toHaveLength(2)
    expect(routines[1].name).not.toBe('Push day')
    expect(routines[1].ex).toHaveLength(3)
  })

  it('asks before deleting, and deletes on the confirmation', () => {
    mount(three())
    act(() => items()[2].onClick())
    expect(useStore.getState().S.routines).toHaveLength(1)
    const opts = confirmSheet.mock.calls[0][0]
    expect(opts).toMatchObject({ title: 'Delete routine?', confirmText: 'Delete', danger: true })
    act(() => opts.onConfirm())
    expect(useStore.getState().S.routines.find(r => r.id === 'r1')).toBeUndefined()
  })

  it('has nothing to print for an empty routine', () => {
    mount([])
    expect(items().find(item => item.label === 'Print / Save as PDF').disabled).toBe(true)
  })
})
