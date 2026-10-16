// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Plan from './Plan.jsx'
import Settings from './Settings.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const roots = []
beforeEach(() => localStorage.clear())
afterEach(() => { act(() => roots.splice(0).forEach(root => root.unmount())); document.body.innerHTML = '' })
const render = element => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  act(() => root.render(<MemoryRouter>{element}</MemoryRouter>))
  return host
}
const tabs = host => [...host.querySelectorAll('.plan-views button')].map(button => button.textContent)

describe('Programme presentation opt-in', () => {
  it('adds Programmes between the current Schedule and Routines views without replacing Schedule', () => {
    useStore.setState({ S: { ...structuredClone(DEF), programmeMode: false } })
    let host = render(<Plan />)
    expect(tabs(host)).toEqual(['Schedule', 'Routines'])
    expect(host.textContent).toContain('How you train')
    expect(host.textContent).not.toContain('New programme')
    act(() => roots.pop().unmount()); host.remove()
    useStore.setState({ S: { ...structuredClone(DEF), programmeMode: true } })
    host = render(<Plan />)
    expect(tabs(host)).toEqual(['Schedule', 'Programmes', 'Routines'])
    act(() => [...host.querySelectorAll('.plan-views button')].find(button => button.textContent === 'Programmes').click())
    expect(host.textContent).toContain('New programme')
    expect(host.textContent).toContain('No ready programmes')
  })

  it('exposes the opt-in on the current Plan settings page and retains data when disabled', () => {
    const programme = { id: 'p1' }; const active = { id: 'w1', programmeInstanceId: 'c1:s1' }
    useStore.setState({ S: { ...structuredClone(DEF), programmeMode: true, programmes: { version: 1, definitions: [programme], cycles: [] }, active } })
    const host = render(<Settings page="plan" />)
    expect(host.textContent).toContain('Programme mode')
    const toggle = host.querySelector('[role="switch"]')
    expect(toggle).toBeTruthy()
    act(() => toggle.click())
    expect(useStore.getState().S).toMatchObject({ programmeMode: false, active, programmes: { definitions: [programme] } })
  })
})
