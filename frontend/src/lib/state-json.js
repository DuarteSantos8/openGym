// The saved copy of the state as JSON, written to localStorage on every change (store/useStore.js
// persist) and to the phone's file mirror (lib/mobile.js nativeSave). The workout history is most
// of it (a 400-workout profile: ~90 % of 360 KB) and a ticked set never changes it: since update()
// keeps a field it did not touch as the very same object (draftOf), the history's JSON is kept
// from the last write while the array is that same object, and only the rest is serialised again.
// The text is exactly JSON.stringify(state): same keys, same order, same values.
//
// That is only right as long as nothing changes a saved history in place, which nothing may (every
// change goes through a copy). The test suite checks it on every call: a history changed in place
// throws there instead of being saved stale.
let histRef = null
let histJson = null

export function stateJson(S) {
  const w = S && S.workouts
  if (!S || typeof S !== 'object' || Array.isArray(S) || typeof S.toJSON === 'function' || !Array.isArray(w)) return JSON.stringify(S)
  let wj
  if (w === histRef) wj = histJson
  else { wj = JSON.stringify(w); histRef = w; histJson = wj }
  if (import.meta.env?.MODE === 'test' && wj !== JSON.stringify(w)) throw new Error('state-json: the saved workout history was changed in place')
  const parts = []
  for (const k of Object.keys(S)) {
    const v = k === 'workouts' ? wj : JSON.stringify(S[k])
    if (v !== undefined) parts.push(JSON.stringify(k) + ':' + v)
  }
  return '{' + parts.join(',') + '}'
}
