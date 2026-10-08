// @vitest-environment happy-dom
// /workout has no chooser of its own: without an active session it hands off to
// Start (the one place that starts workouts), so deep links keep working and two
// screens never compete over the same job.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Workout from './Workout.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Workout without a session', () => {
  it('hands off to Start instead of rendering a second chooser', () => {
    useStore.setState(s => ({ S: { ...s.S, active: null }, user: null }))
    act(() => root.render(<Workout />))
    expect(nav).toHaveBeenCalledWith('/start', { replace: true })
    expect(host.querySelector('.narrow')).toBe(null)
  })
})
