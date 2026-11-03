// @vitest-environment happy-dom
// #756: deleting a weigh-in could not be taken back. The log sheet deletes in one tap on purpose
// (a typo just typed), so the safety is an Undo in the toast, the way Plan does it for a routine.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { mergeStates } from './lib/sync-merge.js'
import { bwSheet, weighInsSheet } from './sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const days = () => useStore.getState().S.bodyweight.map(b => b.d)

const LOG = [
  { d: '2026-09-01', w: 81, t: 1 }, { d: '2026-09-03', w: 80, t: 2 },
  { d: '2026-09-07', w: 80.5, t: 3 }, { d: '2026-09-09', w: 79.5, t: 4 }, { d: '2026-09-13', w: 79, t: 5 },
]
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  document.body.innerHTML = ''
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', bodyweight: clone(LOG), weekStart: 1, targetW: null })
  useStore.setState({ S, user: null })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('deleting a weigh-in can be undone (#756)', () => {
  it('the log sheet\'s one-tap delete offers Undo, and Undo puts the weigh-in back', () => {
    bwSheet()
    const log = mountTopSheet()
    act(() => { log.querySelector('button[aria-label="Delete weigh-in"]').click() })
    expect(days()).not.toContain('2026-09-13')
    const ui = useUI.getState()
    expect(ui.toastMsg).toBe('Weigh-in deleted')
    expect(ui.toastAction?.label).toBe('Undo')
    act(() => { useUI.getState().runToastAction() })
    expect(days()).toEqual(LOG.map(b => b.d))
    expect(useStore.getState().S.bodyweight.find(b => b.d === '2026-09-13').w).toBe(79)
  })

  it('the full list asks first, then offers Undo too', () => {
    weighInsSheet()
    const host = mountTopSheet()
    act(() => { host.querySelector('[data-week="2026-08-31"] button[aria-label="Delete weigh-in"]').click() })
    const ask = mountTopSheet()
    act(() => { button(ask, 'Delete').click() })
    expect(days()).not.toContain('2026-09-03')
    expect(useUI.getState().toastAction?.label).toBe('Undo')
    act(() => { useUI.getState().runToastAction() })
    expect(days()).toContain('2026-09-03')
  })

  // The removal is on record (S.deleted) the moment it happens, and a device that synced it must
  // not take the weigh-in away again after the Undo.
  it('survives a merge with a copy that only saw the removal', () => {
    bwSheet()
    const log = mountTopSheet()
    act(() => { log.querySelector('button[aria-label="Delete weigh-in"]').click() })
    const server = clone(useStore.getState().S)
    expect(server.deleted.bodyweight['2026-09-13']).toBeGreaterThan(0)
    act(() => { useUI.getState().runToastAction() })
    const local = useStore.getState().S
    expect(local.deleted.bodyweight['2026-09-13']).toBeLessThan(0)
    expect(mergeStates(local, server).bodyweight.map(b => b.d)).toContain('2026-09-13')
    expect(mergeStates(server, local).bodyweight.map(b => b.d)).toContain('2026-09-13')
  })

  it('does not overwrite a weigh-in logged for that day since', () => {
    bwSheet()
    const log = mountTopSheet()
    act(() => { log.querySelector('button[aria-label="Delete weigh-in"]').click() })
    const run = useUI.getState().toastAction.run
    useStore.getState().update(s => { s.bodyweight.push({ d: '2026-09-13', w: 78.4, t: Date.now() }) })
    act(() => { run() })
    expect(useStore.getState().S.bodyweight.filter(b => b.d === '2026-09-13').map(b => b.w)).toEqual([78.4])
  })
})
