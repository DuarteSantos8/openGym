// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

// The warm-up line under "Warm-up sets" promised they stay out of volume, which stopped being true
// for a profile with Settings > Units > "Count warm-ups in volume" (#719) switched on.
const ex = EXDB.find(e => e.id === '0009')
const mounted = []

function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const open = volumeWarmups => {
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', volumeWarmups } }))
  exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', warmupSets: 2 }, () => {})
  return render(useUI.getState().sheets.at(-1))
}

describe('exercise settings: what the warm-up line says about volume', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('says warm-ups stay out of volume while the setting is off', () => {
    expect(open(false).textContent).toContain('left out of volume, records and progression')
  })

  it('says they count in volume, but not in records or progression, once it is on', () => {
    const text = open(true).textContent
    expect(text).not.toContain('left out of volume')
    expect(text).toContain('They count in your volume (Settings), but stay out of records and progression')
  })
})
