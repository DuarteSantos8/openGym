// @vitest-environment happy-dom
// On a wide window the workout keeps a column for the rest bar (useUI timerSlot, Workout.jsx):
// the bar draws itself there, and floats over the page again once the slot is gone.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import RestTimer from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, slot, root

beforeEach(() => {
  host = document.createElement('div')
  slot = document.createElement('div')
  document.body.append(host, slot)
  root = createRoot(host)
  useUI.setState({ timer: { left: 60, total: 90, endsAt: Date.now() + 60000 }, work: null, timerSlot: null })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove(); slot.remove()
  useUI.setState({ timer: null, timerSlot: null })
})

it('sits in the slot while there is one, and over the page without it', () => {
  act(() => root.render(<RestTimer />))
  expect(host.querySelector('#timer')).not.toBeNull()
  act(() => useUI.getState().setTimerSlot(slot))
  expect(host.querySelector('#timer')).toBeNull()
  expect(slot.querySelector('#timer .tclock')).not.toBeNull()
  act(() => useUI.getState().setTimerSlot(null))
  expect(host.querySelector('#timer')).not.toBeNull()
})
