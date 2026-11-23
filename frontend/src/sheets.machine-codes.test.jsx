// @vitest-environment happy-dom
// Machine codes (docs/dev/MACHINE_CODES.md): the exercise details list the codes linked to the
// exercise, link a new one and drop one with its cross.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exerciseDetailSheet } from './sheets.jsx'
import { shownCode } from './lib/machine-codes.js'

const mounted = []
const ex = EXDB[0]

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const linkBtn = host => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Link a code on this machine'))
const rows = host => [...host.querySelectorAll('.machine-code-row')]

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('exercise details: linked machine codes', () => {
  it('shows the button with a count badge and a row per code', () => {
    useStore.setState(s => ({ S: { ...s.S, machineCodes: { [ex.id]: ['abc123', 'https://gym.example/m/7'] } } }))
    exerciseDetailSheet(ex)
    const host = renderTop()
    const btn = linkBtn(host)
    expect(btn).toBeTruthy()
    expect(btn.querySelector('.machine-code-count').textContent).toBe('2')
    expect(rows(host).map(r => r.querySelector('.machine-code-text').textContent))
      .toEqual([shownCode('abc123'), shownCode('https://gym.example/m/7')])
  })

  it('the cross unlinks that code and toasts', () => {
    useStore.setState(s => ({ S: { ...s.S, machineCodes: { [ex.id]: ['abc123', 'zzz'] } } }))
    exerciseDetailSheet(ex)
    const host = renderTop()
    const x = rows(host)[0].querySelector('button')
    expect(x.getAttribute('aria-label')).toBe('Remove')
    act(() => x.click())
    expect(useStore.getState().S.machineCodes[ex.id]).toEqual(['zzz'])
    expect(useUI.getState().toastMsg).toBe('Code removed')
    expect(rows(host)).toHaveLength(1)
  })

  it('without codes: the button, no badge, no rows', () => {
    exerciseDetailSheet(ex)
    const host = renderTop()
    expect(linkBtn(host)).toBeTruthy()
    expect(host.querySelector('.machine-code-count')).toBeNull()
    expect(rows(host)).toHaveLength(0)
  })
})
