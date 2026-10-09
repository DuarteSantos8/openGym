// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { DEF, useStore, normalizeState } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkout } from './sheets.jsx'
vi.mock('./lib/sound.js',()=>({beep:vi.fn(),vibrate:vi.fn()}))
beforeEach(()=>{
 const S=structuredClone(DEF);S.workouts=[];S.routines=[{id:'existing',name:'Existing',ex:[]}];S.active={id:'freestyle',d:'2026-09-07',name:'Freestyle',start:Date.now()-10000,unit:'kg',entries:[{id:'0009',target:{mode:'reps',prog:'off'},sets:[{w:20,r:5,done:true}]}]}
 useStore.setState({S,user:null,ready:true});useUI.setState({sheets:[],timer:null,work:null});vi.spyOn(useStore.getState(),'autoBackupNow').mockImplementation(()=>{})
})
afterEach(()=>{vi.restoreAllMocks();useUI.getState().closeAll()})
it('finishes freestyle and restores its record without creating a routine',()=>{
 const before=structuredClone(useStore.getState().S.routines)
 finishWorkout()
 expect(useStore.getState().S.active).toBeNull()
 expect(useStore.getState().S.workouts).toHaveLength(1)
 const restored=normalizeState(JSON.parse(JSON.stringify(useStore.getState().S)))
 expect(restored.routines).toEqual(before)
 expect(restored.workouts[0].id).toBe('freestyle')
})
