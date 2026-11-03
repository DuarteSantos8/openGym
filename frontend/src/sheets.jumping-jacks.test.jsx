// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIDX } from './lib/exercises.js'
import { exConfigSheet } from './sheets.jsx'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

const mounted = []
function open(existing) {
  const onSave = vi.fn()
  exConfigSheet(EXIDX['3094'], existing, onSave)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const labels = [...host.querySelectorAll('.stp-l')].map(el => el.textContent)
  const save = () => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())
  return { host, labels, save, onSave }
}

describe('jumping-jack exercise settings', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
  })
  afterEach(() => act(() => mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() })))

  it('offers sets and reps for a newly added jumping jack', () => {
    const { labels } = open()
    expect(labels).toContain('Sets')
    expect(labels).toContain('Reps')
    expect(labels).not.toContain('Minutes')
    expect(labels).not.toContain('Intervals')
  })

  it('keeps the cardio form and values when editing a plan saved before the catalogue fix', () => {
    const { labels, save, onSave } = open({ sets: 2, min: 5, speed: 8 })
    expect(labels).toContain('Intervals')
    expect(labels).toContain('Minutes')
    expect(labels).not.toContain('Reps')
    save()
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sets: 2, min: 5, speed: 8 }))
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('reps')
  })
})
