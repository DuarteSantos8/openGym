// @vitest-environment happy-dom
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkout, logPastWorkoutSheet } from './sheets.jsx'
import { buildSessionExposures } from './lib/session-start.js'
import { entriesForExposures } from './lib/session-ui-adapter.js'
import { ruleOccurrence } from './lib/test-fixtures.js'
import { todayISO } from './lib/format.js'

const mounted = []
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const cssSource = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

describe('log a past workout', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, routines: [], workouts: [{ id: 'old', d: todayISO(), start: 1, end: 2, name: 'Old', entries: [], prs: [] }] }, A: null }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('refuses while a workout is running', () => {
    const toast = vi.fn()
    useUI.setState({ toast })
    useStore.setState({ A: { id: 'a', entries: [] } })
    logPastWorkoutSheet()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(toast).toHaveBeenCalledWith('Finish the current workout first.')
  })

  it('asks what to do when the day already has a workout', () => {
    logPastWorkoutSheet()
    const host = mountTopSheet()
    expect(host.querySelector('h3').textContent).toBe('Log a past workout')
    act(() => { type(host.querySelector('input[type=date]'), todayISO()) })
    act(() => { button(host, 'Continue').click() })
    const prompt = mountTopSheet()
    expect(prompt.textContent).toContain('There is already a workout on that day.')
    expect(['Replace', 'Add as second workout', 'Cancel'].map(t => !!button(prompt, t))).toEqual([true, true, true])
    expect(useStore.getState().A).toBeNull()
  })

  // The Date and Start-time rows are the only .lrow rows in the app that pair a title with a
  // fixed-width field and nothing that can give way. A pixel floor under the title column therefore
  // comes straight out of the field: 104px pushed the date input 23px off a 320px screen, calendar
  // picker and all, so there was no way to open the picker on a small phone. The floor has to be the
  // row's own longest word (min-width:auto), which these short titles barely ask for.
  it('gives the date and time fields a title column that can shrink', () => {
    logPastWorkoutSheet()
    const host = mountTopSheet()
    const fields = [...host.querySelectorAll('.lrow input.timef')]
    expect(fields.map(i => i.type)).toEqual(['date', 'time'])
    for (const field of fields) expect(field.closest('.lrow').querySelectorAll('.lrow-v')).toHaveLength(0)
    const rule = cssSource.match(/^\.lrow-m\{([^}]*)\}/m)
    expect(rule?.[1]).toContain('min-width:auto')
    expect(rule[1]).not.toMatch(/min-width:\s*[\d.]/)
    // and where even the longest word leaves no room for the field (Polish "Godzina rozpoczęcia"
    // at 320px), the field drops onto its own line rather than over the edge of the card.
    expect(cssSource).toContain('.lrow:has(.timef){flex-wrap:wrap}')
    expect(cssSource).toContain('.lrow>.timef{margin-left:auto}')
  })

  it('starts a backfilled session straight away on a free day', () => {
    logPastWorkoutSheet()
    const host = mountTopSheet()
    act(() => { type(host.querySelector('input[type=date]'), '2020-01-02') })
    act(() => { button(host, 'Continue').click() })
    const A = useStore.getState().A
    expect(A.d).toBe('2020-01-02')
    expect(new Date(A.start).getHours()).toBe(18)
    expect(A.backfill).toEqual({ durationMin: 60, replaceId: null })
  })
})

// A backfilled session is older than the live track state: finishing it may add the workout and
// a 1RM estimate, but it must not rewind the progression a newer session already advanced.
describe('finishing a session and progression', () => {
  const later = { trackId: 'occ-0025', status: 'active', readyToIncrement: false, planRuleRevision: 1, position: 0, lastPrescriptionId: 'newer' }
  const start = backfill => {
    const S = { ...useStore.getState().S, unit: 'kg', workouts: [], prescriptions: {}, oneRepMaxes: {}, progression: { 'occ-0025': later } }
    const routine = { id: 'r1', name: 'Push', ex: [ruleOccurrence('0025')] }
    S.routines = [routine]
    const exposures = buildSessionExposures(S, routine, { now: Date.UTC(2026, 8, 20), newId: seed => seed, unit: 'kg' })
    const entries = entriesForExposures(exposures, S.prescriptions)
    entries[0].sets.forEach(row => { row.done = true })
    useStore.setState({ S, A: { id: 'past', d: '2026-09-20', start: Date.UTC(2026, 8, 20, 18), routineIds: ['r1'], name: 'Push', exposures, entries, ...(backfill ? { backfill: { durationMin: 60 } } : {}) } })
  }

  beforeEach(() => { useUI.setState({ sheets: [] }) })

  it('leaves the live progression state untouched on a backfill', () => {
    start(true)
    act(() => finishWorkout())
    const S = useStore.getState().S
    expect(S.workouts.map(w => w.id)).toEqual(['past'])
    expect(S.progression).toEqual({ 'occ-0025': later })
  })

  it('advances it on a live finish', () => {
    start(false)
    act(() => finishWorkout())
    expect(useStore.getState().S.progression['occ-0025']).toMatchObject({ readyToIncrement: true, lastPrescriptionId: expect.stringContaining('prescription:r1:occ-0025') })
  })
})
