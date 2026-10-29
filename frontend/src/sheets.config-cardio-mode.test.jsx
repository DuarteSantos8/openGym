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
import { ruleOccurrence } from './lib/test-fixtures.js'
import { planPhase } from './lib/prescription/index.js'

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
  const save = () => act(() => [...host.querySelectorAll('button')].find(b => ['Save', 'Add to routine'].includes(b.textContent.trim())).click())
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
    const v = open(EXIDX[HIGH_KNEES])
    expect(v.modes()).toEqual(['Cardio', 'Reps', 'Time'])
    expect(v.picked()).toBe('Cardio')
    expect(v.labels()).toContain('Intervals')
  })

  it('Reps gives it sets x reps, saved as a reps slot the session reads as reps', () => {
    const v = open(EXIDX[HIGH_KNEES])
    v.pick('Reps')
    expect(v.labels()).not.toContain('Intervals')
    v.save()
    const saved = v.onSave.mock.calls[0][0]
    expect(saved).toMatchObject({ exerciseId: HIGH_KNEES, mode: 'reps' })
    expect(saved).not.toHaveProperty('cardio')
    expect(planPhase(saved.rule).parameters.durationSeconds).toBeFalsy()
    expect(modeOf({ mode: saved.mode, id: HIGH_KNEES })).toBe('reps')
  })

  it('reopens on Reps, and going back to Cardio saves an interval again', () => {
    const v = open(EXIDX[HIGH_KNEES], { ...ruleOccurrence(HIGH_KNEES), mode: 'reps' })
    expect(v.picked()).toBe('Reps')
    v.pick('Cardio')
    expect(v.labels()).toContain('Intervals')
    v.save()
    const saved = v.onSave.mock.calls[0][0]
    expect(saved).toMatchObject({ mode: 'cardio', cardio: { sets: 4, min: 20, speed: 8 } })
    expect(modeOf({ mode: saved.mode, id: HIGH_KNEES })).toBe('cardio')
  })

  it('a strength exercise has no Cardio choice', () => {
    const bench = EXDB.find(e => e.bp === 'chest' && e.eq === 'barbell')
    expect(open(bench).modes()).not.toContain('Cardio')
  })
})
