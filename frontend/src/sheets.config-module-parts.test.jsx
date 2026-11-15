// @vitest-environment happy-dom
// The Exercise settings module's parts (lib/modules.js PARTS, #1087): each switched off leaves its
// category out of an exercise's settings, and a set type the exercise already uses stays.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX } from './lib/exercises.js'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet, exerciseDetailSheet } from './sheets.jsx'

const BENCH = EXIDX['0289']   // dumbbell bench press
const SQUAT = EXIDX['0043']   // barbell
const mounted = []
function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const withParts = modules => useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg', modules }, user: null })
const open = (ex, cfg = {}, onSave = () => {}) => {
  exConfigSheet(ex, { sets: 3, reps: 5, weight: 40, mode: 'reps', ...cfg }, onSave)
  return render(useUI.getState().sheets.at(-1))
}
const heads = host => [...host.querySelectorAll('h4.sec')].map(h => h.textContent)
const rowNamed = (host, title) => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const save = host => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())

describe('exercise settings: the parts of the Exercise settings module', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('shows every category while every part is on', () => {
    withParts({})
    const host = open(BENCH)
    expect(heads(host)).toEqual(expect.arrayContaining(['Set type', 'Weight means', 'Weight unit', 'Plate loading', 'Progression']))
    expect(rowNamed(host, 'Last set to failure')).toBeTruthy()
    expect(rowNamed(host, 'Pyramid sets')).toBeTruthy()
  })

  it('Progression off leaves the rule out, and the slot still saves its sets and reps', () => {
    withParts({ 'exercise.progression': false })
    const onSave = vi.fn()
    const host = open(SQUAT, {}, onSave)
    expect(heads(host)).not.toContain('Progression')
    expect(rowNamed(host, 'Rule')).toBeUndefined()
    expect(heads(host)).toContain('Plate loading')
    save(host)
    expect(onSave.mock.calls[0][0]).toMatchObject({ sets: 3, reps: 5, weight: 40 })
  })

  it('Progression off keeps a ranged rule’s rep range editable, once', () => {
    const labels = host => [...host.querySelectorAll('.stp-l')].map(l => l.textContent)
    const stepperOf = (host, label) => [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l')?.textContent === label)
    withParts({})
    const on = open(SQUAT, { prog: 'double', reps: 12, repsMin: 8 })
    expect(labels(on).filter(l => l === 'Reps from')).toHaveLength(1)
    withParts({ 'exercise.progression': false })
    const onSave = vi.fn()
    const host = open(SQUAT, { prog: 'double', reps: 12, repsMin: 8 }, onSave)
    expect(rowNamed(host, 'Rule')).toBeUndefined()
    expect(labels(host).filter(l => l === 'Reps from' || l === 'Reps up to')).toEqual(['Reps from', 'Reps up to'])
    expect(labels(host)).not.toContain('Reps')
    expect(stepperOf(host, 'Reps from').querySelector('input').value).toBe('8')
    act(() => stepperOf(host, 'Reps up to').querySelector('[aria-label*=": Increase"]').click())
    save(host)
    expect(onSave.mock.calls[0][0]).toMatchObject({ prog: 'double', reps: 13, repsMin: 8 })
  })

  it('Plate loading off leaves the bar, plates and stack out, here and in the exercise’s details', () => {
    withParts({ 'exercise.plates': false })
    const host = open(SQUAT)
    expect(heads(host)).not.toContain('Plate loading')
    expect(heads(host)).not.toContain('Weight stack')
    expect(heads(host)).toContain('Weight unit')
    exerciseDetailSheet(SQUAT)
    const detail = render(useUI.getState().sheets.at(-1))
    expect(heads(detail)).not.toContain('Plate loading')
    expect(heads(detail)).toContain('Weight unit')
  })

  it('Weight unit and dumbbells off leaves the unit and Weight means out', () => {
    withParts({ 'exercise.units': false })
    const host = open(BENCH)
    expect(heads(host)).not.toContain('Weight unit')
    expect(heads(host)).not.toContain('Weight means')
    expect(heads(host)).toContain('Plate loading')
    exerciseDetailSheet(BENCH)
    const detail = render(useUI.getState().sheets.at(-1))
    expect(heads(detail)).not.toContain('Weight unit')
    expect(heads(detail)).not.toContain('Weight means')
  })

  it('Drop-sets, rest-pause and pyramids off leaves the set types out of a plain exercise', () => {
    withParts({ 'exercise.intensity': false })
    const host = open(SQUAT)
    expect(heads(host)).not.toContain('Set type')
    expect(rowNamed(host, 'Last set to failure')).toBeUndefined()
    expect(rowNamed(host, 'Pyramid sets')).toBeUndefined()
    // sets, reps, weight, rests and the note always show
    expect(rowNamed(host, 'Rest for this exercise')).toBeTruthy()
    expect(host.querySelector('textarea')).toBeTruthy()
    expect(heads(host)).toContain('Progression')
  })

  it('a set type the exercise already uses stays, so it can be turned off', () => {
    withParts({ 'exercise.intensity': false })
    const onSave = vi.fn()
    const host = open(SQUAT, { intensifier: { type: 'dropset', count: 1, pct: 20 }, lastToFailure: true }, onSave)
    expect(heads(host)).toContain('Set type')
    const fail = rowNamed(host, 'Last set to failure')
    expect(fail.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
    // turned off, it stays in view until the sheet is closed
    act(() => fail.querySelector('[role="switch"]').click())
    expect(rowNamed(host, 'Last set to failure')).toBeTruthy()
    expect(rowNamed(host, 'Pyramid sets')).toBeUndefined()
    save(host)
    expect(onSave.mock.calls[0][0].lastToFailure).toBeUndefined()
    expect(onSave.mock.calls[0][0].intensifier).toMatchObject({ type: 'dropset' })
    // a pyramid in use keeps its switch too
    const pyr = open(SQUAT, { pyramid: [12, 8, 6] })
    expect(rowNamed(pyr, 'Pyramid sets').querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
  })

  it('with the module off every part is out, whatever its switch', () => {
    withParts({ exercise: false, 'exercise.plates': true })
    const host = open(BENCH)
    for (const h of ['Set type', 'Weight means', 'Weight unit', 'Plate loading', 'Progression']) expect(heads(host)).not.toContain(h)
    expect(rowNamed(host, 'Rest for this exercise')).toBeTruthy()
  })
})
