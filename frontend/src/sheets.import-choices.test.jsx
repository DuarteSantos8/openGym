// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { importFromApp } from './sheets.jsx'
import { matchExercise } from './lib/import-csv.js'

// The summary's "Check and choose" (#931, #849): untick an exercise, keep a name as your own, and
// Import writes only that, remembering the pick.
const HEAD = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Seconds,Notes,Workout Notes,RPE'
const CSV = [HEAD,
  '2026-01-02 10:00:00,Push,Bench Press (Barbell),1,60,5,0,,good day,8',
  '2026-01-02 10:00:00,Push,Grip Crusher Thing,1,20,10,0,,good day,',
  '2026-01-09 10:00:00,Legs,Squat (Barbell),1,100,5,0,,,',
].join('\n')
let root, host

async function open(text) {
  importFromApp(new File([text], 'export.csv', { type: 'text/csv' }))
  for (let i = 0; i < 50 && !useUI.getState().sheets.length; i++) await new Promise(r => setTimeout(r, 5))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  render()
}
// Re-render the top sheet (a menu or picker opened over the summary is rendered on its own).
const render = () => act(() => root.render(useUI.getState().sheets[0].render(() => useUI.getState().closeSheet(useUI.getState().sheets[0].id))))
const btn = (label, scope = host) => [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const tile = label => [...host.querySelectorAll('.tile')].find(x => x.querySelector('.l').textContent === label)?.querySelector('.v').textContent

describe('the import summary’s choices', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], bodyweight: [], customEx: [], exAliases: {} } }))
  })
  afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = '' })

  it('lists the names when opened and leaves an unticked one out', async () => {
    await open(CSV)
    expect(tile('Sets')).toBe('3')
    act(() => host.querySelector('.imp-choices-h').click())
    expect(host.querySelectorAll('.imp-name')).toHaveLength(3)
    act(() => btn('Import Grip Crusher Thing').click())
    expect(tile('Sets')).toBe('2')
    expect(tile('Added as your own')).toBe('0')
    act(() => btn('Import').click())
    const S = useStore.getState().S
    expect(S.customEx).toEqual([])
    expect(S.workouts.flatMap(w => w.entries.map(e => e.id))).toEqual([matchExercise('Bench Press (Barbell)'), matchExercise('Squat (Barbell)')])
  })

  it('keeps a matched name as your own, from the menu', async () => {
    await open(CSV)
    act(() => host.querySelector('.imp-choices-h').click())
    act(() => btn('Squat (Barbell): change what it becomes').click())
    const menu = useUI.getState().sheets.at(-1)
    const mh = document.createElement('div'); document.body.appendChild(mh)
    const mr = createRoot(mh)
    act(() => mr.render(menu.render(() => useUI.getState().closeSheet(menu.id))))
    const own = [...mh.querySelectorAll('.menu-item')].find(x => x.textContent.includes('Keep it as your own exercise'))
    act(() => own.click())
    act(() => mr.unmount())
    render()
    expect(tile('Added as your own')).toBe('2')
    expect(host.querySelector('.imp-pick')).toBeTruthy()
  })

  it('hides the notes and effort switches when the file has neither', async () => {
    await open(['Date,Exercise,Weight,Reps', '2026-01-02,Bench Press,60,5'].join('\n'))
    act(() => host.querySelector('.imp-choices-h').click())
    expect(host.textContent).not.toContain('Bring the notes')
    expect(host.textContent).not.toContain('Bring the RPE and RIR ratings')
  })
})
