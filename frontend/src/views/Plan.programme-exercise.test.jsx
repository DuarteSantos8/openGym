import { createProgrammeDefinition, startProgrammeCycleInState } from '../lib/programmes.js'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { DEF, useStore } from '../store/useStore.js'
vi.mock('../sheets.jsx',()=>({exerciseDetailSheet:vi.fn(),confirmSheet:vi.fn(),startProgrammeFlow:vi.fn(),dayAssignSheet:vi.fn(),dayAddRoutineSheet:vi.fn(),starterPlanSheet:vi.fn(),dayOverrideSheet:vi.fn(),dayViewSheet:vi.fn(),loadStarterPlan:vi.fn(),planToolsSheet:vi.fn()}))
import { exerciseDetailSheet, dayOverrideSheet, dayAssignSheet } from '../sheets.jsx'
let root, host
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();vi.setSystemTime(new Date('2026-12-28T12:00:00'));vi.clearAllMocks();localStorage.clear()})
afterEach(()=>{act(()=>root?.unmount());host?.remove();vi.useRealTimers();localStorage.clear()})
function HomeDestination(){const location=useLocation();return <div data-testid="home" data-search={location.search}>Home</div>}
function mount(entry="/plan"){useStore.setState({S:{...structuredClone(DEF),routines:[{id:'a',name:'Upper Body',ex:[]},{id:'b',name:'Legs',ex:[]}],week:{1:'a'},dayPlan:{'2026-12-28':['b','a'],'2026-12-29':'rest'}},user:null});host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/plan" element={<Plan/>}/><Route path="/home" element={<HomeDestination/>}/></Routes></MemoryRouter>))}
const chooseTab = name => act(() => [...host.querySelectorAll('.plan-views button')].find(button => button.textContent === name).click())
it('opens default and custom programme exercises, including supersets, without changing the plan',()=>{
 mount();const state=structuredClone(useStore.getState().S);
 const custom={id:'c-test',n:'Custom press',bp:'shoulders',eq:'barbell',custom:true};
 state.customEx=[custom];state.routines[0].ex=[{id:'1162',sets:3,reps:8,sg:'pair'},{id:custom.id,sets:3,reps:8,sg:'pair'},{id:'0001',sets:2,reps:10}];
 const definition=createProgrammeDefinition({name:'Exercise links',weeks:[{days:[{weekday:1,sessions:[{routineId:'a'}]}]}]},state,{id:'links'});
 state.programmes={definitions:[definition],cycles:[]};state.programmeMode=true;
 act(()=>useStore.setState({S:state}));chooseTab('Programmes');const before=JSON.stringify(useStore.getState().S);
 act(()=>host.querySelector('.programme-ready-open').click());act(()=>host.querySelector('.prog-session-toggle').click());
 const rows=host.querySelectorAll('.prog-exercise-row');expect(rows).toHaveLength(3);
 act(()=>rows[0].click());expect(exerciseDetailSheet).toHaveBeenLastCalledWith(expect.objectContaining({id:'1162'}));
 act(()=>rows[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(exerciseDetailSheet).toHaveBeenLastCalledWith(custom);
 act(()=>rows[2].dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})));expect(exerciseDetailSheet).toHaveBeenLastCalledWith(expect.objectContaining({id:'0001'}));
 expect(JSON.stringify(useStore.getState().S)).toBe(before);
});
