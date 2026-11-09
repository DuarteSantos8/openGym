// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { startFlow } from './sheets.jsx'

// Start first asks "Start “Push”?" with the name of the session, then (unless Settings → During a
// workout → "Weigh in before workouts" is off, issue #137) opens the quick weigh-in. With the
// weigh-in off, the session begins as soon as the start is confirmed, with no body weight on it.

// Renders the sheet on top of the stack the way the app shell does, and taps one of its buttons.
function tap(which) {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const title = host.querySelector('h3')?.textContent
  const message = host.querySelector('.muted')?.textContent
  if (which) act(() => host.querySelector(which).click())
  act(() => root.unmount()); host.remove()
  return { title, message, kind: sheet.kind }
}
const confirmStart = () => tap('.btn.primary')

describe('starting a workout asks first, then weighs in', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({
      S: {
        ...s.S, active: null, workouts: [], bodyweight: [], weighIn: true,
        routines: [
          { id: 'push', name: 'Push', ex: [{ id: '0025' }, { id: '1457' }] },
          { id: 'core', name: 'Core', ex: [{ id: '0001' }] },
        ],
      },
    }))
  })

  it('names the session in the question, and nothing starts until it is answered', () => {
    act(() => startFlow(['push']))
    expect(useUI.getState().sheets).toHaveLength(1)
    const { title, message, kind } = tap(null)
    expect(kind).toBe('center')
    expect(title).toBe('Start “Push”?')
    expect(message).toMatch(/2/)   // how many exercises it holds
    expect(useStore.getState().S.active).toBeNull()
  })

  it('names a combined day the way the session will be named', () => {
    act(() => startFlow(['push', 'core']))
    expect(tap(null).title).toMatch(/^Start “.*Push.*Core.*”\?$/)
  })

  it('a freestyle session says so', () => {
    act(() => startFlow([]))
    expect(tap(null).title).toBe('Start “Freestyle”?')
    act(() => startFlow(null))
    expect(useUI.getState().sheets).toHaveLength(2)
  })

  it('Cancel leaves everything as it was', () => {
    act(() => startFlow(['push']))
    tap('.btn.ghost')
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useStore.getState().S.active).toBeNull()
  })

  it('on (the default): confirming opens the weigh-in and the session waits for it', () => {
    act(() => startFlow(['push']))
    confirmStart()
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().sheets[0].locked).toBe(true)   // the required weigh-in, not a plain sheet
    expect(useStore.getState().S.active).toBeNull()
  })

  it('a profile written before the setting existed still asks', () => {
    useStore.setState(s => { const S = { ...s.S }; delete S.weighIn; return { S } })
    act(() => startFlow(['push']))
    confirmStart()
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().sheets[0].locked).toBe(true)
    expect(useStore.getState().S.active).toBeNull()
  })

  it('off: confirming begins the session at once, with no sheet and no body weight', () => {
    useStore.setState(s => ({ S: { ...s.S, weighIn: false } }))
    act(() => startFlow(['push']))
    confirmStart()
    expect(useUI.getState().sheets).toHaveLength(0)
    const { active } = useStore.getState().S
    expect(active).not.toBeNull()
    expect(active.bw).toBeNull()
    expect(active.routineIds).toEqual(['push'])
    expect(active.name).toBe('Push')
  })
})
