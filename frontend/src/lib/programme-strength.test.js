import {expect,it} from 'vitest'
import {programmeTargetHistory,programmeAdaptiveEstimate} from './programme-strength.js'
const workout=(d,w,unit='kg',extra={})=>({d,unit,...extra,entries:[{id:'x',target:{mode:'reps'},sets:[{w,r:1,done:true,phase:'work'}]}]})
it('uses recent median rather than lifetime peak and applies live age retention',()=>{
 const history=[workout('2026-01-01',500),workout('2026-02-01',100),workout('2026-02-02',120),workout('2026-02-03',110)];
 expect(programmeAdaptiveEstimate(history,Date.parse('2026-02-04T12:00:00Z'))).toBe(110);
 expect(programmeAdaptiveEstimate(history,Date.parse('2026-04-25T12:00:00Z'))).toBe(55);
});
it('excludes incompatible or unknown units, partial history, warmups and wrong modes',()=>{
 const good=workout('2026-02-01',100),bad=workout('2026-02-02',500,'lb'),unknown=workout('2026-02-03',600);delete unknown.unit;
 const state={unit:'kg',workouts:[good,bad,unknown,workout('2026-02-04',700,'kg',{partial:true})]};
 const history=programmeTargetHistory(state,{id:'x',mode:'reps'});expect(history).toHaveLength(1);
 history[0].entries[0].sets.push({w:1000,r:1,done:true,phase:'warmup'},{w:2000,r:1,done:true,mode:'time'});
 expect(programmeAdaptiveEstimate(history,Date.parse('2026-02-05T12:00:00Z'))).toBe(100);
});
