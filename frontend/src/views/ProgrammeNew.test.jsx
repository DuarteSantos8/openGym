// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import ProgrammeNew, { applyProgrammeRoutineReturn, programmeRoutineReturnToken, readProgrammeDraft } from './ProgrammeNew.jsx'
import { createProgrammeDefinition, startProgrammeCycleInState } from '../lib/programmes.js'
import { todayISO } from '../lib/format.js'
import { DEF, useStore } from '../store/useStore.js'
import { _setLangState } from '../lib/i18n-core.js'
import de from '../locales/de.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const roots = []
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  document.body.innerHTML = ''
  sessionStorage.clear()
  _setLangState('en', null, null, null)
})

function HomeDestination(){const location=useLocation();return <div data-testid="home" data-search={location.search}>Home</div>}
function mount(state = {}, entry = '/programme/new') {
  useStore.setState({ S: { ...structuredClone(DEF), programmeMode: true, ...state } })
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  act(() => root.render(<MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/programme/new" element={<ProgrammeNew />} />
    <Route path="/home" element={<HomeDestination />} />
    <Route path="/plan" element={<div data-testid="plan">Plan fallback</div>} />
  </Routes></MemoryRouter>))
  return host
}

const change = (element, value) => act(() => {
  Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
})
const click = element => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const keydown = (element, key) => act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
const button = (host, text) => [...host.querySelectorAll('button')].find(item => item.textContent.trim() === text)

describe('Programme editor', () => {
  it('guards the route while mode is off', () => {
    const host = mount({ programmeMode: false })
    expect(host.querySelector('[data-testid="plan"]')).not.toBeNull()
  })

  it('starts with eight current-week templates, profile weekday order, palette, and all source choices', () => {
    const host = mount({ weekStart: 0, routines: [{ id: 'push', name: 'Push', ex: [] }], week: { 1: 'push' },
      programmes: { version: 1, definitions: [{ id: 'old', name: 'Old programme', progression: 'linear', weeks: [{ weekIndex: 1, days: [] }] }], cycles: [] } })
    expect([...host.querySelectorAll('[data-programme-weekday]')].map(item => Number(item.dataset.programmeWeekday))).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(host.querySelector('input.num').value).toBe('8')
    expect([...host.querySelector('#programme-source').options].map(option => option.value)).toEqual(['current', 'blank', 'programme:old'])
    expect(host.querySelectorAll('[data-testid^="programme-colour-"]')).toHaveLength(8)
    expect(button(host, 'Save programme').disabled).toBe(true)
  })

  it('exposes localized colour toggle names, current state, and keyboard selection including no colour', () => {
    _setLangState('de', de, null, null)
    const host = mount()
    const group = host.querySelector('[role="group"][aria-label="Programmfarbe"]')
    const expectedNames = ['Keine Farbe', 'Programmfarbe: Limettengrün', 'Programmfarbe: Himmelblau', 'Programmfarbe: Orange',
      'Programmfarbe: Gold', 'Programmfarbe: Violett', 'Programmfarbe: Pink', 'Programmfarbe: Türkis']
    expect([...group.querySelectorAll('button')].map(item => item.getAttribute('aria-label'))).toEqual(expectedNames)
    const none = host.querySelector('[data-testid="programme-colour-none"]')
    const sky = host.querySelector('[data-testid="programme-colour-sky"]')
    expect(none.getAttribute('aria-pressed')).toBe('true')
    expect(sky.getAttribute('aria-pressed')).toBe('false')

    keydown(sky, 'Enter')
    expect(sky.getAttribute('aria-pressed')).toBe('true')
    expect(none.getAttribute('aria-pressed')).toBe('false')
    keydown(none, ' ')
    expect(none.getAttribute('aria-pressed')).toBe('true')
    expect(sky.getAttribute('aria-pressed')).toBe('false')
  })

  it('folds week copying without changing the draft or losing selected destinations', () => {
    const host = mount({ weekStart: 1, routines: [{ id: 'push', name: 'Push', ex: [] }, { id: 'pull', name: 'Pull', ex: [] }], week: { 1: 'push' } })
    const disclosure = host.querySelector('.programme-copy')
    const summary = disclosure.querySelector('summary')
    const before = structuredClone(useStore.getState().S.programmes)
    expect(summary.textContent).toBe('Copy this week')
    expect(disclosure.open).toBe(false)
    expect(host.querySelector('[data-testid="programme-count"]').textContent).toBe('8 weeks · 8 sessions')
    change(host.querySelector('select[aria-label="Add session"]'), 'pull')
    expect(host.querySelector('[data-testid="programme-count"]').textContent).toBe('8 weeks · 9 sessions')
    click(summary)
    expect(disclosure.open).toBe(true)
    expect(button(disclosure, 'Copy').disabled).toBe(true)
    click(button(disclosure, 'Week 2'))
    click(summary)
    click(summary)
    expect(button(disclosure, 'Week 2').getAttribute('aria-pressed')).toBe('true')
    expect(useStore.getState().S.programmes).toEqual(before)
    expect(button(host, 'Save programme').disabled).toBe(true)
    click(button(disclosure, 'Copy'))
    expect(host.querySelector('[data-testid="programme-count"]').textContent).toBe('8 weeks · 10 sessions')
    expect(button(disclosure, 'Copy').disabled).toBe(true)
    change(host.querySelector('#programme-name'), 'Copied block')
    click(button(host, 'Save programme'))
    const saved = useStore.getState().S.programmes.definitions[0]
    expect(saved.weeks[1].days.find(day => day.weekday === 1).sessions.map(session => session.routineId)).toEqual(['push', 'pull'])
  })

  it('excludes unscheduled rest-week templates from the programme session count', () => {
    const host = mount({ weekStart: 1, routines: [{ id: 'push', name: 'Push', ex: [] }], week: { 1: 'push' } })
    click([...host.querySelectorAll('.seg button')].find(item => item.textContent === 'Rest'))
    expect(host.querySelector('[data-testid="programme-count"]').textContent).toBe('8 weeks · 7 sessions')
    expect(host.querySelector('select[aria-label="Select routine"]').value).toBe('push')
  })

  it('deep-clones an existing programme including name, colour, progression, and modes', () => {
    const source = { id: 'old', name: 'Old programme', colour: 'violet', progression: 'linear', weeks: [{
      weekIndex: 1, mode: 'rest', days: [{ weekday: 1, sessions: [{ id: 'occ', sessionTemplateId: 'tpl', routineId: 'push', routineSnapshot: { id: 'push', name: 'Push', ex: [] } }] }],
    }] }
    const host = mount({ routines: [{ id: 'push', name: 'Push', ex: [] }], programmes: { version: 1, definitions: [source], cycles: [] } })
    change(host.querySelector('#programme-source'), 'programme:old')
    expect(host.querySelector('#programme-name').value).toBe('Old programme')
    expect(host.querySelector('[data-testid="programme-colour-violet"]').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[role="tab"]').textContent).toContain('Rest')
    expect(source.weeks[0].days[0].sessions[0].routineSnapshot.name).toBe('Push')
  })

  it('edits multiple ordered sessions, week mode, colour, and saves current snapshots', () => {
    const routines = [{ id: 'push', name: 'Push', ex: [] }, { id: 'pull', name: 'Pull', ex: [] }]
    const host = mount({ weekStart: 0, routines, week: { 1: 'push' } })
    change(host.querySelector('#programme-name'), 'Strength block')
    click(host.querySelector('[data-programme-weekday="1"]'))
    const add = [...host.querySelectorAll('select')].find(select => select.getAttribute('aria-label') === 'Add session')
    change(add, 'pull')
    const sessionRows = [...host.querySelectorAll('select[aria-label="Select routine"]')]
    expect(sessionRows.map(select => select.value)).toEqual(['push', 'pull'])
    const secondRow = sessionRows[1].closest('.programme-session-editor')
    click(secondRow.querySelector('button[aria-label="Move up"]'))
    click(host.querySelector('[data-testid="programme-colour-sky"]'))
    click([...host.querySelectorAll('.seg button')].find(item => item.textContent === 'Deload'))
    expect(button(host, 'Save programme').disabled).toBe(false)
    click(button(host, 'Save programme'))

    const saved = useStore.getState().S.programmes.definitions[0]
    const monday = saved.weeks[0].days.find(day => day.weekday === 1)
    expect(saved).toMatchObject({ name: 'Strength block', colour: 'sky' })
    expect(saved.weeks[0].mode).toBe('deload')
    expect(monday.sessions.map(session => session.routineId)).toEqual(['pull', 'push'])
    expect(monday.sessions.every(session => session.routineSnapshot.excludeFromProgression === true)).toBe(true)
  })

  it('validates route tokens and refreshes only exact routine snapshots while orphan returns fail closed', () => {
    const token = 'programme:test-token'
    const payload = { version: 1, returnPath: '/programme/new', draft: { weeks: [{ days: [{ weekday: 1, sessions: [
      { id: 'a', routineId: 'push', routineSnapshot: { id: 'push', name: 'Old push' } },
      { id: 'b', routineId: 'pull', routineSnapshot: { id: 'pull', name: 'Old pull' } },
    ] }] }] }, action: { kind: 'edit', routineId: 'push' } }
    sessionStorage.setItem('opengym:programme-draft:' + token, JSON.stringify(payload))
    expect(readProgrammeDraft(token)).toEqual(payload)
    expect(programmeRoutineReturnToken({ programmeReturn: true, programmeDraftToken: token })).toBe(token)
    expect(programmeRoutineReturnToken({ programmeReturn: false, programmeDraftToken: token })).toBeNull()
    const refreshed = applyProgrammeRoutineReturn(payload, { routines: [{ id: 'push', name: 'New push', ex: [] }] })
    expect(refreshed.weeks[0].days[0].sessions.map(session => session.routineSnapshot.name)).toEqual(['New push', 'Old pull'])
    const orphan = applyProgrammeRoutineReturn(payload, { routines: [] })
    expect(orphan.weeks[0].days[0].sessions[0].routineSnapshot.name).toBe('Old push')
  })
})

it('duplicates a Programme into an editable copy with fresh session identities', () => {
 const original={id:'original',name:'Strength',progression:'linear',weeks:[{weekIndex:1,days:[{weekday:1,sessions:[{id:'old-session',sessionTemplateId:'old-template',routineId:'push',routineSnapshot:{id:'push',name:'Push',ex:[]}}]}]}]}
 const host=mount({routines:[{id:'push',name:'Push',ex:[]}],programmes:{version:1,definitions:[original],cycles:[]}}, {pathname:'/programme/new',state:{mode:'duplicate',programmeId:'original'}})
 expect(host.querySelector('#programme-name').value).toBe('Strength copy')
 click(button(host,'Save programme'))
 const definitions=useStore.getState().S.programmes.definitions
 expect(definitions).toHaveLength(2)
 expect(definitions[0]).toEqual(original)
 expect(definitions[1].id).not.toBe(original.id)
 expect(definitions[1].weeks[0].days[0].sessions[0].id).not.toBe('old-session')
})

it.each(['Close','Save programme'])('returns to the active cycle on Home after %s', action => {
 const state={...structuredClone(DEF),programmeMode:true,routines:[{id:'push',name:'Push',ex:[{id:'0009',mode:'reps',sets:1,reps:5,weight:20}]}]};
 const definition=createProgrammeDefinition({name:'Active block',weeks:[{days:[{weekday:new Date().getDay(),sessions:[{routineId:'push'}]}]},{mode:'rest',days:[]}]},state,{id:'p'});
 startProgrammeCycleInState(state,definition,{id:'cycle',week1StartDate:todayISO()});
 const before=structuredClone(state.workouts);const host=mount(state,{pathname:'/programme/new',state:{mode:'edit-cycle',cycleId:'cycle',programmeWeek:2}});
 change(host.querySelector('#programme-name'),'Edited block');
 click(action==='Close'?host.querySelector('[aria-label="Close"]'):button(host,'Save programme'));
 expect(host.querySelector('[data-testid="home"]').dataset.search).toBe('?cycle=cycle&week=2');
 expect(useStore.getState().S.programmes.cycles[0].name).toBe(action==='Close'?'Active block':'Edited block');
 expect(useStore.getState().S.workouts).toEqual(before);
});
