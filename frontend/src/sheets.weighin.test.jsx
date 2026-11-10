// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { startFlow } from './sheets.jsx'

// Start opens "Choose your session": today's session on top, every routine of the plan, then
// Freestyle. A tap on one starts it, through the quick weigh-in unless Settings → During a workout
// → "Weigh in before workouts" is off (issue #137), in which case the session begins at once with
// no body weight on it.

// Renders the sheet on top of the stack the way the app shell does, and taps one of its rows.
function tap(which) {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const title = host.querySelector('h3')?.textContent
  const sections = [...host.querySelectorAll('.menu-sec')].map(n => n.textContent)
  const rows = [...host.querySelectorAll('.sesspick-item')].map(n => ({ key: n.dataset.key, label: n.querySelector('.tt').textContent, sub: n.querySelector('.ss')?.textContent }))
  if (which) act(() => host.querySelector(`.sesspick-item[data-key="${which}"]`).click())
  act(() => root.unmount()); host.remove()
  return { title, sections, rows, kind: sheet.kind }
}

describe('starting a workout: choose the session, then weigh in', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({
      S: {
        ...s.S, active: null, bodyweight: [], weighIn: true,
        workouts: [{ d: '2026-11-03', routineIds: ['core'] }],
        routines: [
          { id: 'push', name: 'Push', ex: [{ id: '0025' }, { id: '1457' }] },
          { id: 'core', name: 'Core', ex: [{ id: '0001' }] },
        ],
      },
    }))
  })

  it('lists today first, then the other sessions, then Freestyle, and nothing starts yet', () => {
    act(() => startFlow(['push']))
    expect(useUI.getState().sheets).toHaveLength(1)
    const { title, sections, rows, kind } = tap(null)
    expect(kind).toBe('sheet')   // a sheet from the bottom, not a dialog
    expect(title).toBe('Choose your session')
    expect(sections).toEqual(["Today's plan", 'My sessions'])
    expect(rows.map(r => r.key)).toEqual(['today', 'core', 'free'])
    expect(rows[0]).toMatchObject({ label: 'Push' })
    expect(rows[0].sub).toMatch(/2/)   // how many exercises it holds
    expect(rows[1].sub).toMatch(/1 exercise/)
    expect(useStore.getState().S.active).toBeNull()
  })

  it('names a combined day the way the session will be named, each routine still listed', () => {
    act(() => startFlow(['push', 'core']))
    const { rows } = tap(null)
    expect(rows[0].label).toMatch(/Push.*Core/)
    expect(rows.map(r => r.key)).toEqual(['today', 'push', 'core', 'free'])
  })

  it('with nothing planned today, every session and Freestyle', () => {
    act(() => startFlow([]))
    const { sections, rows } = tap(null)
    expect(sections).toEqual(['My sessions'])
    expect(rows.map(r => r.key)).toEqual(['push', 'core', 'free'])
    act(() => startFlow(null))
    expect(useUI.getState().sheets).toHaveLength(2)
  })

  it('on (the default): a session picked opens the weigh-in and the session waits for it', () => {
    act(() => startFlow(['push']))
    tap('core')
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().sheets[0].locked).toBe(true)   // the required weigh-in, not a plain sheet
    expect(useStore.getState().S.active).toBeNull()
  })

  it('a profile written before the setting existed still asks', () => {
    useStore.setState(s => { const S = { ...s.S }; delete S.weighIn; return { S } })
    act(() => startFlow(['push']))
    tap('today')
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().sheets[0].locked).toBe(true)
    expect(useStore.getState().S.active).toBeNull()
  })

  it('off: picking begins the session at once, with no sheet and no body weight', () => {
    useStore.setState(s => ({ S: { ...s.S, weighIn: false } }))
    act(() => startFlow(['push']))
    tap('core')
    expect(useUI.getState().sheets).toHaveLength(0)
    const { active } = useStore.getState().S
    expect(active).not.toBeNull()
    expect(active.bw).toBeNull()
    expect(active.routineIds).toEqual(['core'])
    expect(active.name).toBe('Core')
  })

  it('Freestyle starts an empty session', () => {
    useStore.setState(s => ({ S: { ...s.S, weighIn: false } }))
    act(() => startFlow(['push']))
    tap('free')
    const { active } = useStore.getState().S
    expect(active.routineIds).toEqual([])
    expect(active.entries).toEqual([])
  })
})
