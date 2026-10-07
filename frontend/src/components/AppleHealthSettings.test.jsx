// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ enabled: false, available: vi.fn(), enable: vi.fn(), disable: vi.fn(), sync: vi.fn() }))
vi.mock('../lib/apple-health.js', () => ({
  appleHealthAvailable: mocks.available, appleHealthEnabled: () => mocks.enabled,
  enableAppleHealth: mocks.enable, disableAppleHealth: mocks.disable, syncAppleHealth: mocks.sync,
}))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ user: null }) }))
vi.mock('../lib/i18n-core.js', () => ({ t: (key, value) => key.replace('{0}', value) }))
vi.mock('./ui.jsx', () => ({
  Row: ({ title, subtitle, children, onClick }) => <div><button onClick={onClick}>{title}</button><span>{subtitle}</span>{children}</div>,
  Switch: ({ checked, disabled, onChange, ...props }) => <button {...props} role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} />,
}))
import AppleHealthSettings from './AppleHealthSettings.jsx'
let root, host
beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled = false
  mocks.available.mockResolvedValue(true)
  mocks.enable.mockImplementation(async () => { mocks.enabled = true })
  mocks.disable.mockImplementation(() => { mocks.enabled = false })
  mocks.sync.mockResolvedValue({ imported: 0, weights: 0, workouts: 0 })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function render() { await act(async () => root.render(<AppleHealthSettings />)) }
it('hides the native integration when unavailable', async () => {
  mocks.available.mockResolvedValue(false); await render()
  expect(host.querySelector('[role=switch]')).toBeNull()
})
it('requests permission on enabling, then syncs; disabling does not request permission again', async () => {
  await render(); await act(async () => host.querySelector('[role=switch]').click())
  expect(mocks.enable).toHaveBeenCalledOnce(); expect(mocks.sync).toHaveBeenCalledOnce()
  expect(host.querySelector('[role=switch]').getAttribute('aria-checked')).toBe('true')
  await act(async () => host.querySelector('[role=switch]').click())
  expect(mocks.disable).toHaveBeenCalledOnce()
  expect(host.querySelector('[role=switch]').getAttribute('aria-checked')).toBe('false')
})
it('shows native errors and restores the switch after a failed request', async () => {
  mocks.enable.mockRejectedValueOnce(new Error('Health permission failed'))
  await render(); await act(async () => host.querySelector('[role=switch]').click())
  expect(host.querySelector('[role=alert]').textContent).toContain('Health permission failed')
  expect(host.querySelector('[role=switch]').disabled).toBe(false)
  expect(mocks.sync).not.toHaveBeenCalled()
})
it('disables the switch while authorization is pending', async () => {
  let finish; mocks.enable.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); await act(async () => host.querySelector('[role=switch]').click())
  expect(host.querySelector('[role=switch]').disabled).toBe(true)
  expect(host.textContent).toContain('Connecting…')
  await act(async () => finish())
  expect(host.querySelector('[role=switch]').disabled).toBe(false)
})
