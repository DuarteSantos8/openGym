// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { CheckinReminderRow } from './CheckinReminder.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const render = (S, el) => {
  useStore.setState({ S: { ...structuredClone(DEF), ...S } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(el))
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

// Owner 2026-11-24: the check-in shortcut on Photos and Measurements, but as a setting.
describe('check-in reminder shortcut on Photos and Measurements', () => {
  it('shows on the pages by default', () => {
    expect(render({}, <CheckinReminderRow page />).textContent).toMatch(/Check-in reminders/)
  })
  it('switched off, the pages leave it out and Settings still has it', () => {
    expect(render({ checkinShortcut: false }, <CheckinReminderRow page />).textContent).toBe('')
    act(() => root.unmount()); host.remove()
    expect(render({ checkinShortcut: false }, <CheckinReminderRow />).textContent).toMatch(/Check-in reminders/)
  })
})
