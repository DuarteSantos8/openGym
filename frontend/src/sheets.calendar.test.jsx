// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { todayISO } from './lib/format.js'
import { calendarSheet } from './sheets.jsx'

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

describe('Calendar canonical workout days', () => {
  let original

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    original = useStore.getState().S
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
    useStore.setState({ S: original })
  })

  it('keeps multiple legacy sessions on the heatmap fallback day clickable in Calendar', () => {
    const day = todayISO()
    const start = new Date(day + 'T09:00:00').getTime()
    useStore.setState({ S: {
      ...original,
      workouts: [
        { id: 'legacy-a', d: '', start, end: start + 15 * 60000, name: 'Legacy A', vol: 100, entries: [] },
        { id: 'legacy-b', d: 'not-a-day', start: start + 30 * 60000, end: start + 45 * 60000, name: 'Legacy B', vol: 200, entries: [] },
      ],
    } })

    calendarSheet(day)
    const host = renderTop()
    expect(host.textContent).toContain('2 workouts')
    const trainedDay = host.querySelector('button.cal-d.has')
    expect(trainedDay).toBeTruthy()

    act(() => trainedDay.click())
    const sessions = renderTop()
    expect(sessions.textContent).toContain('Legacy A')
    expect(sessions.textContent).toContain('Legacy B')
  })
})
