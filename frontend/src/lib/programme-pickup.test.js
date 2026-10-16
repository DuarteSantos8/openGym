import { expect, it } from 'vitest'
import { pickupRows, pickupTarget, startProgrammePickupInState, completedProgrammeDefinition, repeatProgrammePickupInState } from './programme-pickup.js'
import { createProgrammeDefinition, currentProgrammeProjection } from './programmes.js'
import { buildSessionEntries } from './session-start.js'
const fixture=()=>{const state={unit:'kg',exWeights:{x:{w:200}},workouts:[],routines:[{id:'r',name:'Routine',ex:[{id:'x',mode:'reps',weight:20,sets:1,reps:5}]}],programmes:{definitions:[],cycles:[]}};const definition=createProgrammeDefinition({name:'Block',weeks:[{days:[{weekday:1,sessions:[{routineId:'r'}]}]}]},state,{id:'p'});state.programmes.definitions.push(definition);return {state,definition}}
it('applies chosen targets only to a new snapshot with fresh repeated-session identities and actual start targets',()=>{
 const {state,definition}=fixture(),before=JSON.stringify({definition,routines:state.routines});const key=pickupRows(state,definition)[0].key;
 const cycle=startProgrammePickupInState(state,definition,{length:3,weekModes:['normal','deload','normal'],values:{[key]:35},now:'2026-02-02T12:00:00Z',week1StartDate:'2026-02-02',timeZone:'UTC'});
 const sessions=cycle.snapshot.weeks.flatMap(week=>week.days.flatMap(day=>day.sessions));expect(new Set(sessions.map(session=>session.sessionTemplateId)).size).toBe(3);expect(sessions.map(session=>session.routineSnapshot.ex[0].weight)).toEqual([35,35,35]);expect(JSON.stringify({definition,routines:state.routines})).toBe(before);
 const item=currentProgrammeProjection(state,{now:'2026-02-02T12:00:00Z'}).items[0];expect(buildSessionEntries(state,item.routineSnapshot,item)[0].sets[0].w).toBe(35);
});
it('rejects invalid targets before creating a cycle and refuses duplicate active cycles',()=>{
 const {state,definition}=fixture(),key=pickupRows(state,definition)[0].key;expect(()=>startProgrammePickupInState(state,definition,{values:{[key]:-1}})).toThrow();expect(state.programmes.cycles).toHaveLength(0);
 const timed=structuredClone(definition);timed.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].mode='time';expect(()=>startProgrammePickupInState(state,timed,{progression:'time',values:{[key]:0}})).toThrow('Invalid starting target');
 startProgrammePickupInState(state,definition,{});expect(()=>startProgrammePickupInState(state,definition,{})).toThrow(/active cycle/);expect(state.programmes.cycles).toHaveLength(1);
});

it('reduces configured loads with live rounding rules and treats manual overrides as final',()=>{
 const options={loadMode:'deload',deloadPercent:10};
 expect(pickupTarget({key:'w',field:'weight',mode:'reps',value:42.5,step:2.5},options)).toBe(37.5);
 expect(pickupTarget({key:'r',field:'reps',mode:'reps',value:7,step:1},options)).toBe(6);
 expect(pickupTarget({key:'r',field:'reps',mode:'reps',value:1,step:1},options)).toBe(1);
 expect(pickupTarget({key:'t',field:'sec',mode:'time',value:33,step:5},options)).toBe(29.7);
 expect(pickupTarget({key:'c',field:'min',mode:'cardio',value:20,step:1},options)).toBe(20);
 expect(pickupTarget({key:'w',field:'weight',mode:'reps',value:42.5,step:2.5},{...options,values:{w:40}})).toBe(40);
 const {state,definition}=fixture(),before=JSON.stringify(definition);
 const cycle=startProgrammePickupInState(state,definition,{...options,deloadPercent:25,now:'2026-02-02T12:00:00Z',week1StartDate:'2026-02-02',timeZone:'UTC'});
 expect(cycle.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(15);
 const item=currentProgrammeProjection(state,{now:'2026-02-02T12:00:00Z'}).items[0];expect(buildSessionEntries(state,item.routineSnapshot,item)[0].sets[0].w).toBe(15);expect(JSON.stringify(definition)).toBe(before);
});
it('rejects an invalid reduction without creating a cycle',()=>{for(const value of [NaN,Infinity,0,51]){const {state,definition}=fixture();expect(()=>startProgrammePickupInState(state,definition,{loadMode:'deload',deloadPercent:value})).toThrow(/Reduction/);expect(state.programmes.cycles).toHaveLength(0)}});

it('repeats the completed snapshot instead of an edited or deleted definition and leaves history intact',()=>{
 const {state,definition}=fixture();const old=startProgrammePickupInState(state,definition,{id:'old'});old.status='completed';old.completedAt='2026-02-01T12:00:00Z';
 definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight=200;
 const before=JSON.stringify(old);expect(completedProgrammeDefinition(state,'old').weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(20);
 state.programmes.definitions=[];
 const next=repeatProgrammePickupInState(state,'old',{id:'new',loadMode:'deload',deloadPercent:25});expect(next.repeatedFromCycleId).toBe('old');expect(next.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(15);expect(JSON.stringify(old)).toBe(before);expect(state.programmes.definitions).toEqual([]);
 expect(()=>repeatProgrammePickupInState(state,'old')).toThrow(/active cycle/);expect(()=>repeatProgrammePickupInState(state,'new')).toThrow(/Completed/);
});
