// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MovementLab from './MovementLab.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root, emit, session, startSession
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  session = { stop: vi.fn() }
  startSession = vi.fn(async ({ onFrame }) => { emit = onFrame; return session })
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async (props = {}) => act(async () => { root.render(<MovementLab startSession={startSession} {...props} />) })
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)
const click = async label => act(async () => { button(label).click() })
const text = () => host.textContent

describe('the movement lab (EP10): camera on request, analysis on the device', () => {
  it('opens no camera until Start is tapped', async () => {
    await mount()
    expect(startSession).not.toHaveBeenCalled()
    expect(text()).toMatch(/never saved or sent/)
  })

  it('starts with the chosen knee, then shows reps and the angle from each frame', async () => {
    await mount()
    await act(async () => { const s = host.querySelector('select'); s.value = 'right'; s.dispatchEvent(new Event('change', { bubbles: true })) })
    await click('Start camera')
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession.mock.calls[0][0]).toMatchObject({ side: 'right' })
    expect(startSession.mock.calls[0][0].video).toBeInstanceOf(HTMLVideoElement)
    await act(async () => { emit({ angle: 92.4, problem: null, reps: 3, landmarks: null }) })
    expect(text()).toMatch(/Reps\s*3/)
    expect(text()).toMatch(/Knee\s*92°/)
    expect(host.querySelector('select').disabled).toBe(true)
  })

  it('a frame without a usable body asks the person to step back and shows no angle', async () => {
    await mount(); await click('Start camera')
    await act(async () => { emit({ angle: null, problem: 'Landmark visibility too low', reps: 0, landmarks: null }) })
    expect(text()).toMatch(/Step back until your hip, knee and ankle are in view/)
    expect(text()).not.toMatch(/Knee\s*\d+°/)
  })

  it('Stop releases the session at once', async () => {
    await mount(); await click('Start camera'); await click('Stop camera')
    expect(session.stop).toHaveBeenCalledTimes(1)
    expect(button('Start camera')).toBeTruthy()
  })

  it('leaving the page releases a running session', async () => {
    await mount(); await click('Start camera')
    act(() => root.unmount()); root = createRoot(host)
    expect(session.stop).toHaveBeenCalledTimes(1)
  })

  it('says plainly why it cannot start', async () => {
    for (const [code, re] of [['denied', /declined/], ['model', /pose model is not in this build/], ['unavailable', /no camera/]]) {
      startSession = vi.fn(async () => { throw Object.assign(new Error(code), { code }) })
      await mount(); await click('Start camera')
      expect(host.querySelector('[role="alert"]').textContent).toMatch(re)
      act(() => root.unmount()); root = createRoot(host)
    }
  })
})
