// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ProgressionLab from './ProgressionLab.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async () => act(async () => { root.render(<ProgressionLab unit="kg" />) })
const setVal = (label, v) => act(() => {
  const el = host.querySelector(`[aria-label="${label}"]`)
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const simulate = () => act(() => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
const alerts = () => [...host.querySelectorAll('[role="alert"]')].map(a => a.textContent)

describe('the progression rule lab (EP09, simulation only)', () => {
  it('runs the example rule against openGym over 12 weeks and finds no difference', async () => {
    await mount(); await simulate()
    expect(host.querySelector('[data-summary]').textContent).toMatch(/Matches openGym on every week/)
    expect(host.querySelectorAll('tbody tr')).toHaveLength(12)
    expect(alerts()).toEqual([])
  })

  it('shows the native deload a stateless rule cannot express as a difference', async () => {
    await mount(); await setVal('Session outcomes', 'HMMMHHHH'); await simulate()
    expect(host.querySelector('[data-summary]').textContent).toMatch(/^\d+ weeks? of \d+ differs? from openGym\.$/)
    expect(host.textContent).toMatch(/\(deload\)/)
    expect(host.querySelectorAll('tbody tr[data-diverges]').length).toBeGreaterThan(0)
  })

  it('warns when a rule adds load after a missed session', async () => {
    await mount(); await setVal('Progression rule', 'weight += 2.5'); await setVal('Session outcomes', 'HMHM'); await simulate()
    expect(alerts().join(' ')).toMatch(/2 weeks add load after a missed session/)
  })

  it('says why a rule cannot run instead of guessing', async () => {
    await mount(); await setVal('Progression rule', 'weight = fetch(1)'); await simulate()
    expect(alerts().join(' ')).toMatch(/This rule cannot run/)
    expect(host.querySelector('table')).toBeNull()
  })

  it('rejects an outcome pattern or start weight it cannot simulate', async () => {
    await mount(); await setVal('Session outcomes', 'HHX'); await simulate()
    expect(alerts().join(' ')).toMatch(/Use H for a session/)
    await setVal('Session outcomes', 'HH'); await setVal('Start weight', '-3'); await simulate()
    expect(alerts().join(' ')).toMatch(/start weight/i)
    expect(host.querySelector('table')).toBeNull()
  })
})
