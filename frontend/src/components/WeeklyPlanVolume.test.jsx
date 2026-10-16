// @vitest-environment happy-dom
// Weekly muscle volume, as planned: every weekday routine once, plus a running rotation's sessions.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WeeklyPlanVolume from './WeeklyPlanVolume.jsx'

const press = { id: 'press', n: 'Press', primaries: ['chest'], secondaries: ['triceps'], custom: true }
const state = over => ({
  unit: 'kg', body: 'male', effort: null, targetW: null, bodyweight: [], exWeights: {}, workouts: [], dayPlan: {},
  routines: [{ id: 'push', name: 'Push', emoji: null, ex: [{ id: press.id, sets: 2 }] }],
  customEx: [press], week: { 1: ['push'] }, weekStart: 1, queue: null, rotation: null, ...over,
})

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const card = () => host.querySelector('[data-weekly-muscle-volume]')
const render = S => act(() => root.render(<WeeklyPlanVolume S={S} />))

describe('WeeklyPlanVolume — weekly muscle volume from the plan', () => {
  it('shows every non-zero effective-set total from the recurring schedule', () => {
    render(state())
    expect(card().textContent).toContain('Weekly muscle volume')
    expect(card().textContent).toContain('Chest2 sets')
    expect(card().textContent).toContain('Triceps0.8 sets')
  })

  it('does not carry the old scroll anchor', () => {
    render(state())
    expect(card().id).toBe('')
  })

  it('follows the weekly schedule: a routine on two days counts twice', () => {
    render(state({ week: { 1: ['push'], 3: 'push' } }))
    expect(card().textContent).toContain('Chest4 sets')
    expect(card().textContent).toContain('Triceps1.6 sets')
  })

  it('counts the sessions of a running rotation too', () => {
    render(state({ week: {}, queue: { ids: ['push'], since: Date.now(), startsOn: '2026-01-01', label: 'R' } }))
    expect(card().textContent).toContain('Chest2 sets')
  })

  it('says so when the plan has no volume', () => {
    render(state({ week: { 1: ['stale'] } }))
    expect(card().textContent).toContain('No muscle volume planned.')
    expect(card().querySelector('.mrow')).toBeNull()
  })

  it('omits explicit zero-weight muscles', () => {
    const zeroPress = { id: 'zero-press', n: 'Zero press', muscleWeights: { chest: 1, biceps: 0 }, custom: true }
    render(state({ customEx: [zeroPress], routines: [{ id: 'z', name: 'Zero', ex: [{ id: zeroPress.id, sets: 2 }] }], week: { 1: ['z'] } }))
    expect(card().textContent).toContain('Chest2 sets')
    expect(card().textContent).not.toContain('Biceps')
  })

  it('shows the top five and opens the rest on Show more', () => {
    const many = { id: 'many', n: 'Many', primaries: ['chest', 'lats', 'quads', 'glutes', 'hamstrings', 'calves'], secondaries: [], custom: true }
    render(state({ customEx: [many], routines: [{ id: 'm', name: 'M', ex: [{ id: many.id, sets: 3 }] }], week: { 1: ['m'] } }))
    expect(card().querySelectorAll('.mrow').length).toBe(5)
    const more = card().querySelector('.weekly-plan-toggle')
    expect(more.textContent).toBe('Show more')
    act(() => more.click())
    expect(card().querySelectorAll('.mrow').length).toBe(6)
    expect(card().querySelector('.weekly-plan-toggle').textContent).toBe('Show less')
  })
})
