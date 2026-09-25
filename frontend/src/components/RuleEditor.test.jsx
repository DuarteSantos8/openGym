// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import RuleEditor from './RuleEditor.jsx'
import { bindUI } from './ui.jsx'
import { defaultPlanRule, rptOffsets } from '../lib/prescription/index.js'

let root
let host
const ruleOf = preset => defaultPlanRule(preset, { id: 'r1', exerciseId: 'ex1', unit: 'kg' })
const linear = () => ruleOf('linear')
const withParams = (r, params) => ({ ...r, parameters: { ...r.parameters, ...params } })
const abs = value => ({ mode: 'absolute', value, unit: 'kg' })

function render(props) {
  const onChange = vi.fn()
  act(() => root.render(<RuleEditor unit="kg" effort={false} onChange={onChange} {...props} />))
  return onChange
}
const labels = () => [...host.querySelectorAll('.stp-l')].map(l => l.textContent)
// The Fixed/Range segments on the label line of `label` (Sets, Reps, Seconds, Load).
// The small Fixed/Range button at the end of a field's input row (Sets, Reps, Seconds, Starting load).
const toggleOf = label => host.querySelector(`[data-field="${label}"] .rng-btn`)
const isRange = label => toggleOf(label).getAttribute('aria-pressed') === 'true'
// The steppers of the Load field (not the Target or Plate step ones).
const loadSteppers = () => [...[...host.querySelectorAll('.small.dim')].find(s => s.textContent === 'Starting load').parentElement.parentElement.querySelectorAll('.stp')]
// The unit button of a load field opens a picker sheet; capture it and choose `label` in it.
let sheetFn
bindUI({ getState: () => ({ openSheet: fn => { sheetFn = fn } }) })
const pick = (field, label) => {
  act(() => host.querySelector(`[data-field="${field}"] .unit-btn`).click())
  const sheet = document.createElement('div')
  document.body.appendChild(sheet)
  const r2 = createRoot(sheet)
  act(() => r2.render(sheetFn(() => {})))
  act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent.includes(label)).click())
  act(() => r2.unmount()); sheet.remove()
}
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('RuleEditor', () => {
  it('switching the load to % 1RM also switches the increment to percentage points', () => {
    const onChange = render({ rule: linear() })
    pick('Starting load', '% 1RM')
    const next = onChange.mock.calls.at(-1)[0]
    expect(next.parameters.load).toEqual({ mode: 'percent_1rm', percent: 70 })
    expect(next.increment).toEqual({ type: 'percentage_points', value: 2.5 })
  })

  it('shows the first validation error of an invalid rule', () => {
    const bad = linear()
    bad.parameters.reps = { min: 8, max: 5 }
    render({ rule: bad })
    expect(host.querySelector('[role="alert"]').textContent).toBe('parameters.reps: min is above max')
  })

  it('toggles completion conditions in and out of the AND list', () => {
    const onChange = render({ rule: linear() })
    expect(host.querySelector('[role="switch"]')).toBeNull()   // closed by default
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Stop progressing')).click())
    const switches = [...host.querySelectorAll('[role="switch"]')]
    act(() => switches[0].click())   // target_load is first and on by default
    expect(onChange.mock.calls.at(-1)[0].completion).toEqual([])
  })

  it('offers an RIR range only when exertion tracking is on', () => {
    render({ rule: linear(), effort: false })
    expect(host.textContent).not.toContain('Target effort (RIR)')
    render({ rule: linear(), effort: true })
    expect(host.textContent).toContain('Target effort (RIR)')
  })

  it('shows a single value, not from/to, where the preset allows no range', () => {
    render({ rule: linear() })
    expect(labels()).toContain('Reps')
    expect(labels()).not.toContain('Reps from')
    expect(labels()).not.toContain('Reps to')
    expect(labels()).toContain('Sets')
    expect(toggleOf('Sets')).toBeNull()
    expect(toggleOf('Reps')).toBeNull()
  })

  it('switches a linear rule from repetitions to seconds without changing its progression', () => {
    const onChange = render({ rule: linear() })
    expect(button('Time')).toBeDefined()
    act(() => button('Time').click())
    const next = onChange.mock.calls.at(-1)[0]
    expect(next).toMatchObject({ preset: 'linear', parameters: { durationSeconds: { min: 45, max: 45 } } })
    render({ rule: next })
    expect(labels()).toContain('Seconds')
    expect(labels()).not.toContain('Reps')
  })

  it('switches a timed rule back to repetitions by removing its duration', () => {
    const timed = withParams(linear(), { durationSeconds: { min: 45, max: 45 } })
    const onChange = render({ rule: timed })
    expect(button('Reps')).toBeDefined()
    act(() => button('Reps').click())
    expect('durationSeconds' in onChange.mock.calls.at(-1)[0].parameters).toBe(false)
  })

  it('double progression: reps always from/to and sets fixed', () => {
    render({ rule: ruleOf('double') })
    expect(labels()).toEqual(expect.arrayContaining(['Reps from', 'Reps to']))
    expect(labels()).toContain('Sets')
    expect(labels()).not.toContain('Sets from')
    expect(toggleOf('Reps')).toBeNull()
    expect(toggleOf('Sets')).toBeNull()
    expect(toggleOf('Starting load')).toBeNull()
  })

  it.each(['pyramid', 'reverse_pyramid'])('%s progression: sets open into from/to with a button beside the input', preset => {
    const onChange = render({ rule: ruleOf(preset) })
    expect(isRange('Sets')).toBe(false)
    act(() => toggleOf('Sets').click())
    expect(labels()).toEqual(expect.arrayContaining(['Sets from', 'Sets to']))
    expect(isRange('Sets')).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a pyramid set range unchanged when offset rows cross its bound', () => {
    const rule = withParams(ruleOf('pyramid'), { sets: { min: 2, max: 3 } })
    const onChange = render({ rule })
    act(() => button('Add set').click())
    const next = onChange.mock.calls.at(-1)[0]
    expect(next.parameters.sets).toEqual({ min: 2, max: 3 })
    expect(next.special.offsets).toHaveLength(4)
  })

  it('keeps fixed pyramid sets equal to the offset count', () => {
    const onChange = render({ rule: ruleOf('pyramid') })
    act(() => button('Add set').click())
    expect(onChange.mock.calls.at(-1)[0].parameters.sets).toEqual({ min: 4, max: 4 })
  })

  const rptRule = () => ({ ...withParams(ruleOf('reverse_pyramid'), { reps: { min: 6, max: 6 } }), special: { offsets: rptOffsets(3, 6) } })

  it('Apply RPT rebuilds the sets as 100/90/80 % with reps 6/8/10', () => {
    const onChange = render({ rule: ruleOf('reverse_pyramid') })
    act(() => button('Apply RPT').click())
    const next = onChange.mock.calls.at(-1)[0]
    expect(next.parameters.reps).toEqual({ min: 6, max: 6 })
    expect(next.special.offsets).toEqual([{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }])
  })

  it('offers Apply RPT only on a reverse pyramid', () => {
    render({ rule: ruleOf('pyramid') })
    expect(button('Apply RPT')).toBeUndefined()
  })

  it('Add set on an RPT rule copies the last set with two more reps', () => {
    const onChange = render({ rule: rptRule() })
    act(() => button('Add set').click())
    expect(onChange.mock.calls.at(-1)[0].special.offsets.at(-1)).toEqual({ percentOfAnchor: 80, reps: 12 })
  })

  it('Same reps every set strips the per-set reps and is hidden when there are none', () => {
    render({ rule: ruleOf('reverse_pyramid') })
    expect(button('Same reps every set')).toBeUndefined()
    const onChange = render({ rule: rptRule() })
    act(() => button('Same reps every set').click())
    expect(onChange.mock.calls.at(-1)[0].special.offsets).toEqual([{ percentOfAnchor: 100 }, { percentOfAnchor: 90 }, { percentOfAnchor: 80 }])
  })

  it('hold_seconds is always timed: no reps/time switch, seconds range shown', () => {
    render({ rule: ruleOf('linear') })
    expect(button('Time')).toBeDefined()   // control: the switch exists where a preset allows both
    render({ rule: ruleOf('hold_seconds') })
    expect(button('Time')).toBeUndefined()
    expect(labels()).toContain('Seconds from')   // the default 20–30 s window renders as a from/to range
  })

  it('hold_seconds edits the seconds added per step and has no load increment', () => {
    render({ rule: ruleOf('hold_seconds') })
    expect(labels()).toContain('Seconds added per step')
    expect(host.textContent).not.toContain('Increase load by')
    render({ rule: ruleOf('double') })
    expect(host.textContent).toContain('Increase load by')
    expect(labels()).not.toContain('Seconds added per step')
  })

  it('turning the stop time on for hold_seconds starts at 120 seconds', () => {
    const r = { ...ruleOf('hold_seconds'), completion: [] }
    const onChange = render({ rule: r })
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Stop progressing')).click())
    act(() => [...host.querySelectorAll('[role="switch"]')].at(-1).click())   // max_duration is the last metric
    expect(onChange.mock.calls.at(-1)[0].completion).toEqual([{ metric: 'max_duration', target: 120 }])
  })

  it('autoregulated: Sets and Reps toggle between a fixed value and a range, the load never does', () => {
    const rule = withParams(ruleOf('autoregulated'), { load: abs(60) })
    const onChange = render({ rule })
    expect(isRange('Sets')).toBe(false)
    expect(isRange('Reps')).toBe(true)   // 8-12 by default
    expect(toggleOf('Starting load')).toBeNull()   // the range comes from starting load → target
    expect(onChange).not.toHaveBeenCalled()
  })

  it('range → fixed collapses to min === max', () => {
    const onChange = render({ rule: ruleOf('autoregulated') })   // reps 8-12
    act(() => toggleOf('Reps').click())
    expect(onChange.mock.calls.at(-1)[0].parameters.reps).toEqual({ min: 8, max: 8 })
  })

  it('keeps min ≤ max while editing a range', () => {
    const onChange = render({ rule: withParams(ruleOf('autoregulated'), { reps: { min: 8, max: 8 } }) })
    act(() => toggleOf('Reps').click())
    const from = [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l').textContent === 'Reps from')
    act(() => from.querySelector('[aria-label="Increase"]').click())
    expect(onChange.mock.calls.at(-1)[0].parameters.reps).toEqual({ min: 9, max: 9 })
  })

  it('a fixed field writes the same value to both ends', () => {
    const onChange = render({ rule: linear() })
    const reps = [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l').textContent === 'Reps')
    act(() => reps.querySelector('[aria-label="Increase"]').click())
    expect(onChange.mock.calls.at(-1)[0].parameters.reps).toEqual({ min: 6, max: 6 })
  })

  it('changing the load mode clears the load range', () => {
    const onChange = render({ rule: withParams(ruleOf('autoregulated'), { load: abs(60), loadTo: abs(80) }) })
    pick('Starting load', '% 1RM')
    const p = onChange.mock.calls.at(-1)[0].parameters
    expect(p.load).toEqual({ mode: 'percent_1rm', percent: 70 })
    expect('loadTo' in p).toBe(false)
  })

  it('offers no load range toggle for an empty load', () => {
    render({ rule: ruleOf('autoregulated') })   // load: None
    expect(toggleOf('Starting load')).toBeNull()
  })

  it('puts the progression first, then the target it governs', () => {
    render({ rule: ruleOf('double') })
    const heads = [...host.querySelectorAll('h4.sec')].map(h => h.textContent)
    expect(heads).toEqual(['Progression', 'Target'])
  })

  it('explains what the RIR floor does, next to the RIR field', () => {
    render({ rule: withParams(linear(), { rir: { min: 1, max: 3 } }), effort: true })
    expect(host.textContent).toContain('Load only goes up if your hardest set left at least this many reps in reserve.')
  })
})
