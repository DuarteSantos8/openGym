import { describe, expect, it } from 'vitest'
import { createProgrammeDefinition, startProgrammeCycleInState, programmeCycleItems, programmeWorkoutSource, currentProgrammeProjection, programmeSessionsForStart, resolveOverdueProgrammeInState, prepareProgrammeStartInState, settleProgrammeCycleInState, updateActiveProgrammeCycleInState } from './programmes.js'
import { programmeTimelineForCycle } from './programme-timeline.js'
const now = '2026-10-16T12:00:00Z'
function fixture() {
 const state={programmeMode:true, routines:[{id:'r',name:'Workout',ex:[]}],workouts:[],programmes:{cycles:[],definitions:[]}}
 const definition=createProgrammeDefinition({name:'Block',weeks:[{days:[1,3,5].map(weekday=>({weekday,sessions:[{routineId:'r'}]}))},{days:[{weekday:1,sessions:[{routineId:'r'}]}]},{mode:'rest',days:[]},{days:[{weekday:1,sessions:[{routineId:'r'}]}]}]},state,{id:'p'})
 const cycle=startProgrammeCycleInState(state,definition,{id:'c',weekStart:1,week1StartDate:'2026-10-12',timeZone:'UTC',now})
 const items=programmeCycleItems(state,cycle,{now});state.workouts.push({id:'done',...programmeWorkoutSource(items[0])})
 return {state,cycle,items}
}
describe('overdue programme choices',()=>{
 it('keeps the oldest unfinished session and week visible ahead of today',()=>{
  const {state,cycle,items}=fixture();expect(programmeSessionsForStart(state,'2026-10-16','2026-10-16')[0].instanceId).toBe(items[1].instanceId)
  expect(currentProgrammeProjection(state,{now:'2026-11-16T12:00:00Z'}).cycles.c.currentWeek).toBe(1)
  expect(programmeTimelineForCycle(state,cycle,{now:'2026-11-16T12:00:00Z'}).currentWeek).toBe(1)
 })
 it('skips without moving other dates or writing a workout, and survives JSON reload',()=>{
  const {state,cycle,items}=fixture();const history=structuredClone(state.workouts)
  resolveOverdueProgrammeInState(state,'c',items[1].instanceId,'skip',{now})
  const reloaded=JSON.parse(JSON.stringify(state));const result=programmeCycleItems(reloaded,reloaded.programmes.cycles[0],{now})
  expect(result[1].status).toBe('skipped');expect(result.map(x=>x.date)).toEqual(items.map(x=>x.date));expect(state.workouts).toEqual(history)
  expect(programmeSessionsForStart(state,'2026-10-16','2026-10-16').map(x=>x.instanceId)).toEqual([items[2].instanceId])
 })
 it('moves only outstanding dates, preserves rest weeks and continues following today without writes',()=>{
  const {state,cycle,items}=fixture();const history=JSON.stringify(state.workouts)
  resolveOverdueProgrammeInState(state,'c',items[1].instanceId,'carry',{now})
  expect(programmeCycleItems(state,cycle,{now}).map(x=>x.date)).toEqual(['2026-10-12','2026-10-16','2026-10-18','2026-10-21','2026-11-04'])
  const before=JSON.stringify(state)
  expect(programmeCycleItems(state,cycle,{now:'2026-10-17T12:00:00Z'}).map(x=>x.date)).toEqual(['2026-10-12','2026-10-17','2026-10-19','2026-10-22','2026-11-05'])
  expect(JSON.stringify(state)).toBe(before);expect(JSON.stringify(state.workouts)).toBe(history)
 })
 it('freezes the chosen date while active, follows again after cancellation, and stops after completion',()=>{
  const {state,cycle,items}=fixture()
  const started=prepareProgrammeStartInState(state,items[1],{now})
  state.active={...programmeWorkoutSource(started)}
  expect(programmeCycleItems(state,cycle,{now:'2026-10-17T12:00:00Z'})[1].date).toBe('2026-10-16')
  state.active=null
  const restarted=prepareProgrammeStartInState(state,items[1],{now:'2026-10-17T12:00:00Z'})
  state.workouts.push({id:'finished',...programmeWorkoutSource(restarted)})
  expect(programmeCycleItems(state,cycle,{now:'2026-10-20T12:00:00Z'}).slice(1,3).map(x=>x.date)).toEqual(['2026-10-17','2026-10-19'])
 })
 it('rejects invalid, completed, future, stale and active-session actions without changing history',()=>{
  const {state,cycle,items}=fixture();const before=JSON.stringify(state)
  for(const id of ['missing',items[0].instanceId,items[2].instanceId,items[3].instanceId]) expect(()=>resolveOverdueProgrammeInState(state,'c',id,'skip',{now})).toThrow()
  expect(()=>resolveOverdueProgrammeInState(state,'c',items[1].instanceId,'bad',{now})).toThrow()
  expect(()=>prepareProgrammeStartInState(state,items[2],{now})).toThrow(/earlier/)
  expect(JSON.stringify(state)).toBe(before)
  state.active={id:'other'};expect(()=>resolveOverdueProgrammeInState(state,'c',items[1].instanceId,'skip',{now})).toThrow(/current workout/)
 })
 it('settles a cycle with completed and explicitly skipped sessions',()=>{
  const {state,cycle,items}=fixture()
  for(const item of items.slice(1)) resolveOverdueProgrammeInState(state,'c',item.instanceId,'skip',{now:'2026-12-01T12:00:00Z'})
  expect(cycle.status).toBe('completed');expect(state.workouts).toHaveLength(1)
 })
 it('uses the programme timezone across a DST boundary',()=>{
  const {state,cycle,items}=fixture();cycle.timeZone='America/Los_Angeles'
  resolveOverdueProgrammeInState(state,'c',items[1].instanceId,'carry',{now:'2026-11-02T07:30:00Z'})
  expect(programmeCycleItems(state,cycle,{now:'2026-11-02T07:30:00Z'})[1].date).toBe('2026-11-01')
 })
})

it('keeps the postponement offset when an unstarted future session is edited',()=>{
 const {state,cycle,items}=fixture();resolveOverdueProgrammeInState(state,'c',items[1].instanceId,'carry',{now});
 const weeks=structuredClone(cycle.snapshot.weeks);weeks[1].days[0].weekday=2;
 updateActiveProgrammeCycleInState(state,'c',{weeks},{now});
 expect(programmeCycleItems(state,cycle,{now})[3].date).toBe('2026-10-22');
 expect(programmeCycleItems(state,cycle,{now})[0].date).toBe('2026-10-12');
});
