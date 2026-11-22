// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { menuItemsOf } from '../lib/menu-items.js'

const mocks = vi.hoisted(() => ({ scan: vi.fn(), menuSheet: vi.fn() }))

vi.mock('../lib/sound.js', async importOriginal => ({ ...(await importOriginal()), beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), chime: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }))
vi.mock('../components/ScanMachine.jsx', () => ({ scanMachineSheet: mocks.scan, linkMachineSheet: vi.fn() }))
vi.mock('../sheets.jsx', async importOriginal => ({ ...(await importOriginal()), menuSheet: mocks.menuSheet }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
// Real catalogue ids, so names and an added entry's build resolve.
const A_ID = '0001'
const B_ID = '0002'
const C_ID = '0003'
const D_ID = '0006'
const E_ID = '0007'
const entry = (id, done = false) => ({ id, target: { sets: 1, reps: 5 }, sets: [{ w: 20, r: 5, done }] })

let root
let container

function mount(entries, cur = 0, { active = {}, wc = {} } = {}) {
  const S = clone(DEF)
  S.wc = { ...S.wc, ...wc }
  S.active = {
    id: 'scan-test', d: '2026-11-22', start: Date.now(), routineId: null,
    name: 'Scan test', bw: null, cur, entries, ...active,
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const scanButton = () => container.querySelector('.wchips-row button[aria-label="Scan a machine"]')
const click = el => act(() => { el.dispatchEvent(new Event('click', { bubbles: true })) })
const ids = () => useStore.getState().S.active.entries.map(e => e.id)
const active = () => useStore.getState().S.active

// Tap the chip row's scan button and have the sheet answer with `exId`.
function scan(exId) {
  click(scanButton())
  const { onExercise } = mocks.scan.mock.calls.at(-1)[0]
  act(() => onExercise(exId))
}

function undo() {
  const action = useUI.getState().toastAction
  expect(action?.label).toBe('Undo')
  act(() => useUI.getState().runToastAction())
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  mocks.scan.mockReset()
  mocks.menuSheet.mockReset()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null, timer: null, work: null })
  root = null
  container = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Scan a machine in the workout', () => {
  it('puts the scan button in the chip row, before the session map', () => {
    mount([entry(A_ID), entry(B_ID)])
    const row = container.querySelector('.wchips-row')
    expect(row).toBeTruthy()
    const btn = scanButton()
    expect(btn).toBeTruthy()
    expect(btn.classList.contains('iconbtn')).toBe(true)
    const kids = [...row.children]
    const map = row.querySelector('[data-session-map]')
    expect(map).toBeTruthy()
    expect(kids.indexOf(btn)).toBeLessThan(kids.indexOf(map))
    expect(kids.indexOf(btn)).toBeGreaterThan(kids.indexOf(row.querySelector('.wchips')))
    click(btn)
    expect(mocks.scan).toHaveBeenCalledOnce()
    expect(mocks.scan.mock.calls[0][0].live.id).toBe('scan-test')
  })

  it('has no scan button while editing a saved workout or logging a past one', () => {
    mount([entry(A_ID), entry(B_ID)], 0, { active: { editingWorkoutId: 'w1' } })
    expect(scanButton()).toBeNull()
    act(() => root.unmount()); container.remove(); root = null
    mount([entry(A_ID), entry(B_ID)], 0, { active: { backfill: { durationMin: 60, replaceId: null } } })
    expect(scanButton()).toBeNull()
  })

  it('lists Scan a machine under Add exercise in the ⋯ menu, chips on or off', () => {
    mount([entry(A_ID), entry(B_ID)], 0, { wc: { exerciseChips: false } })
    expect(container.querySelector('.wchips-row')).toBeNull()
    click(container.querySelector('button[aria-label="Workout options"]'))
    const labels = menuItemsOf(mocks.menuSheet.mock.calls.at(-1)[0]).map(it => it.label)
    expect(labels.indexOf('Scan a machine')).toBe(labels.indexOf('Add exercise') + 1)
    act(() => menuItemsOf(mocks.menuSheet.mock.calls.at(-1)[0]).find(it => it.label === 'Scan a machine').onClick())
    expect(mocks.scan).toHaveBeenCalledOnce()
  })

  it('keeps Scan a machine out of the ⋯ menu of a past workout', () => {
    mount([entry(A_ID)], 0, { active: { backfill: { durationMin: 60, replaceId: null } } })
    click(container.querySelector('button[aria-label="Workout options"]'))
    const labels = menuItemsOf(mocks.menuSheet.mock.calls.at(-1)[0]).map(it => it.label)
    expect(labels).not.toContain('Scan a machine')
  })

  it('keeps the rest on its exercise after a scan move', () => {
    // A and B done, C next (cur 2) with its rest running; D scanned → D goes in front of C.
    mount([entry(A_ID, true), entry(B_ID, true), entry(C_ID), entry(D_ID)], 2)
    act(() => useUI.getState().startRest(90, 2))
    expect(useUI.getState().timer.forIdx).toBe(2)

    scan(D_ID)

    expect(ids()).toEqual([A_ID, B_ID, D_ID, C_ID])
    expect(active().cur).toBe(2)
    expect(useUI.getState().timer.forIdx).toBe(3)
    expect(useUI.getState().toastMsg).toMatch(/is next/)

    undo()

    expect(ids()).toEqual([A_ID, B_ID, C_ID, D_ID])
    expect(active().cur).toBe(2)
    expect(useUI.getState().timer.forIdx).toBe(2)
  })

  it('jumps to an exercise already in place without moving anything', () => {
    mount([entry(A_ID, true), entry(B_ID), entry(C_ID)], 1)
    scan(A_ID)
    expect(ids()).toEqual([A_ID, B_ID, C_ID])
    expect(active().cur).toBe(0)
    expect(useUI.getState().toastAction).toBeNull()
  })

  it('ends a running hold before an added exercise shifts the indexes', () => {
    // The current exercise is untouched, so the scanned one goes in front of it, at its index.
    mount([entry(A_ID), entry(B_ID)], 0)
    const holdWrite = vi.fn(elapsed => {
      useStore.getState().update(s => { const set = s.active.entries[0].sets[0]; set.sec = elapsed; set.done = true })
    })
    act(() => useUI.getState().startWork(5, 'Hold', holdWrite, { idx: 0, i: 0, id: A_ID }))

    expect(() => scan(E_ID)).not.toThrow()
    act(() => vi.advanceTimersByTime(10_000))

    expect(ids()).toEqual([E_ID, A_ID, B_ID])
    expect(useUI.getState().work).toBeNull()
    expect(holdWrite).not.toHaveBeenCalled()
    const added = active().entries[0]
    expect(added.sets.some(set => set.done || set.sec != null)).toBe(false)
  })

  it('adds a scanned exercise that is not in the workout, and Undo takes it out', () => {
    mount([entry(A_ID, true), entry(B_ID)], 0)
    act(() => useUI.getState().startRest(90, 1))

    scan(E_ID)

    // A has a ticked set, so the new one lands after it.
    expect(ids()).toEqual([A_ID, E_ID, B_ID])
    expect(active().cur).toBe(1)
    expect(useUI.getState().timer.forIdx).toBe(2)
    expect(useUI.getState().toastMsg).toMatch(/added/)

    undo()

    expect(ids()).toEqual([A_ID, B_ID])
    expect(active().cur).toBe(0)
    expect(useUI.getState().timer.forIdx).toBe(1)
  })
})
