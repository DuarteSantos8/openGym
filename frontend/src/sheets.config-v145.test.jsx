// @vitest-environment happy-dom
// The v1.4.5 slot settings on the v2 exercise editor: tempo (#572), the rest into the next exercise
// (D#487), the bands a set starts with, a cardio machine's resistance level. Opened, saved, kept.
import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX } from './lib/exercises.js'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { ruleOccurrence } from './lib/test-fixtures.js'
import { occurrenceFromConfig } from './lib/routines.js'

const mounted = []
afterEach(() => { act(() => mounted.splice(0).forEach(r => r.unmount())); document.body.innerHTML = '' })
function open(ex, existing) {
  const onSave = vi.fn()
  exConfigSheet(ex, existing, onSave)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())
  return { host, saved: onSave.mock.calls[0]?.[0] }
}

describe('the 1.4.5 slot settings', () => {
  it("keep a lift's tempo, its rest into the next exercise and the bands it starts with", () => {
    useStore.setState({ S: { ...structuredClone(DEF), bandEx: { '0025': true } }, user: null })
    const { host, saved } = open(EXIDX['0025'], { ...ruleOccurrence('0025'), tempo: '3-1-1-0', nextRestSec: 180, bands: ['b1'] })
    expect(host.textContent).toContain('Rest before the next exercise')
    expect(host.textContent).toContain('3-1-1-0')
    expect(saved).toMatchObject({ tempo: '3-1-1-0', nextRestSec: 180, bands: ['b1'] })
  })
  it('keep "No timer" into the next exercise', () => {
    useStore.setState({ S: structuredClone(DEF), user: null })
    expect(open(EXIDX['0025'], { ...ruleOccurrence('0025'), nextRestOff: true }).saved.nextRestOff).toBe(true)
  })
  it("keep a bike's resistance level", () => {
    useStore.setState({ S: structuredClone(DEF), user: null })
    const bike = Object.values(EXIDX).find(e => e.bp === 'cardio' && /bike/i.test(e.n))
    const occ = occurrenceFromConfig(DEF, { id: bike.id, mode: 'cardio', sets: 1, min: 20, speed: 20, level: 8 })
    expect(occ.cardio.level).toBe(8)
    expect(open(bike, occ).saved.cardio.level).toBe(8)
  })
})
