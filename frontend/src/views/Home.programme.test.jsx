// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import Home from './Home.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { createProgrammeDefinition, startProgrammeCycleInState, programmeSessionsForDate } from '../lib/programmes.js'
import { todayISO, isoOf } from '../lib/format.js'
vi.mock('../sheets.jsx', () => ({ confirmSheet:vi.fn(), bwSheet:vi.fn(), goalSheet:vi.fn(), dayOverrideSheet:vi.fn(), dayViewSheet:vi.fn(), calendarSheet:vi.fn(), startFlow:vi.fn(), startProgrammeFlow:vi.fn(), startSessionSheet:vi.fn(),startTodayFlow:vi.fn(), starterPlanSheet:vi.fn(), bwDeltaColor:vi.fn() }))
import { confirmSheet, startProgrammeFlow } from '../sheets.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root
let host
afterEach(()=>{ act(()=>root?.unmount()); host?.remove(); vi.clearAllMocks() })
function fixture() {
 const state=structuredClone(DEF); state.programmeMode=true; state.routines=[{id:'push',name:'Live Push',ex:[{id:'bench',sets:1,reps:5,weight:200}]}]; state.week={};state.dayPlan={[todayISO()]:['push']};state.workouts=[];state.active=null;
 const weekday=new Date().getDay();
 const def=createProgrammeDefinition({name:'Strength block',weeks:[{days:[{weekday,sessions:[{routineId:'push'},{routineId:'push'}]}]}]},state,{id:'definition'});
 state.programmes.definitions.push(def);
 startProgrammeCycleInState(state,def,{id:'cycle',week1StartDate:todayISO(),weekStart:weekday});
 return state;
}
function Destination(){const location=useLocation();return <output data-testid="destination">{JSON.stringify(location)}</output>}
function mount(state, entry="/home"){useStore.setState({S:state,user:null});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);act(()=>root.render(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/home" element={<Home/>}/><Route path="*" element={<Destination/>}/></Routes></MemoryRouter>));return host}
it('shows each Programme occurrence once, suppresses the classic duplicate, and starts the selected frozen occurrence',()=>{
 const state=fixture(); const items=programmeSessionsForDate(state,todayISO());expect(items).toHaveLength(2);
 const node=mount(state); const rows=node.querySelectorAll('[data-testid="home-programme-session"]');expect(rows).toHaveLength(2);expect(node.querySelectorAll('.today-row')).toHaveLength(2);
 act(()=>[...rows[1].querySelectorAll('button')].find(b=>b.textContent==='Start').click());
 expect(startProgrammeFlow).toHaveBeenCalledWith(expect.objectContaining({instanceId:items[1].instanceId,cycleId:'cycle',routineSnapshot:expect.any(Object)}));
 expect(state.active).toBeNull();
});
it('hides Programme presentation while off without removing cycles',()=>{
 const state=fixture();state.programmeMode=false;expect(programmeSessionsForDate(state,todayISO())).toEqual([]);expect(mount(state).querySelector('[data-testid="home-programme-session"]')).toBeNull();expect(state.programmes.cycles).toHaveLength(1);expect(host.querySelector('[data-testid="active-programme-card"]')).toBeNull();
});
it('keeps the classic Done row for completed work on an unplanned day when Programme mode is off',()=>{
 const state=fixture();const [item]=programmeSessionsForDate(state,todayISO());state.programmeMode=false;state.dayPlan={};state.week={};
 state.workouts=[{id:'done',d:todayISO(),start:Date.now()-3600000,end:Date.now(),name:'Frozen Push',routineIds:['push'],programmeInstanceId:item.instanceId,programmeInstance:{cycleId:item.cycleId,instanceId:item.instanceId,ordinal:item.ordinal}}];
 const node=mount(state);expect(node.querySelector('[data-testid="home-programme-session"]')).toBeNull();
 expect(node.querySelector('.today-row .ttl').textContent).toBe('Frozen Push (done)');expect(node.querySelector('.today-row .tag').textContent).toBe('Done');
});it('shows a single resume row for the exact Programme occurrence',()=>{
 const state=fixture();const items=programmeSessionsForDate(state,todayISO());state.active={id:'active',name:'Frozen Push',programmeInstanceId:items[0].instanceId,entries:[{sets:[{done:true}]}]};
 const before=structuredClone(state.active);const node=mount(state);expect(node.querySelectorAll('.today-row')).toHaveLength(2);expect([...node.querySelectorAll('[data-testid="home-programme-session"] button')].filter(b=>b.textContent==='Resume')).toHaveLength(1);expect(useStore.getState().S.active).toEqual(before);
});


it('places active programmes after the calendar and opens the timeline on Home',()=>{
 const state=fixture();const before=JSON.stringify(state);const node=mount(state);
 const calendar=node.querySelector('.week'),card=node.querySelector('[data-testid="active-programme-card"]');
 expect(calendar.compareDocumentPosition(card)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(node.querySelector('[data-testid="active-programme-detail"]')).toBeNull();
 act(()=>card.querySelector('button').click());
 const detail=node.querySelector('[data-testid="active-programme-detail"]');expect(detail).toBeTruthy();expect(detail.textContent).toContain('Strength block');
 expect(node.querySelector('[data-testid="destination"]')).toBeNull();
 act(()=>detail.querySelector('[aria-label="Close"]').click());expect(node.querySelector('[data-testid="active-programme-detail"]')).toBeNull();
 expect(JSON.stringify(useStore.getState().S)).toBe(before);
});
it('opens the active timeline from a calendar session without leaving Home',()=>{
 const node=mount(fixture());act(()=>node.querySelector('[data-testid="home-programme-session"] .programme-ready-open').click());
 expect(node.querySelector('[data-testid="active-programme-detail"]')).toBeTruthy();expect(node.querySelector('[data-testid="destination"]')).toBeNull();
});
it('keeps timeline Start and Resume bound to the exact cycle occurrence',()=>{
 const state=fixture();const node=mount(state,'/home?cycle=cycle');
 let detail=node.querySelector('[data-testid="active-programme-detail"]');
 act(()=>[...detail.querySelectorAll('button')].find(button=>button.textContent==='Start').click());
 const item=startProgrammeFlow.mock.calls.at(-1)[0];expect(item.cycleId).toBe('cycle');
 act(()=>useStore.setState({S:{...state,active:{programmeInstanceId:item.instanceId}}}));
 detail=node.querySelector('[data-testid="active-programme-detail"]');const resume=[...detail.querySelectorAll('button')].find(button=>button.textContent==='Resume');expect(resume).toBeTruthy();
 act(()=>resume.click());expect(startProgrammeFlow).toHaveBeenLastCalledWith(expect.objectContaining({instanceId:item.instanceId}));
});
it('opens the selected programme week and passes it to the active-cycle editor',()=>{
 const state=fixture();const cycle=state.programmes.cycles[0];cycle.lengthWeeks=2;cycle.snapshot.weeks.push({...structuredClone(cycle.snapshot.weeks[0]),weekIndex:2});
 const node=mount(state,'/home?cycle=cycle&week=2');const detail=node.querySelector('[data-testid="active-programme-detail"]');
 expect(detail.querySelector('[data-testid="programme-week-pill-2"]').getAttribute('aria-selected')).toBe('true');
 act(()=>[...detail.querySelectorAll('button')].find(button=>button.textContent==='Edit programme').click());
 const route=JSON.parse(node.querySelector('[data-testid="destination"]').textContent);
 expect(route.pathname).toBe('/programme/new');expect(route.state).toEqual({mode:'edit-cycle',cycleId:'cycle',programmeDetailReturn:{kind:'cycle',id:'cycle',week:2}});
});
it('requires confirmation to complete a cycle early and preserves recorded workouts',()=>{
 const state=fixture();state.workouts=[{id:'saved',d:'2026-01-01',entries:[]}];const before=structuredClone(state.workouts);
 const node=mount(state,'/home?cycle=cycle');const detail=node.querySelector('[data-testid="active-programme-detail"]');
 act(()=>[...detail.querySelectorAll('button')].find(button=>button.textContent==='Complete early').click());
 expect(useStore.getState().S.programmes.cycles[0].status).toBe('active');expect(node.querySelector('[data-testid="active-programme-detail"]')).toBeTruthy();
 expect(confirmSheet).toHaveBeenCalledWith(expect.objectContaining({title:'Complete programme early?',confirmText:'Complete'}));
 act(()=>confirmSheet.mock.calls.at(-1)[0].onConfirm());
 expect(useStore.getState().S.programmes.cycles[0].status).toBe('completed');expect(useStore.getState().S.workouts).toEqual(before);
 expect(node.querySelector('[data-testid="active-programme-card"]')).toBeNull();expect(node.querySelector('[data-testid="active-programme-detail"]')).toBeNull();
});
