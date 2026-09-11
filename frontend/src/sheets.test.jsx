// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { POLICIES_FOR, POLICY_NAME } from './lib/progression.js'

const ex = EXDB.find(e => e.id === '0009')
const mounted = []

function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function renderConfig(onSave = vi.fn(), existing = { sets: 3, reps: 10, weight: 0, mode: 'reps', prog: 'double' }) {
  exConfigSheet(ex, existing, onSave)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const stepper = [...host.querySelectorAll('.stp-w')]
    .find(el => el.querySelector('.stp-l')?.textContent.startsWith('Step'))
  return { host, step: stepper.querySelector('input'), onSave }
}

describe('exercise configuration progression step', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  })

  it('keeps the draft empty while clearing the default so a sub-one comma decimal can be entered', () => {
    const { step } = renderConfig()
    expect(step.value).toBe('2.5')

    act(() => { type(step, '') })
    expect(step.value).toBe('')

    act(() => { type(step, '0,5') })
    expect(step.value).toBe('0.5')
  })

  it('blocks saving without a positive progression step but accepts a positive decimal', () => {
    const config = renderConfig()
    const save = [...config.host.querySelectorAll('button')]
      .find(b => /^(save|add to routine)$/i.test(b.textContent.trim()))

    act(() => { type(config.step, '') })
    expect(config.step.value).toBe('')
    expect(config.step.getAttribute('aria-invalid')).toBe('true')
    expect(save.disabled).toBe(true)
    expect(config.host.textContent).toContain('Enter a positive step to use this progression rule.')

    act(() => { save.click() })
    expect(config.onSave).not.toHaveBeenCalled()
    expect(useUI.getState().sheets).toHaveLength(1)

    act(() => { type(config.step, '0') })
    expect(save.disabled).toBe(true)

    act(() => { type(config.step, '0,5') })
    expect(config.step.value).toBe('0.5')
    expect(config.step.getAttribute('aria-invalid')).not.toBe('true')
    expect(save.disabled).toBe(false)

    act(() => { save.click() })
    expect(config.onSave).toHaveBeenCalledWith(expect.objectContaining({ inc: 0.5 }))
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})

describe('wave configuration', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  })

  it('offers the wave rule on reps work', () => {
    expect(POLICIES_FOR.reps).toContain('wave')
    expect(POLICY_NAME.wave).toBeTruthy()
  })

  it('saves the training max and only the non-default switches', () => {
    const config = renderConfig(vi.fn(), {
      sets: 3, reps: 5, weight: 0, mode: 'reps', prog: 'wave',
      trainingMax: 100, pctBase: 'tm', onMiss: 'advance', bump: 'step',
    })
    const save = [...config.host.querySelectorAll('button')]
      .find(b => /^(save|add to routine)$/i.test(b.textContent.trim()))
    act(() => { save.click() })
    const saved = config.onSave.mock.calls[0][0]
    expect(saved.trainingMax).toBe(100)
    expect(saved.onMiss).toBe('advance')
    expect(saved.pctBase).toBeUndefined()
    expect(saved.bump).toBeUndefined()
  })

  it('"Add a set" appends a fresh-id block and never persists a role into the saved wave', () => {
    const config = renderConfig(vi.fn(), {
      sets: 3, reps: 5, weight: 0, mode: 'reps', prog: 'wave', trainingMax: 100,
    })
    const addSet = [...config.host.querySelectorAll('button')]
      .find(b => /add a set/i.test(b.textContent.trim()))
    act(() => { addSet.click() })
    const save = [...config.host.querySelectorAll('button')]
      .find(b => /^(save|add to routine)$/i.test(b.textContent.trim()))
    act(() => { save.click() })
    const saved = config.onSave.mock.calls[0][0]
    // The default first stage has 3 blocks; "Add a set" duplicates its last one.
    expect(saved.wave[0].blocks.length).toBe(4)
    const ids = saved.wave[0].blocks.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length) // the copy got its own id, not a duplicate
    // Fix 3: setWave strips the derived `role` before persisting, everywhere.
    expect(saved.wave.flatMap(w => w.blocks).every(b => !('role' in b))).toBe(true)
  })
})
