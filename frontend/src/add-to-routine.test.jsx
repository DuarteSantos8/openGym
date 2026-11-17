// @vitest-environment happy-dom
// Add to my plan with several exercises picked in Library: the routine is chosen once, then each
// exercise gets its own sets, reps and weight in turn (sheets.jsx AddToRoutine).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { addToRoutineSheet } from './sheets.jsx'
import { EXDB } from './lib/exercises.js'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useLocation: () => ({ pathname: '/library', state: null }), useSearchParams: () => [new URLSearchParams()] }))

const mounted = []
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const tap = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const saveTop = () => {
  const host = renderTop()
  const btn = [...host.querySelectorAll('button.btn.primary')].at(-1)
  tap(btn)
}
const ex = id => EXDB.find(e => e.id === id)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: { ...structuredClone(DEF), routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [] }] }, user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }); vi.useRealTimers() })

describe('adding several exercises to a routine', () => {
  it('picks the routine once, then asks for each exercise in turn and adds them in order', () => {
    addToRoutineSheet([ex('0025'), ex('0047')])
    let host = renderTop()
    expect(host.querySelector('h3').textContent).toMatch(/,/)
    tap([...host.querySelectorAll('.item')].find(i => i.textContent.includes('Push')))
    saveTop()
    act(() => { vi.runOnlyPendingTimers() })   // the next exercise's sheet opens after this one closes
    saveTop()
    expect(useStore.getState().S.routines[0].ex.map(e => e.id)).toEqual(['0025', '0047'])
    expect(useUI.getState().toastMsg).toMatch(/added to Push/)
  })

  it('a single exercise still works as before', () => {
    addToRoutineSheet(ex('0025'))
    const host = renderTop()
    tap([...host.querySelectorAll('.item')].find(i => i.textContent.includes('Push')))
    saveTop()
    expect(useStore.getState().S.routines[0].ex.map(e => e.id)).toEqual(['0025'])
  })
})
