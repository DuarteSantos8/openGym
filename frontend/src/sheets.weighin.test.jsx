// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { startFlow } from './sheets.jsx'
import { todayISO } from './lib/format.js'

// Start opens the quick weigh-in unless Settings → During a workout → "Weigh in before
// workouts" is off (issue #137) — then the session begins at once, with no body weight on it.

describe('the weigh-in before a workout is a setting', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, active: null, routines: [], workouts: [], bodyweight: [], weighIn: true } }))
  })

  it('on (the default): Start opens the weigh-in and the session waits for it', () => {
    act(() => startFlow([]))
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().sheets[0].locked).toBe(true)   // the required weigh-in, not a plain sheet
    expect(useStore.getState().S.active).toBeNull()
  })

  it('a profile written before the setting existed still asks', () => {
    useStore.setState(s => { const S = { ...s.S }; delete S.weighIn; return { S } })
    act(() => startFlow([]))
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().sheets[0].locked).toBe(true)
    expect(useStore.getState().S.active).toBeNull()
  })

  it('already weighed in today: Start skips the sheet and carries that weight', () => {
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [{ d: todayISO(), w: 81.4, t: 1 }] } }))
    act(() => startFlow([]))
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useStore.getState().S.active.bw).toBe(81.4)
  })

  it('weighed in only on an earlier day: Start still asks', () => {
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [{ d: '2020-01-01', w: 80, t: 1 }] } }))
    act(() => startFlow([]))
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useStore.getState().S.active).toBeNull()
  })

  it('off: Start begins the session at once, with no sheet and no body weight', () => {
    useStore.setState(s => ({ S: { ...s.S, weighIn: false } }))
    act(() => startFlow([]))
    expect(useUI.getState().sheets).toHaveLength(0)
    const { active } = useStore.getState().S
    expect(active).not.toBeNull()
    expect(active.bw).toBeNull()
    expect(active.routineIds).toEqual([])
  })
})
