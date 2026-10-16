// What the global search remembers per profile (fitness-eval ux-search.md §2): Recent (up to six,
// newest first) of two kinds, a submitted query (`{ kind: 'query', query }`, which refills the
// field) and an opened result (`{ kind: 'result', type, id, label, query }`, reopened in one tap);
// and how often each result was opened from search, which orders ties and Suggested's
// "most opened". In localStorage under the profile's id, wiped when that profile signs out or another
// profile takes its place.
import { create } from 'zustand'
import { useStore } from '../../store/useStore.js'

export const RECENT_MAX = 6
const RECENT_KEY = 'gains_search_recent:'
const OPENED_KEY = 'gains_search_opened:'

const storage = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const profileOf = user => (user ? 'u' + String(user.id ?? user.name ?? '') : 'guest')
const read = (key, fallback) => {
  try { const v = JSON.parse(storage()?.getItem(key) || 'null'); return v ?? fallback } catch { return fallback }
}
const write = (key, v) => { try { storage()?.setItem(key, JSON.stringify(v)) } catch { /* full or private: in memory only */ } }

const sameRecent = (a, b) => a.kind === b.kind && (a.kind === 'query' ? a.query.trim().toLowerCase() === b.query.trim().toLowerCase() : a.type === b.type && String(a.id) === String(b.id))
const valid = r => r && (r.kind === 'query' ? typeof r.query === 'string' && r.query.trim() : r.kind === 'result' && typeof r.type === 'string' && r.id != null)

function load(profile) {
  const list = read(RECENT_KEY + profile, [])
  const opened = read(OPENED_KEY + profile, {})
  return { profile, list: Array.isArray(list) ? list.filter(valid).slice(0, RECENT_MAX) : [], opened: opened && typeof opened === 'object' ? opened : {} }
}

export const useRecents = create(() => load(profileOf(useStore.getState?.()?.user)))

const save = patch => {
  const s = { ...useRecents.getState(), ...patch }
  useRecents.setState(patch)
  if (patch.list) write(RECENT_KEY + s.profile, patch.list)
  if (patch.opened) write(OPENED_KEY + s.profile, patch.opened)
}

/** A query that was submitted (Enter), or a result that was opened. */
export function addRecent(entry) {
  if (!valid(entry)) return
  const clean = entry.kind === 'query' ? { kind: 'query', query: entry.query.trim() } : { kind: 'result', type: entry.type, id: entry.id, label: entry.label || '', query: entry.query || '' }
  const list = [clean, ...useRecents.getState().list.filter(r => !sameRecent(r, clean))].slice(0, RECENT_MAX)
  save({ list })
}

/** Counts a result opened from search (frecency): `{ key: { n, at } }`. */
export function noteOpened(key, now = Date.now()) {
  const opened = { ...useRecents.getState().opened }
  opened[key] = { n: (opened[key]?.n || 0) + 1, at: now }
  // Keep the map small: the 200 most recently opened.
  const keys = Object.keys(opened)
  if (keys.length > 200) keys.sort((a, b) => opened[a].at - opened[b].at).slice(0, keys.length - 200).forEach(k => delete opened[k])
  save({ opened })
}

/** How often (and how lately) a result was opened: a score that only ever orders ties. */
export function openedScore(key, now = Date.now()) {
  const o = useRecents.getState().opened[key]
  if (!o) return 0
  const days = Math.max(0, (now - o.at) / 86400000)
  return o.n / (1 + days / 7)
}

export const removeRecent = entry => save({ list: useRecents.getState().list.filter(r => !sameRecent(r, entry)) })

// Bumped whenever the profile changes (including back to one that was wiped on the way out), so
// a snapshot taken before is never restored into whoever is signed in after.
let epoch = 0

/** Empties Recent and hands back what was there, for the toast's Undo: a snapshot that
 *  `restoreRecents` accepts only while the same profile, uninterrupted, is still signed in. */
export function clearRecents() {
  const { list, profile } = useRecents.getState()
  save({ list: [] })
  return { list, profile, epoch }
}
export function restoreRecents(snapshot) {
  const now = useRecents.getState()
  if (!snapshot || snapshot.profile !== now.profile || snapshot.epoch !== epoch) return
  save({ list: snapshot.list.filter(valid).slice(0, RECENT_MAX) })
}

/** Drops the result entries whose target no longer exists (`exists(entry)` false). */
export function pruneRecents(exists) {
  const { list } = useRecents.getState()
  const kept = list.filter(r => r.kind === 'query' || exists(r))
  if (kept.length !== list.length) save({ list: kept })
}

// Each profile its own Recent, and none outlives its session: signing out, or switching to another
// profile (setUser), wipes the one that left. A guest's entries stay until a profile adopts them.
if (typeof useStore.subscribe === 'function') {
  useStore.subscribe((s, prev) => {
    const was = profileOf(prev.user)
    const now = profileOf(s.user)
    if (was === now) return
    epoch += 1
    if (prev.user) {
      try { storage()?.removeItem(RECENT_KEY + was); storage()?.removeItem(OPENED_KEY + was) } catch { /* nothing kept */ }
    }
    useRecents.setState(load(now))
  })
}
