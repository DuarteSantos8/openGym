// @vitest-environment happy-dom
// #817: the print step, "With pictures" on by default and remembered on this device.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ resolve: null }))
vi.mock('../lib/plan-share.js', () => ({
  printPlan: vi.fn((S, owner, opts) => new Promise(res => { env.resolve = () => { opts.beforePrint?.(); res() } })),
}))

import PrintPlanSheet from './PrintPlanSheet.jsx'
import { printPlan } from '../lib/plan-share.js'
import { DEF, useStore } from '../store/useStore.js'
import { PRINT_PICTURES_KEY } from '../lib/print-pictures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host, close

function mount(props = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  close = vi.fn()
  act(() => root.render(<PrintPlanSheet {...props} close={close} />))
}
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const toggle = () => host.querySelector('[role="switch"]')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'u1', name: 'Ana' } })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('PrintPlanSheet', () => {
  it('prints with pictures by default, says it is loading, then closes', async () => {
    mount({ routineId: 'r1', name: 'Push day' })
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    await act(async () => button('Print / Save as PDF').click())
    expect(printPlan).toHaveBeenCalledOnce()
    const [, owner, opts] = printPlan.mock.calls[0]
    expect(owner).toBe('Ana')
    expect(opts).toMatchObject({ routineId: 'r1', name: 'Push day', withPictures: true })
    expect(button('Loading…').disabled).toBe(true)
    expect(close).not.toHaveBeenCalled()
    await act(async () => env.resolve())
    expect(close).toHaveBeenCalledOnce()
  })

  it('remembers "off" on this device and prints the plain list then', async () => {
    mount()
    act(() => toggle().click())
    expect(localStorage.getItem(PRINT_PICTURES_KEY)).toBe('0')
    await act(async () => button('Print / Save as PDF').click())
    expect(printPlan.mock.calls[0][2]).toMatchObject({ withPictures: false })
    expect(printPlan.mock.calls[0][2].routineId).toBeUndefined()
    await act(async () => env.resolve())
    act(() => root.unmount())
    host.remove()
    mount()
    expect(toggle().getAttribute('aria-checked')).toBe('false')
  })
})
