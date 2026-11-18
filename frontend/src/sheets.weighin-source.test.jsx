// @vitest-environment happy-dom
// #1088: bwSheet asks lib/weigh-in-source.js first (its own test covers the rule).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bwSheet } from './sheets.jsx'
import { initWeighInSource } from './lib/weigh-in-source.js'

const clone = v => JSON.parse(JSON.stringify(v))
let tell
const reading = on => tell({ readWeight: on })
const sheets = () => useUI.getState().sheets.length

beforeEach(async () => {
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  const st = clone(DEF)
  Object.assign(st, { unit: 'kg', bodyweight: [{ d: '2026-09-07', w: 80.5, t: 3 }] })
  useStore.setState({ S: st, user: null })
  await initWeighInSource(async () => ({ readWeight: false }), cb => { tell = cb })
})
afterEach(() => reading(false))

describe('bwSheet and the read of weigh-ins', () => {
  it('opens as before while the read is off', () => {
    bwSheet()
    expect(sheets()).toBe(1)
  })

  it('opens nothing while it is on: Log says why, the check-in goes on without a weight', () => {
    reading(true)
    expect(bwSheet()).toBe(null)
    expect(useUI.getState().toastMsg).toBe('Weigh-ins come from Health Connect only.')
    const onDone = vi.fn()
    bwSheet({ required: true, onDone })
    expect(onDone).toHaveBeenCalledWith(null)
    expect(sheets()).toBe(0)
  })
})
