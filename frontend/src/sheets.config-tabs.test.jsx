// @vitest-environment happy-dom
// The exercise settings sheet in three tabs — Target, Progression, Options — over panels that all
// stay mounted: switching shows another one without losing what was typed, and the foot keeps
// the plan as it reads now beside the way to save it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB, isCardio } from './lib/exercises.js'
import { planPhase, validatePlanRule } from './lib/prescription/index.js'
import { ruleOccurrence } from './lib/test-fixtures.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

const ex = EXDB.find(e => e.id === '0009')
const bench = EXDB.find(e => e.id === '0025')
const cardio = EXDB.find(e => isCardio(e.id))
const mounted = []
let host

function open(exercise, existing, ...rest) {
  exConfigSheet(exercise, existing, ...rest)
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const tab = id => host.querySelector(`#xc-tab-${id}`)
const panel = id => host.querySelector(`#xc-panel-${id}`)
const visible = () => ['target', 'progression', 'options'].filter(id => !panel(id).hidden)
const field = label => [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l')?.textContent === label)
const press = (el, key) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
const save = () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save')

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(([root, el]) => { root.unmount(); el.remove() }) }) })

describe('exercise settings: tabs', () => {
  it('opens on Target, with the other two panels there but hidden', () => {
    open(ex, ruleOccurrence(ex.id, { occurrenceId: 'o1', routineId: 'r1' }), vi.fn())
    expect(host.querySelector('[role="tablist"]')).toBeTruthy()
    expect([...host.querySelectorAll('[role="tab"]')].map(t => t.textContent)).toEqual(['Target', 'Progression', 'Options'])
    expect(tab('target').getAttribute('aria-selected')).toBe('true')
    expect(visible()).toEqual(['target'])
    expect(tab('options').getAttribute('aria-controls')).toBe('xc-panel-options')
    expect(panel('options').getAttribute('aria-labelledby')).toBe('xc-tab-options')
  })

  it('sorts the form by what it decides: loads and reps to Target, the step to Progression, switches to Options', () => {
    open(bench, ruleOccurrence(bench.id, { occurrenceId: 'o1', routineId: 'r1' }), vi.fn())
    expect(panel('target').contains(field('Sets'))).toBe(true)
    expect(panel('target').querySelector('[data-field="Sets"]')).toBeTruthy()
    const titles = id => [...panel(id).querySelectorAll('.lrow-t')].map(el => el.textContent)
    expect(panel('progression').textContent).toContain('Increase load by')
    expect(titles('options')).toContain('Bodyweight')
    expect(titles('target')).not.toContain('Bodyweight')
  })

  it('shows the panel of the tab pressed, and arrows and Home/End walk the tabs', () => {
    open(ex, ruleOccurrence(ex.id, { occurrenceId: 'o1', routineId: 'r1' }), vi.fn())
    act(() => tab('progression').click())
    expect(visible()).toEqual(['progression'])
    expect(tab('progression').tabIndex).toBe(0)
    expect(tab('target').tabIndex).toBe(-1)
    press(tab('progression'), 'ArrowRight')
    expect(visible()).toEqual(['options'])
    press(tab('options'), 'ArrowRight')
    expect(visible()).toEqual(['target'])
    press(tab('target'), 'ArrowLeft')
    expect(visible()).toEqual(['options'])
    press(tab('options'), 'Home')
    expect(visible()).toEqual(['target'])
    press(tab('target'), 'End')
    expect(visible()).toEqual(['options'])
    expect(document.activeElement).toBe(tab('options'))
  })

  it('keeps what was edited on a tab when another one is shown and back, and saves all of it', () => {
    const onSave = vi.fn()
    const existing = ruleOccurrence(ex.id, { occurrenceId: 'o1', routineId: 'r1', preset: 'double' })
    open(ex, existing, onSave)
    act(() => field('Reps to').querySelector('[aria-label="Increase"]').click())
    act(() => tab('options').click())
    act(() => tab('target').click())
    expect(field('Reps to').querySelector('input').value).toBe(String(planPhase(existing.rule).parameters.reps.max + 1))
    act(() => save().click())
    const saved = onSave.mock.calls[0][0]
    expect(planPhase(saved.rule).parameters.reps.max).toBe(planPhase(existing.rule).parameters.reps.max + 1)
    expect(validatePlanRule(saved.rule).ok).toBe(true)
  })
})

describe('exercise settings: the foot', () => {
  it('reads the plan as it is now, and follows an edit', () => {
    const existing = ruleOccurrence(ex.id, { occurrenceId: 'o1', routineId: 'r1', preset: 'double' })
    open(ex, existing, vi.fn())
    const foot = () => host.querySelector('.xc-foot .xc-sum').textContent
    const reps = planPhase(existing.rule).parameters.reps
    expect(foot()).toMatch(new RegExp(`× ${reps.min}–${reps.max}`))
    act(() => field('Reps to').querySelector('[aria-label="Increase"]').click())
    expect(foot()).toMatch(new RegExp(`× ${reps.min}–${reps.max + 1}`))
  })

  it('stays in view from every tab, and names the save after the caller\'s word', () => {
    open(ex, null, vi.fn())
    act(() => tab('options').click())
    const button = host.querySelector('.xc-foot .btn.primary')
    expect(button.textContent.trim()).toBe('Add to routine')
    expect(button.disabled).toBe(false)
  })
})

describe('exercise settings: ⋯ actions', () => {
  it('is only there when the sheet has something to do besides save', () => {
    open(ex, null, vi.fn())
    expect(host.querySelector('button[aria-label="More"]')).toBeNull()
    open(ex, ruleOccurrence(ex.id, { occurrenceId: 'o1', routineId: 'r1' }), vi.fn(), vi.fn())
    expect(host.querySelector('button[aria-label="More"]')).toBeTruthy()
  })

  it('lists Remove from routine when the caller can remove, and hands over after closing', () => {
    const onDelete = vi.fn()
    open(ex, ruleOccurrence(ex.id, { occurrenceId: 'o1', routineId: 'r1' }), vi.fn(), onDelete)
    act(() => host.querySelector('button[aria-label="More"]').click())
    const menu = useUI.getState().sheets.at(-1)
    const menuHost = document.createElement('div')
    document.body.appendChild(menuHost)
    const root = createRoot(menuHost)
    mounted.push([root, menuHost])
    act(() => root.render(menu.render(() => useUI.getState().closeSheet(menu.id))))
    const item = [...menuHost.querySelectorAll('.menu-item')].find(i => i.textContent.trim() === 'Remove from routine')
    expect(item.classList.contains('danger')).toBe(true)
    act(() => item.click())
    expect(onDelete).toHaveBeenCalledOnce()
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})

describe('exercise settings: cardio', () => {
  it('keeps the intervals on Target and says on Progression that strength templates do not apply', () => {
    open(cardio, null, vi.fn())
    expect(panel('target').textContent).toContain('Intervals')
    expect(panel('progression').textContent).toContain('Strength progression templates do not apply.')
    expect(host.querySelector('.xc-foot .xc-sum')).toBeNull()
  })
})
