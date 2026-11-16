// @vitest-environment happy-dom
// A saved exercise config replaces the routine's occurrence, so what the sheet does not edit has
// to ride along: a machine marked (not) assisted, a ramp's own rest, an exercise kept out of
// progression. Losing them on the first edit would undo what the v1 migration carried over.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX, isAssisted } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { ruleOccurrence } from './lib/test-fixtures.js'

const MACHINE = Object.keys(EXIDX).find(k => isAssisted(k))
const mounted = []
function open(id, existing) {
  useStore.setState({ S: structuredClone(DEF), user: null })
  const onSave = vi.fn()
  exConfigSheet(EXIDX[id], existing, onSave, null, null)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return { host, onSave, save: [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save') }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('saving an exercise config', () => {
  it('keeps the fields the sheet does not edit', () => {
    const existing = { ...ruleOccurrence('0025'), assisted: true, warmupRestSec: 31, excludeFromProgression: true }
    const { save, onSave } = open('0025', existing)
    act(() => save.click())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assisted: true, warmupRestSec: 31, excludeFromProgression: true, exerciseId: '0025' }))
  })

  it('adds nothing that was not there', () => {
    const { save, onSave } = open('0025', ruleOccurrence('0025'))
    act(() => save.click())
    const saved = onSave.mock.calls[0][0]
    for (const key of ['assisted', 'warmupRestSec', 'excludeFromProgression']) expect(saved).not.toHaveProperty(key)
  })

  it('an assistance machine\'s step is labelled as help taken away, unless the occurrence says it is not assisted', () => {
    expect(open(MACHINE, ruleOccurrence(MACHINE)).host.textContent).toContain('Reduce assistance by')
    expect(open(MACHINE, { ...ruleOccurrence(MACHINE), assisted: false }).host.textContent).toContain('Increase load by')
    expect(open('0025', { ...ruleOccurrence('0025'), assisted: true }).host.textContent).toContain('Reduce assistance by')
  })
})


it('edits failure and back-off flags without dropping the dumbbell load meaning', () => {
  const existing = { ...ruleOccurrence('0289'), dbLoad: 'each' }
  const { host, save, onSave } = open('0289', existing)
  for (const title of ['Last set to failure', 'Back-off sets']) {
    const row = [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes(title))
    act(() => row.querySelector('[role=switch]').click())
  }
  act(() => save.click())
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dbLoad: 'each', lastToFailure: true, backoff: true }))
})
