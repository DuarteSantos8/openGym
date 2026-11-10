// @vitest-environment happy-dom
// The recovery card on Home: shown when it helps, put away for the day with the ×.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import RecoveryHint from './RecoveryHint.jsx'
import { todayISO, isoOf } from '../lib/format.js'

const clone = v => JSON.parse(JSON.stringify(v))
let root, host
const ago = n => { const x = new Date(); x.setDate(x.getDate() - n); x.setHours(18, 0, 0, 0); return { d: isoOf(x), start: x.getTime(), end: x.getTime() + 3600e3 } }
const sets = () => Array.from({ length: 5 }, () => ({ w: 60, r: 8, done: true }))
const legs = n => ({ id: 'l' + n, ...ago(n), entries: [{ id: '0043', sets: sets() }, { id: '0085', sets: sets() }] })
const upper = n => ({ id: 'u' + n, ...ago(n), entries: [{ id: '0025', sets: sets() }, { id: '0027', sets: sets() }] })

function render() {
  act(() => root.render(<Card />))
  return host
}
function Card() { const S = useStore(s => s.S); return <RecoveryHint S={S} /> }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', workouts: [legs(12), upper(10), legs(6), upper(4), legs(1)], routines: [], week: {}, dayPlan: {} })
  useStore.setState({ S, user: null })
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('RecoveryHint', () => {
  it('shows one hint, and the × puts it away for today', () => {
    const el = render()
    expect(el.querySelector('.recovery-hint')).toBeTruthy()
    expect(el.textContent).toContain('Your legs are still recovering from yesterday.')
    act(() => { el.querySelector('button[aria-label="Hide for today"]').click() })
    expect(useStore.getState().S.recoveryHintDay).toBe(todayISO())
    expect(el.querySelector('.recovery-hint')).toBeNull()
  })

  it('is not there when switched off', () => {
    useStore.setState({ S: { ...useStore.getState().S, recoveryHint: false } })
    expect(render().querySelector('.recovery-hint')).toBeNull()
  })
})
