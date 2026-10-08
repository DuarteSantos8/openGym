import { expect, it } from 'vitest'
import { programmeTimelineForCycle } from './programme-timeline.js'
const cfg={id:'fixture',mode:'reps',sets:1,reps:5,weight:20,inc:2.5,prog:'linear'}
const cycle={id:'c',programmeId:'p',name:'Block',progression:'linear',lengthWeeks:2,weekStart:1,week1StartDate:'2026-02-02',timeZone:'UTC',snapshot:{weeks:[1,2].map(i=>({days:[{weekday:1,sessions:[{sessionTemplateId:'s'+i,routineId:'r',routineSnapshot:{name:'Routine',ex:[cfg,{...cfg}]}}]}]}))}}
const workout=(cycleId,week,weight)=>({unit:'kg',d:'2026-02-02',programmeInstance:{cycleId,instanceId:cycleId+':s'+week,weekIndex:week,weekday:1},entries:[0,1].map(i=>({id:cfg.id,occurrenceId:cfg.id+'#'+(i+1),target:{...cfg,weight:weight+i*10},sets:[{w:weight+i*10,r:5,done:true}]}))})
it('scopes prescriptions to cycle, occurrence and item boundary without mutating history',()=>{
 const state={unit:'kg',workouts:[workout('c',1,30),workout('other',1,200),workout('c',2,100)]};const before=JSON.stringify(state);
 const timeline=programmeTimelineForCycle(state,cycle,{now:'2026-02-03T12:00:00Z'});
 expect(timeline.weeks[0].items[0].exercises.map(e=>e.next)).toEqual(['32.5 kg × 5','42.5 kg × 5']);
 expect(timeline.weeks[0].items[0].status).toBe('completed');expect(JSON.stringify(state)).toBe(before);
});
it('does not treat partial history or incompatible weight units as an advancing baseline',()=>{
 const partial={...workout('c',1,90),partial:true},foreign={...workout('c',1,200),unit:'lb'};
 const badEntry=workout('c',1,300);badEntry.entries.forEach(entry=>{entry.unit='lb'});
 const timeline=programmeTimelineForCycle({unit:'kg',workouts:[partial,foreign,badEntry]},cycle,{now:'2026-02-03T12:00:00Z'});
 expect(timeline.weeks[0].items[0].exercises[0]).toMatchObject({last:'—',next:'20 kg × 5'});
});

it('keeps deload targets fixed and uses timed history only for timed prescriptions',()=>{
 const c=structuredClone(cycle);c.snapshot.weeks[0].mode='deload';
 let result=programmeTimelineForCycle({unit:'kg',workouts:[workout('c',1,30)]},c,{now:'2026-02-03'});
 expect(result.weeks[0].items[0].exercises[0].next).toBe('20 kg × 5');
 c.snapshot.weeks[0].mode='normal';c.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex=[{id:'timer',mode:'time',sets:1,sec:30,inc:5,prog:'time'}];
 const timed={...workout('c',1,30),entries:[{id:'timer',target:{mode:'time',sets:1,sec:30},sets:[{sec:30,done:true}]}]};
 result=programmeTimelineForCycle({workouts:[timed]},c,{now:'2026-02-03'});
 expect(result.weeks[0].items[0].exercises[0]).toMatchObject({last:'30s',next:'35s'});
});
