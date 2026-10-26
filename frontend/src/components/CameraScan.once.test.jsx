// @vitest-environment happy-dom
// scanOnce in a browser: the camera sheet answers once — the code, or null when it goes away
// without one. StrictMode's extra unmount on the way in must not answer null before any scan
// (it did: the scan button in a workout then did nothing in the dev build).
import React, { StrictMode, act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useUI } from '../store/useUI.js'
import { scanOnce } from './CameraScan.jsx'

const roots = []
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 5)) })
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(<StrictMode>{sheet.render(() => useUI.getState().closeSheet(sheet.id))}</StrictMode>))
  return { host, root }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { roots.splice(0).forEach(r => r.unmount()) }) })

describe('scanOnce (browser)', () => {
  it('stays open under StrictMode until it is cancelled, then answers null', async () => {
    let answer = 'pending'
    scanOnce().then(v => { answer = v })
    const { host } = renderTop()
    await tick()
    expect(answer).toBe('pending')
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click())
    await tick()
    expect(answer).toBeNull()
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('answers null when the sheet goes away some other way', async () => {
    let answer = 'pending'
    scanOnce().then(v => { answer = v })
    const { root } = renderTop()
    await tick()
    act(() => root.unmount())
    roots.pop()
    await tick()
    expect(answer).toBeNull()
  })
})
