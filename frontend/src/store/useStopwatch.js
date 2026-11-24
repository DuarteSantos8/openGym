// The workout stopwatch's state (lib/stopwatch.js decides, this keeps it). A device fact, not part
// of the profile: it lives in localStorage, so it counts on while the app is in the background or
// reloads, and never syncs.
import { create } from 'zustand'
import { EMPTY } from '../lib/stopwatch.js'

const KEY = 'gym_stopwatch_v1'

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && typeof v === 'object' ? { ...EMPTY, ...v } : EMPTY
  } catch { return EMPTY }
}
function save(w) {
  try { localStorage.setItem(KEY, JSON.stringify(w)) } catch { /* storage blocked: it lives until a reload */ }
}

export const useStopwatch = create(set => ({
  w: load(),
  apply: fn => set(st => { const w = fn(st.w); save(w); return { w } }),
}))
