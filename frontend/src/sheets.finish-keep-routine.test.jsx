// @vitest-environment happy-dom
// #592: an exercise added during a routine's session is offered to that routine on the finish
// summary. One tap adds it; closing the summary without the tap leaves the routine as it was.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkoutNow } from './sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []
let host

function renderTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}
// The photo section asks the media store whether it can keep files; let that answer land.
const settle = () => act(async () => {})
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

function install(entries) {
  const st = clone(DEF)
  st.routines = [{ id: 'r1', name: 'Push A', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60 }] }]
  st.active = {
    id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineIds: ['r1'], routineId: 'r1', name: 'Push A', bw: null, cur: 0,
    entries,
  }
  useStore.setState({ S: st, user: null })
}
const bench = { id: '0025', rid: 'r1', target: { sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }
const raise = { id: '0334', rid: 'r1', addedInSession: true, target: { sets: 2, reps: 12, weight: 8 }, sets: [{ w: 8, r: 12, done: true }, { w: 8, r: 12, done: true }] }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
})

describe('finish summary: keep an added exercise in the routine', () => {
  it('offers it, and one tap adds it with the setup of the session', async () => {
    install([clone(bench), clone(raise)])
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    expect(host.querySelector('[data-keep-in-routine]')).toBeTruthy()
    // Nothing changed yet: the offer is only an offer.
    expect(S().routines[0].ex.map(x => x.id)).toEqual(['0025'])
    act(() => button('Add it to “Push A”').click())
    expect(S().routines[0].ex.map(x => x.id)).toEqual(['0025', '0334'])
    expect(S().routines[0].ex[1]).toMatchObject({ sets: 2, reps: 12, weight: 8 })
    expect(host.textContent).toContain('Added to “Push A”')
    // The saved workout carries no trace of the marker.
    expect(JSON.stringify(S().workouts.at(-1))).not.toContain('addedInSession')
  })

  it('says nothing when the session added nothing', async () => {
    install([clone(bench)])
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    expect(host.querySelector('[data-keep-in-routine]')).toBeNull()
  })
})
