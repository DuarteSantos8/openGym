// @vitest-environment happy-dom
// #592: an exercise added during a routine's session is offered to that routine on the finish
// summary. One tap adds it; closing the summary without the tap leaves the routine as it was.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkoutNow } from './sheets.jsx'
import { buildSessionExposures } from './lib/session-start.js'
import { entriesForExposures } from './lib/session-ui-adapter.js'
import { ruleOccurrence } from './lib/test-fixtures.js'

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

// The planned bench, and optionally an exercise added during the session (stamped as the workout screen does).
function install(extra) {
  const st = clone(DEF)
  st.engineSchemaVersion = 2
  st.routines = [{ id: 'r1', name: 'Push A', ex: [ruleOccurrence('0025', { routineId: 'r1' })] }]
  const now = Date.parse('2026-09-28T12:00:00Z')
  const exposures = buildSessionExposures(st, st.routines[0], { now, newId: s => s })
  if (extra) {
    const [x] = buildSessionExposures(st, { id: 'r1', ex: [ruleOccurrence(extra, { occurrenceId: 'occ-extra', routineId: 'r1' })] }, { now, newId: s => s + ':extra' })
    exposures.push({ ...x, addedInSession: true })
  }
  const entries = entriesForExposures(exposures, st.prescriptions)
  entries.forEach(e => e.sets.forEach(row => { row.done = true }))
  const A = { id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineIds: ['r1'], name: 'Push A', bw: null, cur: 0, exposures, entries }
  useStore.setState({ S: st, A, user: null })
}

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
    install('0334')
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    expect(host.querySelector('[data-keep-in-routine]')).toBeTruthy()
    // Nothing changed yet: the offer is only an offer.
    expect(S().routines[0].ex.map(x => x.exerciseId)).toEqual(['0025'])
    act(() => button('Add it to “Push A”').click())
    expect(S().routines[0].ex.map(x => x.exerciseId)).toEqual(['0025', '0334'])
    expect(host.textContent).toContain('Added to “Push A”')
    // The saved workout carries no trace of the marker.
    expect(JSON.stringify(S().workouts.at(-1))).not.toContain('addedInSession')
  })

  it('says nothing when the session added nothing', async () => {
    install()
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    expect(host.querySelector('[data-keep-in-routine]')).toBeNull()
  })
})
