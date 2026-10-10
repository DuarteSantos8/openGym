// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import RuleEditor from './RuleEditor.jsx'
import { bindUI } from './ui.jsx'
import { defaultPlanRule, editPlan, planOptions, planPhase, rptOffsets, validatePlanRule } from '../lib/prescription/index.js'

let root
let host
const ruleOf = (preset, options) => defaultPlanRule(preset, { id: 'r1', exerciseId: 'ex1', unit: 'kg', ...options })
const linear = () => ruleOf('linear')
// The rule's template numbers: what the editor shows and what an edit changes.
const o = r => planOptions(r)
const withParams = (r, params) => editPlan(r, params)
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

describe('RuleEditor on an assistance machine', () => {
  it('says the step takes help away, not that it adds load', () => {
    render({ rule: linear(), assisted: true })
    expect(host.textContent).toContain('Reduce assistance by')
    expect(host.textContent).not.toContain('Increase load by')
    render({ rule: linear() })
    expect(host.textContent).toContain('Increase load by')
  })
})

describe('RuleEditor deload', () => {
  const openDeload = () => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Back off when stuck')).click())
  const stepper = label => [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l').textContent === label)
  it('shows v1\'s default for a progressing preset and lets it be turned off and on', () => {
    const onChange = render({ rule: linear() })
    expect(host.textContent).toContain('after 3 · to 90%')
    openDeload()
    act(() => host.querySelector('.disc-body [role="switch"]').click())
    const off = onChange.mock.calls.at(-1)[0]
    expect(o(off).deload).toBeNull()
    expect(planPhase(off)).not.toHaveProperty('stall')
    const on = render({ rule: off })
    if (!host.querySelector('.disc-body')) openDeload()   // the same editor instance keeps its disclosure open
    act(() => host.querySelector('.disc-body [role="switch"]').click())
    expect(o(on.mock.calls.at(-1)[0]).deload).toEqual({ after: 3, factor: 0.9 })
  })
  it('edits how many misses and how far back, kept inside the engine\'s bounds', () => {
    const onChange = render({ rule: withParams(linear(), { deload: { after: 10, factor: 0.5 } }) })
    openDeload()
    act(() => stepper('Missed sessions in a row').querySelector('[aria-label="Decrease"]').click())
    expect(o(onChange.mock.calls.at(-1)[0]).deload).toEqual({ after: 9, factor: 0.5 })
    act(() => stepper('Missed sessions in a row').querySelector('[aria-label="Increase"]').click())
    expect(o(onChange.mock.calls.at(-1)[0]).deload.after).toBe(10)   // a step past 10 stays at 10
    act(() => stepper('Back off to (%)').querySelector('[aria-label="Increase"]').click())
    expect(o(onChange.mock.calls.at(-1)[0]).deload).toEqual({ after: 10, factor: 0.55 })
  })
  it('is offered only where a session can fall short of the plan', () => {
    render({ rule: ruleOf('autoregulated') })
    expect(host.textContent).not.toContain('Back off when stuck')
    render({ rule: ruleOf('hold_seconds') })
    expect(host.textContent).toContain('Back off when stuck')
  })
})

describe('RuleEditor', () => {
  it('switching the load to % 1RM also switches the increment to percentage points', () => {
    const onChange = render({ rule: linear() })
    pick('Starting load', '% 1RM')
    const next = onChange.mock.calls.at(-1)[0]
    expect(o(next).load).toEqual({ mode: 'percent_1rm', percent: 70 })
    expect(o(next).step).toEqual({ type: 'percentage_points', value: 2.5 })
  })

  it('shows the first validation error of an invalid rule', () => {
    const bad = withParams(linear(), { reps: { min: 8, max: 5 } })
    render({ rule: bad })
    expect(host.querySelector('[role="alert"]').textContent).toBe('program.phases[0].parameters.reps: min is above max')
  })

  it('toggles completion conditions in and out of the AND list', () => {
    const onChange = render({ rule: linear() })
    expect(host.querySelector('[role="switch"]')).toBeNull()   // closed by default
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Stop progressing')).click())
    const switches = [...host.querySelectorAll('[role="switch"]')]
    act(() => switches[0].click())   // target_load is first and on by default
    expect(o(onChange.mock.calls.at(-1)[0]).completion).toEqual([])
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
    expect(next.preset).toBe('linear')
    expect(planPhase(next).parameters.durationSeconds).toEqual({ min: 45, max: 45 })
    render({ rule: next })
    expect(labels()).toContain('Seconds')
    expect(labels()).not.toContain('Reps')
  })

  it('switches a timed rule back to repetitions by removing its duration', () => {
    const timed = withParams(linear(), { durationSeconds: { min: 45, max: 45 } })
    const onChange = render({ rule: timed })
    expect(button('Reps')).toBeDefined()
    act(() => button('Reps').click())
    expect('durationSeconds' in planPhase(onChange.mock.calls.at(-1)[0]).parameters).toBe(false)
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

  it.each(['ascending', 'descending'])('%s pyramid: sets open into from/to with a button beside the input', direction => {
    const onChange = render({ rule: ruleOf('pyramid', { direction }) })
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
    expect(o(next).sets).toEqual({ min: 2, max: 3 })
    expect(o(next).offsets).toHaveLength(4)
  })

  it('keeps fixed pyramid sets equal to the offset count', () => {
    const onChange = render({ rule: ruleOf('pyramid') })
    act(() => button('Add set').click())
    expect(o(onChange.mock.calls.at(-1)[0]).sets).toEqual({ min: 4, max: 4 })
  })

  const rptRule = () => withParams(ruleOf('pyramid', { direction: 'descending' }), { reps: { min: 6, max: 6 }, offsets: rptOffsets(3, 6) })

  it('Apply RPT rebuilds the sets as 100/90/80 % with reps 6/8/10', () => {
    const onChange = render({ rule: ruleOf('pyramid', { direction: 'descending' }) })
    act(() => button('Apply RPT').click())
    const next = onChange.mock.calls.at(-1)[0]
    expect(o(next).reps).toEqual({ min: 6, max: 6 })
    expect(o(next).offsets).toEqual([{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }])
  })

  it('offers Apply RPT only on a pyramid that starts on its heaviest set', () => {
    render({ rule: ruleOf('pyramid') })
    expect(button('Apply RPT')).toBeUndefined()
  })

  it('Direction flips a pyramid end for end', () => {
    const onChange = render({ rule: ruleOf('pyramid') })
    act(() => [...host.querySelectorAll('.lrow')].find(r => r.textContent.startsWith('Direction')).click())
    const sheet = document.createElement('div')
    document.body.appendChild(sheet)
    const r2 = createRoot(sheet)
    act(() => r2.render(sheetFn(() => {})))
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent.includes('Heaviest set first')).click())
    act(() => r2.unmount()); sheet.remove()
    expect(o(onChange.mock.calls.at(-1)[0]).offsets.map(x => x.percentOfAnchor)).toEqual([100, 85, 70])
  })

  it('Add set grows an ascending pyramid at its light end', () => {
    const onChange = render({ rule: ruleOf('pyramid') })
    act(() => button('Add set').click())
    expect(o(onChange.mock.calls.at(-1)[0]).offsets.map(x => x.percentOfAnchor)).toEqual([70, 70, 85, 100])
  })

  it('Add set on an RPT rule copies the last set with two more reps', () => {
    const onChange = render({ rule: rptRule() })
    act(() => button('Add set').click())
    expect(o(onChange.mock.calls.at(-1)[0]).offsets.at(-1)).toEqual({ percentOfAnchor: 80, reps: 12 })
  })

  it('Same reps every set strips the per-set reps and is hidden when there are none', () => {
    render({ rule: ruleOf('pyramid', { direction: 'descending' }) })
    expect(button('Same reps every set')).toBeUndefined()
    const onChange = render({ rule: rptRule() })
    act(() => button('Same reps every set').click())
    expect(o(onChange.mock.calls.at(-1)[0]).offsets).toEqual([{ percentOfAnchor: 100 }, { percentOfAnchor: 90 }, { percentOfAnchor: 80 }])
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
    const r = withParams(ruleOf('hold_seconds'), { completion: [] })
    const onChange = render({ rule: r })
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Stop progressing')).click())
    act(() => [...host.querySelectorAll('[role="switch"]')].at(-1).click())   // max_duration is the last metric
    expect(o(onChange.mock.calls.at(-1)[0]).completion).toEqual([{ metric: 'max_duration', target: 120 }])
  })

  it('autoregulated: Sets and Reps toggle between a fixed value and a range, the load never does', () => {
    const rule = withParams(ruleOf('autoregulated'), { load: abs(60), reps: { min: 8, max: 12 } })
    const onChange = render({ rule })
    expect(isRange('Sets')).toBe(false)
    expect(isRange('Reps')).toBe(true)   // 8-12 by default
    expect(toggleOf('Starting load')).toBeNull()   // the range comes from starting load → target
    expect(onChange).not.toHaveBeenCalled()
  })

  it('range → fixed collapses to min === max', () => {
    const onChange = render({ rule: ruleOf('autoregulated', { reps: { min: 8, max: 12 } }) })
    act(() => toggleOf('Reps').click())
    expect(o(onChange.mock.calls.at(-1)[0]).reps).toEqual({ min: 8, max: 8 })
  })

  it('keeps min ≤ max while editing a range', () => {
    const onChange = render({ rule: withParams(ruleOf('autoregulated'), { reps: { min: 8, max: 8 } }) })
    act(() => toggleOf('Reps').click())
    const from = [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l').textContent === 'Reps from')
    act(() => from.querySelector('[aria-label="Increase"]').click())
    expect(o(onChange.mock.calls.at(-1)[0]).reps).toEqual({ min: 9, max: 9 })
  })

  it('a fixed field writes the same value to both ends', () => {
    const onChange = render({ rule: linear() })
    const reps = [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l').textContent === 'Reps')
    act(() => reps.querySelector('[aria-label="Increase"]').click())
    expect(o(onChange.mock.calls.at(-1)[0]).reps).toEqual({ min: 6, max: 6 })
  })

  it('changing the load mode clears the load range', () => {
    const onChange = render({ rule: withParams(ruleOf('autoregulated'), { load: abs(60), loadTo: abs(80) }) })
    pick('Starting load', '% 1RM')
    const p = o(onChange.mock.calls.at(-1)[0])
    expect(p.load).toEqual({ mode: 'percent_1rm', percent: 70 })
    expect(p.loadTo).toBeNull()   // read back as none
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

describe('RuleEditor: pyramid sets', () => {
  const set = (n, text) => [...host.querySelectorAll('.stp-l')].find(l => l.textContent === `Set ${n}`)
  const pyramid = () => ruleOf('pyramid_reps')

  it('lists a stepper and a rest per set, with no Sets or Reps field of its own', () => {
    render({ rule: pyramid() })
    expect(labels()).toEqual(expect.arrayContaining(['Set 1', 'Set 2', 'Set 3', 'Set 4']))
    expect(host.querySelector('[data-field="Sets"]')).toBeNull()
    expect(host.querySelector('[data-field="Reps"]')).toBeNull()
    expect(host.textContent).toContain('A set left at 0 rest uses the exercise’s rest.')
  })

  it('adds a set that copies the last, and keeps sets and reps in line with the list', () => {
    const onChange = render({ rule: pyramid() })
    act(() => button('Add set').click())
    const next = onChange.mock.calls.at(-1)[0]
    expect(o(next).setReps).toEqual([12, 10, 8, 6, 6])
    expect(o(next).sets).toEqual({ min: 5, max: 5 })
  })

  it('turns a set into a Max set and back, and removes one with its rest', () => {
    const rule = withParams(pyramid(), { setReps: [12, 8], setRest: [60, 90], sets: { min: 2, max: 2 } })
    const onChange = render({ rule })
    act(() => [...host.querySelectorAll('button')].filter(b => b.textContent === 'Max')[1].click())
    expect(o(onChange.mock.calls.at(-1)[0])).toMatchObject({ setReps: [12, 'max'], setRest: [60, 90] })
    act(() => host.querySelectorAll('button[aria-label="Remove set"]')[0].click())
    expect(o(onChange.mock.calls.at(-1)[0])).toMatchObject({ setReps: [8], setRest: [90] })
  })

  it('a preset chip replaces the list and its rests', () => {
    const onChange = render({ rule: withParams(pyramid(), { setReps: [12, 10, 8, 6], setRest: [60, 60, 60, 60] }) })
    act(() => button('12 · 8 · 6 · Max · 12').click())
    const next = onChange.mock.calls.at(-1)[0]
    expect(o(next).setReps).toEqual([12, 8, 6, 'max', 12])
    expect(o(next).setRest).toBeUndefined()
    expect(o(next).sets).toEqual({ min: 5, max: 5 })
  })

  it('leaves the other presets without it', () => {
    render({ rule: linear() })
    expect(host.textContent).not.toContain('Add set')
    expect(set(1)).toBeUndefined()
  })
})

describe('RuleEditor: the four configurable templates', () => {
  const stepper = label => [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l')?.textContent === label)
  const press = (label, which) => act(() => stepper(label).querySelector(`[aria-label="${which}"]`).click())
  const last = onChange => onChange.mock.calls.at(-1)[0]
  it('a top set and back-off edits its back-off group and stays a valid two-group rule', () => {
    const onChange = render({ rule: withParams(ruleOf('top_set_backoff'), { load: abs(100) }) })
    expect(labels()).toEqual(expect.arrayContaining(['Back-off sets', 'Back-off reps', 'Back-off load (%)', 'Back-off rest (s)']))
    press('Back-off sets', 'Increase')
    const next = last(onChange)
    expect(o(next).backoff).toEqual({ sets: 4, reps: 8, percent: 90, restSeconds: 120 })
    expect(planPhase(next).groups.map(g => [g.id, g.count.min])).toEqual([['top', 1], ['backoff', 4]])
    expect(planPhase(next).parameters.sets).toEqual({ min: 5, max: 5 })
    expect(validatePlanRule(next).ok).toBe(true)
  })
  it('density edits how much rest a clean session takes off and the shortest rest', () => {
    const onChange = render({ rule: withParams(ruleOf('density'), { load: abs(30) }) })
    press('Shortest rest', 'Increase')
    expect(planPhase(last(onChange)).progression).toEqual([{ id: 'rest', metric: 'restSeconds', when: 'success', step: 5, direction: 'down', min: 50, max: 90 }])
    press('Rest taken off per step', 'Decrease')
    expect(o(last(onChange))).toMatchObject({ restStep: 0, restFloor: 45 })
    expect(validatePlanRule(last(onChange)).ok).toBe(true)
  })
  it('accumulation then intensification edits the second block and whether the program starts over', () => {
    const onChange = render({ rule: ruleOf('accumulation_intensification') })
    press('Clean sessions to finish', 'Decrease')
    const next = last(onChange)
    expect(next.program.phases[1].exit).toEqual({ type: 'successes', count: 3 })
    expect(validatePlanRule(next).ok).toBe(true)
    act(() => [...host.querySelectorAll('[role="switch"]')].at(-1).click())
    expect(last(onChange).program.end).toBe('complete')
  })
  it('a program edited past its template is shown, not edited: only choosing a template replaces it', () => {
    const r = linear()
    const custom = { ...r, program: { ...r.program, phases: [{ ...planPhase(r), success: { ...planPhase(r).success, load: 'prescribed' } }] } }
    const onChange = render({ rule: custom })
    expect(host.textContent).toContain('This plan was set up outside the editor. Pick a progression to replace it.')
    expect(labels()).toEqual([])
    expect(onChange).not.toHaveBeenCalled()
  })
})


describe('pyramid per-set loading', () => {
  it('edits a row load and keeps the matching loads when a set is removed', () => {
    const rule = ruleOf('pyramid_reps', { setReps: [12, 8, 6], load: abs(40), setWeights: [40, 50, 60] })
    const onChange = render({ rule })
    const weights = [...host.querySelectorAll('.stp-w')].filter(w => w.querySelector('.stp-l')?.textContent === 'Weight (kg)')
    act(() => weights[1].querySelector('[aria-label="Increase"]').click())
    expect(o(onChange.mock.calls.at(-1)[0]).setWeights).toEqual([40, 52.5, 60])
    const onRemove = render({ rule })
    act(() => host.querySelectorAll('[aria-label="Remove set"]')[1].click())
    expect(o(onRemove.mock.calls.at(-1)[0]).setWeights).toEqual([40, 60])
  })
})
