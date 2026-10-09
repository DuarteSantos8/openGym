import { describe, expect, it } from 'vitest'
import { completedProgrammeSummary } from './programme-summary.js'
const cycle={id:'c',lengthWeeks:2,week1StartDate:'2026-08-31'}
const workout=(week,weight,extra={})=>({id:'w'+week,unit:'kg',complete:true,programmeInstance:{cycleId:'c',instanceId:'i'+week,weekIndex:week},entries:[{id:'bench',name:'Bench',target:{mode:'reps'},sets:[{phase:'work',mode:'reps',w:weight,r:5,done:true},{phase:'warmup',w:999,r:5,done:true},{phase:'work',w:888,r:5,done:false}]}],...extra})
describe('completed Programme summary',()=>{
 it('isolates cycle and completed work sets and uses current 1RM policy',()=>{
  const state={workouts:[workout(1,20),workout(2,30),workout(2,900,{partial:true}),workout(2,900,{owed:true}),workout(2,900,{complete:false}),workout(2,900,{programmeInstance:{cycleId:'other',weekIndex:2}})]};
  const before=JSON.stringify(state);const result=completedProgrammeSummary(state,cycle);expect(result.sessions).toBe(2);expect(result.progress[0]).toMatchObject({weight:{first:20,last:30},rm1:{first:23.3,last:35},volume:{first:100,last:150}});expect(JSON.stringify(state)).toBe(before);
 });
 it('never mixes pounds with kilograms or infers an unknown unit',()=>{
  const result=completedProgrammeSummary({workouts:[workout(1,20),workout(2,100,{unit:'lb'}),workout(2,900,{unit:undefined})]},cycle);
  expect(result.progress).toHaveLength(2);expect(result.progress.find(row=>row.unit==='kg').weight.last).toBe(20);expect(result.progress.find(row=>row.unit==='lb').weight.first).toBe(100);
 });
});
