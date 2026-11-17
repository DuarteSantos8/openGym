// @vitest-environment happy-dom
// A sheet is a dialog (1.4.5 QA): named, modal, focused on open, and the focus goes back to the
// button that opened it. Before, the focus stayed on the page behind and ended on <body>.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Modals from './Modals.jsx'

const mocks = vi.hoisted(() => {
  const listeners = new Set()
  const state = {
    sheets: [],
    closeSheet(id) { state.sheets = state.sheets.filter(s => s.id !== id); listeners.forEach(l => l()) },
  }
  return { state, subscribe(l) { listeners.add(l); return () => listeners.delete(l) }, setSheets(s) { state.sheets = s; listeners.forEach(l => l()) } }
})
vi.mock('../store/useUI.js', async () => {
  const React = await import('react')
  const useUI = (sel = s => s) => React.useSyncExternalStore(mocks.subscribe, () => sel(mocks.state), () => sel(mocks.state))
  useUI.getState = () => mocks.state
  return { useUI }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root, opener
const set = sheets => act(async () => { mocks.setSheets(sheets) })
const dialogs = () => [...document.querySelectorAll('#modal-root [role="dialog"]')]

beforeEach(async () => {
  window.scrollTo = vi.fn()
  vi.spyOn(history, 'pushState').mockImplementation(() => {})
  vi.spyOn(history, 'go').mockImplementation(() => {})
  document.body.innerHTML = '<button id="opener">Log</button><input id="field"><div id="host"></div>'
  opener = document.getElementById('opener')
  host = document.getElementById('host')
  root = createRoot(host)
  mocks.state.sheets = []
  await act(async () => { root.render(<Modals />) })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  vi.restoreAllMocks()
})

const weighIn = { id: 1, kind: 'sheet', render: () => <><h3>Log body weight</h3><input id="w" /><button id="save">Save</button></> }

describe('a sheet as a dialog', () => {
  it('is a modal dialog named after its heading, for a bottom sheet and a centred one', async () => {
    await set([weighIn])
    const [d] = dialogs()
    expect(d.className).toBe('sheet')
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(d.getAttribute('aria-label')).toBe('Log body weight')
    await set([{ id: 2, kind: 'center', render: () => <><h3>Workout complete!</h3><button>Nice!</button></> }])
    expect(dialogs()[0].className).toContain('center')
    expect(dialogs()[0].getAttribute('aria-label')).toBe('Workout complete!')
  })

  it('takes the focus when it opens, on the sheet itself and not on its first field', async () => {
    opener.focus()
    await set([weighIn])
    expect(document.activeElement).toBe(dialogs()[0])
  })

  it('hands the focus back to the button that opened it', async () => {
    opener.focus()
    await set([weighIn])
    await set([])
    expect(document.activeElement).toBe(opener)
  })

  it('does not put the focus back into a text field (the keyboard would come up again)', async () => {
    document.getElementById('field').focus()
    await set([weighIn])
    await set([])
    expect(document.activeElement).not.toBe(document.getElementById('field'))
  })

  it('a second sheet opened from the first gives the focus back to the first one\'s button', async () => {
    opener.focus()
    await set([weighIn])
    document.getElementById('save').focus()
    const second = { id: 3, kind: 'sheet', render: () => <><h3>Sure?</h3><button id="yes">Yes</button></> }
    await set([weighIn, second])
    expect(document.activeElement).toBe(dialogs()[1])
    await set([weighIn])
    expect(document.activeElement).toBe(document.getElementById('save'))
  })

  it('keeps Tab inside the sheet on top', async () => {
    opener.focus()
    await set([weighIn])
    // happy-dom has no layout, so nothing counts as on screen: the sheet keeps the focus itself.
    opener.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    await act(async () => { window.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    expect(dialogs()[0].contains(document.activeElement)).toBe(true)
  })
})
