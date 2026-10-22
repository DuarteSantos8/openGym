// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB, EXIDX } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet, exercisePicker, swapActiveWorkoutExercise } from './sheets.jsx'
import { buildSessionEntries } from './lib/session-start.js'
import { exerciseNameFor } from './lib/i18n.js'
import { exerciseNameText } from './lib/format.js'

/* Planned substitutes (Discord "Substitutions for a routine"): picked in the routine editor's
   exercise sheet, offered first by the swap picker, kept by every sheet that saves the slot. */
const ex = EXDB.find(e => e.id === '0025')
const mounted = []
function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const row = (host, title) => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const save = host => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click()

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', restSec: 120 } }))
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

describe('the routine editor\'s exercise sheet', () => {
  it('shows the backups and keeps them on save; without any, no field', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 8, weight: 60, mode: 'reps', subs: ['0047', '0289'] }, onSave, null, null, null, null, undefined, { backups: true })
    const host = render(useUI.getState().sheets.at(-1))
    expect(row(host, 'Backups').querySelector('.lrow-v').textContent).toBe('2')
    expect(row(host, 'Backups').textContent).toContain(exerciseNameFor(EXIDX['0047']))
    act(() => save(host))
    expect(onSave.mock.calls[0][0].subs).toEqual(['0047', '0289'])

    const none = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 8, weight: 60, mode: 'reps' }, none, null, null, null, null, undefined, { backups: true })
    const second = render(useUI.getState().sheets.at(-1))
    act(() => save(second))
    expect('subs' in none.mock.calls[0][0]).toBe(false)
  })

  it('adds one from the library and removes one', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 8, weight: 60, mode: 'reps', subs: ['0047'] }, onSave, null, null, null, null, undefined, { backups: true })
    const host = render(useUI.getState().sheets.at(-1))
    act(() => row(host, 'Backups').click())
    const sheet = render(useUI.getState().sheets.at(-1))
    // The name in a sentence is title-cased like everywhere else it is shown (QA v1.4.2).
    expect(sheet.querySelector('h3').textContent).toBe('Backups for ' + exerciseNameText(ex))
    expect(sheet.querySelector('h3').textContent).toBe('Backups for Barbell Bench Press')
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Add a backup').click())
    const picker = render(useUI.getState().sheets.at(-1))
    const name = exerciseNameFor(EXIDX['0289'])
    act(() => [...picker.querySelectorAll('.chip')].find(c => c.textContent === 'All').click())
    const input = picker.querySelector('input.input')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, name)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const pick = [...picker.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === name)
    act(() => pick.click())
    act(() => [...sheet.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Remove “' + exerciseNameText(EXIDX['0047']) + '”').click())
    act(() => save(host))
    expect(onSave.mock.calls[0][0].subs).toEqual(['0289'])
  })

  it('elsewhere (a workout\'s own sheet) the row is not offered, and the backups still survive a save', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 8, weight: 60, mode: 'reps', subs: ['0047'] }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(row(host, 'Backups')).toBeUndefined()
    act(() => save(host))
    expect(onSave.mock.calls[0][0].subs).toEqual(['0047'])
  })
})

describe('the swap picker', () => {
  it('lists the slot\'s backups first, and leaves them out while searching', () => {
    exercisePicker(() => {}, { title: 'Swap exercise', like: '0025', backups: ['0289', 'gone'] })
    const host = render(useUI.getState().sheets.at(-1))
    const heads = [...host.querySelectorAll('h4.sec')].map(h => h.textContent)
    expect(heads.slice(0, 2)).toEqual(['Your backups', 'Everything else'])
    const first = host.querySelector('h4.sec').nextElementSibling
    expect(first.textContent).toContain(exerciseNameFor(EXIDX['0289']))
  })
  it('no backups, no section', () => {
    exercisePicker(() => {}, { title: 'Swap exercise', like: '0025' })
    const host = render(useUI.getState().sheets.at(-1))
    expect([...host.querySelectorAll('h4.sec')].map(h => h.textContent)).not.toContain('Your backups')
  })
})

describe('a swap to one of the slot\'s backups (#649)', () => {
  const BENCH = '0025'
  const INCLINE = '0047'
  const ROW = '0027'
  const routine = { id: 'main', name: 'Main', ex: [{ id: BENCH, sets: 3, reps: 8, weight: 80, restSec: 150, subs: [INCLINE] }] }
  const start = () => {
    useStore.setState(st => {
      const S = { ...st.S, unit: 'kg', restSec: 120, routines: [routine], workouts: [] }
      const entries = buildSessionEntries(S, routine).map(e => ({ ...e, rid: 'main' }))
      return { S: { ...S, active: { id: 'swap-test', d: '2026-09-23', start: 1, routineIds: ['main'], routineId: 'main', name: 'Main', bw: null, cur: 0, entries } } }
    })
    swapActiveWorkoutExercise(0)
    return useUI.getState().sheets.at(-1)
  }
  const entry = () => useStore.getState().S.active.entries[0]

  it('the "+" on a backup commits at the slot\'s plan, with the bench as the first backup', () => {
    const picker = start()
    act(() => picker.render(picker.close).props.onPick(EXIDX[INCLINE], true))
    expect(entry().id).toBe(INCLINE)
    expect([entry().target.sets, entry().target.reps, entry().target.restSec]).toEqual([3, 8, 150])
    expect(entry().target.subs).toEqual([BENCH])
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('tapping the backup\'s row opens the config sheet on those numbers, and a save goes through it', () => {
    const picker = start()
    act(() => picker.render(picker.close).props.onPick(EXIDX[INCLINE]))
    const config = useUI.getState().sheets.at(-1)
    const initial = config.render(config.close).props.initial
    expect([initial.id, initial.sets, initial.reps, initial.restSec, initial.subs]).toEqual([INCLINE, 3, 8, 150, [BENCH]])
    act(() => config.render(config.close).props.onSave({ ...initial, reps: 6 }))
    expect(entry().id).toBe(INCLINE)
    expect(entry().target.reps).toBe(6)
    // The picker is gone with the swap (the sheet closes itself on a real Save).
    expect(useUI.getState().sheets.some(x => x.id === picker.id)).toBe(false)
  })

  it('any other exercise still starts from its own defaults, as a swap always has', () => {
    const picker = start()
    act(() => picker.render(picker.close).props.onPick(EXIDX[ROW], true))
    expect(entry().id).toBe(ROW)
    expect([entry().target.sets, entry().target.reps]).toEqual([3, 10])
    expect('subs' in entry().target).toBe(false)
    const again = start()
    act(() => again.render(again.close).props.onPick(EXIDX[ROW]))
    expect(useUI.getState().sheets.at(-1).render(() => {}).props.initial).toBeNull()
  })
})
