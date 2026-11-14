// @vitest-environment happy-dom
// A cardio exercise can be counted in sets x reps (#678): high knees are filed under cardio in
// the catalogue, which used to lock them to Intervals, Minutes and Speed. Their settings now offer
// Cardio, Reps and Time, Cardio still the default. (Jumping jacks were the example until #717 took
// them out of cardio altogether.)
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB, EXIDX } from './lib/exercises.js'
import { modeOf } from './lib/history.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

const HIGH_KNEES = '3556'
const mounted = []
function open(ex, existing) {
  useStore.setState({ S: structuredClone(DEF), user: null })
  const onSave = vi.fn()
  exConfigSheet(ex, existing, onSave, null, null)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const modes = () => [...host.querySelectorAll('.seg-range button')].map(b => b.textContent.trim())
  const picked = () => host.querySelector('.seg-range button.on')?.textContent.trim()
  const pick = label => act(() => [...host.querySelectorAll('.seg-range button')].find(b => b.textContent.trim() === label).click())
  const labels = () => [...host.querySelectorAll('.stp-l')].map(l => l.textContent.trim())
  const save = () => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())
  return { modes, picked, pick, labels, save, onSave }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('a cardio exercise logged as sets x reps (#678)', () => {
  it('high knees are cardio in the catalogue and opens on Cardio, with Reps and Time on offer', () => {
    expect(EXIDX[HIGH_KNEES].bp).toBe('cardio')
    const v = open(EXIDX[HIGH_KNEES], { sets: 1, min: 20, speed: 8 })
    expect(v.modes()).toEqual(['Cardio', 'Reps', 'Time'])
    expect(v.picked()).toBe('Cardio')
    expect(v.labels()).toContain('Intervals')
  })

  it('Reps gives it sets x reps, saved as a reps slot the session reads as reps', () => {
    const v = open(EXIDX[HIGH_KNEES], { sets: 1, min: 20, speed: 8 })
    v.pick('Reps')
    expect(v.labels()).toEqual(expect.arrayContaining(['Sets', 'Reps']))
    expect(v.labels()).not.toContain('Intervals')
    v.save()
    const saved = v.onSave.mock.calls[0][0]
    // Three sets, not the one interval it came from.
    expect(saved).toMatchObject({ mode: 'reps', sets: 3, reps: 10 })
    expect(saved).not.toHaveProperty('min')
    expect(modeOf({ ...saved, id: HIGH_KNEES })).toBe('reps')
  })

  it('reopens on Reps, and going back to Cardio saves an interval again', () => {
    const v = open(EXIDX[HIGH_KNEES], { sets: 3, reps: 20, weight: 0, mode: 'reps', bodyweight: true })
    expect(v.picked()).toBe('Reps')
    v.pick('Cardio')
    expect(v.labels()).toContain('Intervals')
    v.save()
    const saved = v.onSave.mock.calls[0][0]
    expect(saved).toMatchObject({ sets: 1, min: 20, speed: 8 })
    expect(modeOf({ ...saved, id: HIGH_KNEES })).toBe('cardio')
  })

  it('a strength exercise still only offers Reps and Time', () => {
    const bench = EXDB.find(e => e.bp === 'chest' && e.eq === 'barbell')
    const v = open(bench)
    expect(v.modes()).toEqual(['Reps', 'Time'])
  })
})
