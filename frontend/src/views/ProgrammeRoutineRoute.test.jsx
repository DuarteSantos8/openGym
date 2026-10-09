// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProgrammeNew, { readProgrammeDraft } from './ProgrammeNew.jsx'
import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { createProgrammeDefinition, startProgrammeCycleInState } from '../lib/programmes.js'
import { todayISO } from '../lib/format.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ glyphPicker: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root
let host

afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  root = null; host = null
  sessionStorage.clear(); localStorage.clear()
})

function HomeDestination(){const location=useLocation();return <div data-testid="home" data-search={location.search}>Home</div>}
function PlanDestination(){const location=useLocation();return <div data-testid="plan" data-search={location.search}>Plan</div>}

function mount(state, entry) {
  useStore.setState({ S: { ...structuredClone(DEF), programmeMode: true, ...state }, user: null })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/plan/r/:id" element={<RoutineEdit />} />
    <Route path="/programme/new" element={<ProgrammeNew />} />
    <Route path="/plan" element={<PlanDestination />} />
    <Route path="/home" element={<HomeDestination />} />
  </Routes></MemoryRouter>))
  return host
}

const click = element => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const type = (element, value) => act(() => {
  Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('Programme routine editor route return', () => {
  it('returns through a validated token and refreshes the exact routine snapshot before save', () => {
    const token = 'programme:route-token'
    const routine = { id: 'r1', name: 'Edited routine', emoji: 'dumbbell', ex: [] }
    const payload = {
      version: 1, returnPath: '/programme/new',
      draft: { name: 'Draft programme', progression: 'linear', colour: 'sky', sourceKey: 'current', selectedWeek: 0, selectedDay: 1,
        weeks: [{ weekIndex: 1, mode: 'normal', days: [{ weekday: 1, sessions: [{
          id: 'occ', sessionTemplateId: 'tpl', routineId: 'r1', routineSnapshot: { ...routine, name: 'Old snapshot' },
        }] }] }] },
      action: { kind: 'edit', routineId: 'r1' },
    }
    sessionStorage.setItem('opengym:programme-draft:' + token, JSON.stringify(payload))
    sessionStorage.setItem('opengym:programme-draft-active', token)
    const view = mount({ routines: [routine] }, { pathname: '/plan/r/r1', state: { programmeReturn: true, programmeDraftToken: token } })

    click(view.querySelector('button[aria-label="Back to programme"]'))
    expect(view.querySelector('#programme-name').value).toBe('Draft programme')
    expect(sessionStorage.getItem('opengym:programme-draft-active')).toBe(token)
    expect(readProgrammeDraft(token).action).toBeNull()
    click([...view.querySelectorAll('button')].find(button => button.textContent.trim() === 'Save programme'))

    const saved = useStore.getState().S.programmes.definitions[0]
    expect(saved.weeks[0].days[0].sessions[0].routineSnapshot.name).toBe('Edited routine')
    expect(sessionStorage.getItem('opengym:programme-draft-active')).toBeNull()
  })

  it('ignores malformed return context and keeps the classic Plan destination', () => {
    const view = mount({ routines: [{ id: 'r1', name: 'Routine', emoji: 'dumbbell', ex: [] }] },
      { pathname: '/plan/r/r1', state: { programmeReturn: true, programmeDraftToken: '../bad' } })
    expect(view.querySelector('button[aria-label="Plan"]')).not.toBeNull()
    click(view.querySelector('button[aria-label="Plan"]'))
    expect(view.querySelector('[data-testid="plan"]')).not.toBeNull()
  })

  it('creates a routine through RoutineEdit and returns it to the exact draft day once', () => {
    const view = mount({ routines: [], week: {} }, '/programme/new')
    type(view.querySelector('#programme-name'), 'New-routine programme')
    click([...view.querySelectorAll('button')].find(button => button.textContent.trim() === 'New routine'))
    expect(view.querySelector('button[aria-label="Back to programme"]')).not.toBeNull()
    type(view.querySelector('input.input'), 'Created in editor')
    click(view.querySelector('button[aria-label="Back to programme"]'))
    expect(view.querySelector('#programme-name').value).toBe('New-routine programme')
    const token = sessionStorage.getItem('opengym:programme-draft-active')
    const stored = readProgrammeDraft(token)
    expect(stored.action).toBeNull()
    expect(stored.draft.weeks.flatMap(week => week.days.flatMap(day => day.sessions))).toHaveLength(1)
    click([...view.querySelectorAll('button')].find(button => button.textContent.trim() === 'Save programme'))

    const definition = useStore.getState().S.programmes.definitions[0]
    const sessions = definition.weeks.flatMap(week => week.days.flatMap(day => day.sessions))
    expect(sessions).toHaveLength(1)
    expect(sessions[0].routineSnapshot.name).toBe('Created in editor')
    expect(sessions[0].id).not.toBe(sessions[0].sessionTemplateId)
  })
})


it('keeps the active-cycle origin week through builder → routine → builder → close',()=>{
 const state=structuredClone(DEF);state.programmeMode=true;state.routines=[{id:'r1',name:'Routine',emoji:'dumbbell',ex:[]}];
 const definition=createProgrammeDefinition({name:'Active cycle',progression:'off',weeks:[{days:[{weekday:1,sessions:[{routineId:'r1'}]}]},{days:[{weekday:1,sessions:[{routineId:'r1'}]}]}]},state,{id:'definition'});
 startProgrammeCycleInState(state,definition,{id:'cycle',week1StartDate:todayISO()});
 const view=mount(state,{pathname:'/programme/new',state:{mode:'edit-cycle',cycleId:'cycle',programmeDetailReturn:{kind:'cycle',id:'cycle',week:2}}});
 click(view.querySelector('[aria-label="Edit routine"]'));
 click(view.querySelector('[aria-label="Back to programme"]'));
 click(view.querySelector('[aria-label="Close"]'));
 expect(view.querySelector('[data-testid="home"]').dataset.search).toBe('?cycle=cycle&week=2');
 expect(useStore.getState().S.programmes.cycles[0].id).toBe('cycle');
});

it('saves an active-cycle edit back to its Home week without creating another cycle',()=>{
 const state=structuredClone(DEF);state.programmeMode=true;state.routines=[{id:'r1',name:'Routine',emoji:'dumbbell',ex:[]}];
 const definition=createProgrammeDefinition({name:'Active cycle',progression:'off',weeks:[{days:[{weekday:1,sessions:[{routineId:'r1'}]}]},{days:[{weekday:1,sessions:[{routineId:'r1'}]}]}]},state,{id:'definition'});
 startProgrammeCycleInState(state,definition,{id:'cycle',week1StartDate:todayISO()});
 const view=mount(state,{pathname:'/programme/new',state:{mode:'edit-cycle',cycleId:'cycle',programmeDetailReturn:{kind:'cycle',id:'cycle',week:2}}});
 click([...view.querySelectorAll('button')].find(button=>button.textContent==='Save programme'));
 expect(view.querySelector('[data-testid="home"]').dataset.search).toBe('?cycle=cycle&week=2');
 expect(useStore.getState().S.programmes.cycles).toHaveLength(1);
});
