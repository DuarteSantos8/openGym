import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const M = await import(pathToFileURL(resolve('frontend/src/lib/sync-merge.js')))
const A = await import(pathToFileURL(resolve('api/sync-stamps.js')))
const copy = x => structuredClone(x)
const visible = x => M.visibleOptionalEntries(x,'nutritionEntries').map(r=>r.id)
const rec = id => ({id,name:id,_ts:10,_f:{name:10}})
const server = {_ts:200,resetAt:200,resetIds:{nutritionEntries:['a']},nutritionEntries:[rec('a'),rec('b')],deleted:{nutritionEntries:{a:200}}}
const device = {_ts:210,resetAt:200,resetIds:{nutritionEntries:['a','b']}}
const resetPut = A.stampPut(copy(server),copy(device),{overRead:true,now:210})
const resetMerge = M.mergeStates(copy(server),copy(device))
const cur = {_ts:286,nutritionEntries:[{id:'a',distanceM:3,_ts:286,_f:{distanceM:286}}]}
const incoming = {_ts:495,nutritionEntries:[{id:'a',distanceM:3,note:'x',_ts:495,_f:{note:495}}]}
const first = A.stampPut(copy(cur),copy(incoming),{overRead:true,now:500})
const replay = A.stampPut(copy(first),copy(incoming),{overRead:true,now:500})
const third = [{id:'a',distanceM:9,_ts:300,_f:{distanceM:300}}]
const mergeFirst = M.mergeOptionalEntries(first.nutritionEntries,third)
const mergeReplay = M.mergeOptionalEntries(replay.nutritionEntries,third)
const observations = {resetPutVisible:visible(resetPut),resetMergeVisible:visible(resetMerge),firstFieldClock:first.nutritionEntries[0]._f.distanceM,replayFieldClock:replay.nutritionEntries[0]._f.distanceM,thirdAfterFirst:mergeFirst[0].distanceM,thirdAfterReplay:mergeReplay[0].distanceM}
const checks = [
 ['reset PUT hides newly learned ids',()=>assert.deepEqual(observations.resetPutVisible,[])],
 ['reset client merge hides newly learned ids',()=>assert.deepEqual(observations.resetMergeVisible,[])],
 ['identical replay preserves field clock',()=>assert.equal(observations.replayFieldClock,observations.firstFieldClock)],
 ['third replica result survives replay',()=>assert.equal(observations.thirdAfterReplay,observations.thirdAfterFirst)]
].map(([name,check])=>{try{check();return{name,pass:true}}catch{return{name,pass:false}}})
console.log(JSON.stringify({node:process.version,observations,checks},null,2))
if(checks.some(c=>!c.pass))process.exitCode=1
