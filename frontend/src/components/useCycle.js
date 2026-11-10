// The account's cycle log (contrib/cloudflare/cycle.js, /api/cycle), kept out of the synced profile
// on purpose: it lives only on the server and in this module's memory. undefined while loading,
// null when this server has no cycle tracking, else { days, prefs, people, partners }.
// The memory is dropped when another account signs in, so one never sees the other's days.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { cleanDay } from '../lib/cycle.js'

let cache, at = 0, pending = null, owner = null
const subs = new Set()
const set = v => { cache = v; at = Date.now(); subs.forEach(fn => fn(v)) }
const load = () => api('/api/cycle').catch(e => (e.status === 404 || e.code === 'bad-response' ? null : Promise.reject(e)))

export function refreshCycle() {
  pending ||= load().then(set, () => set(cache ?? null)).finally(() => { pending = null })
  return pending
}

export function useCycle() {
  const uid = useStore(s => s.user?.id) ?? null
  if (uid !== owner) { owner = uid; cache = undefined; at = 0 }
  const [c, setC] = useState(cache)
  useEffect(() => {
    subs.add(setC)
    setC(cache)
    if (uid && Date.now() - at > 5 * 60e3) refreshCycle()
    return () => { subs.delete(setC) }
  }, [uid])
  return uid ? c : null
}

// One request at a time, so two quick taps cannot reach the server out of order.
let queue = Promise.resolve()
const send = fn => (queue = queue.catch(() => {}).then(fn))

/** Saves one day (an empty one deletes it): shown at once, put back if the server refuses. */
export function saveDay(date, day) {
  const before = cache, clean = cleanDay(day), days = { ...before.days }
  if (clean) days[date] = clean; else delete days[date]
  set({ ...before, days })
  return send(() => api('/api/cycle/day', { method: 'PUT', body: JSON.stringify({ date, ...day }) })).catch(e => { set({ ...cache, days: before.days }); throw e })
}

/** Changes the settings (sharing, reminder, time zone). `share` is the whole { uid: level } map. */
export function savePrefs(patch) {
  const before = cache
  set({ ...before, prefs: { ...before.prefs, ...patch } })
  return send(() => api('/api/cycle/prefs', { method: 'PUT', body: JSON.stringify(patch) }))
    .then(r => set({ ...cache, prefs: r?.prefs || cache.prefs }), e => { set({ ...cache, prefs: before.prefs }); throw e })
}

/** Deletes everything this account logged. */
export async function wipeCycle() {
  await api('/api/cycle', { method: 'DELETE' })
  set({ ...cache, days: {}, prefs: {} })
}
