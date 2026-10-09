// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {afterEach,expect,it} from 'vitest'
import ProgrammePickup from './ProgrammePickup.jsx'
import {DEF,useStore} from '../store/useStore.js'
import {createProgrammeDefinition} from '../lib/programmes.js'
let root,host;afterEach(()=>{act(()=>root?.unmount());host?.remove()})
it('reviews before starting and creates a cycle only after explicit Start cycle',()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const state={...structuredClone(DEF),programmeMode:true,routines:[{id:'r',name:'Routine',ex:[{id:'x',mode:'reps',sets:1,reps:5,weight:20}]}]};const definition=createProgrammeDefinition({name:'Pickup block',weeks:[{days:[{weekday:1,sessions:[{routineId:'r'}]}]}]},state,{id:'p'});state.programmes={definitions:[definition],cycles:[]};useStore.setState({S:state});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<MemoryRouter initialEntries={[{pathname:'/programme/pickup',state:{programmeId:'p'}}]}><Routes><Route path='/programme/pickup' element={<ProgrammePickup/>}/><Route path='/home' element={<div>Returned to Home</div>}/></Routes></MemoryRouter>));
 expect(host.textContent).toContain('Pickup block');expect(useStore.getState().S.programmes.cycles).toHaveLength(0);
 act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Start cycle').click());expect(useStore.getState().S.programmes.cycles).toHaveLength(1);expect(host.textContent).toContain('Returned to Home');
});


it('groups repeated exercises by routine and retains each edited target',()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const state={...structuredClone(DEF),programmeMode:true,routines:[{id:'r',name:'Push',ex:[{id:'x',mode:'reps',sets:1,reps:5,weight:20}]},{id:'s',name:'Pull',ex:[{id:'x',mode:'reps',sets:1,reps:5,weight:45}]}]}
 const definition=createProgrammeDefinition({name:'Grouped',weeks:[{days:[{weekday:1,sessions:[{routineId:'r'},{routineId:'s'}]}]}]},state,{id:'p'})
 state.programmes={definitions:[definition],cycles:[]};useStore.setState({S:state})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 act(()=>root.render(<MemoryRouter initialEntries={[{pathname:'/programme/pickup',state:{programmeId:'p'}}]}><ProgrammePickup/></MemoryRouter>))
 const groups=host.querySelectorAll('[data-pickup-routine]');expect(groups).toHaveLength(2);expect([...groups].map(g=>g.open)).toEqual([false,false])
 const row=groups[0].querySelector('[data-pickup-key]')
 act(()=>row.querySelector('[aria-label="Increase"]').click())
 expect(row.querySelector('input').value).toBe('22.5')
 expect(groups[1].querySelector('input').value).toBe('45')
 act(()=>groups[0].querySelector('summary').click());act(()=>groups[0].querySelector('summary').click())
 expect(row.querySelector('input').value).toBe('22.5')
 expect(host.querySelector('.pickup-weeks').open).toBe(false)
})
