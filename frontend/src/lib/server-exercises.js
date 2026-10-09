// Shared definitions are cached alongside custom exercises so existing routines, history
// and sessions retain their metadata offline. The server catalogue is authoritative:
// a profile upload never publishes an exercise or grants permission to edit the catalogue.
import { api, apiUpload } from './api.js'
import { mediaStore } from './media-store.js'
import { mediaOf } from './media-refs.js'
import { fetchToStore } from './media-sync.js'
import { MOBILE } from './mobile.js'
import { isCustomEx } from './exercises.js'

let request = 0
let started = false

export const canEditExercise = (exercise, user) => isCustomEx(exercise) && (!exercise.serverShared || !!user?.admin)

export function exerciseAccountGuard(store) {
  const initial = store.getState(), owner = initial.user?.id, server = initial.sync?.server
  return () => {
    const current = store.getState()
    if (current.user?.id !== owner || current.sync?.server !== server) throw new Error('Account changed')
  }
}

const privateExercise = exercise => {
  const { serverShared, serverRetired, serverRevision, publisherId, ...copy } = exercise
  return copy
}
export { privateExercise }

function usedIds(S) {
  return new Set([...(S.routines || []).flatMap(r => (r.ex || []).map(e => e.id)),
    ...(S.workouts || []).flatMap(w => (w.entries || []).map(e => e.id)),
    ...(S.active?.entries || []).map(e => e.id), ...(S.favEx || [])])
}

export function mergeServerExercises(S, catalogue) {
  const published = new Map(catalogue.map(e => [e.id, e]))
  const used = usedIds(S)
  const next = []
  for (const existing of S.customEx || []) {
    if (published.has(existing.id)) {
      next.push({ ...published.get(existing.id), _ts: existing._ts })
      published.delete(existing.id)
    } else if (existing.serverShared) {
      // Retired definitions remain resolvable for plans and logs, but leave the picker.
      if (used.has(existing.id)) next.push({ ...existing, serverRetired: true })
    } else next.push(existing)
  }
  next.push(...published.values())
  return next
}

export async function refreshServerExercises(store) {
  const state = store.getState()
  if (!state.user || !state.ready) return
  const owner = state.user.id, server = state.sync?.server
  const token = ++request
  try {
    const { exercises } = await api('/api/shared-exercises')
    const current = store.getState()
    if (token !== request || current.user?.id !== owner || current.sync?.server !== server) return
    if (!Array.isArray(exercises)) return
    const valid = exercises.filter(e => e?.serverShared === true && typeof e.id === 'string' &&
      /^c[a-zA-Z0-9_-]{1,95}$/.test(e.id) && typeof e.n === 'string' && e.custom === true)
    const next = mergeServerExercises(current.S, valid)
    if (JSON.stringify(next) !== JSON.stringify(current.S.customEx || [])) {
      current.update(s => { s.customEx = next }, true, { stampExercises: false })
    }
  } catch (e) {
    // Older servers do not have this optional catalogue. Offline keeps the last copy.
    if (e.status !== 404 && e.status !== 401) console.debug('Server exercise catalogue unavailable', e.code || e.status || 'offline')
  }
}

async function ensureExerciseMedia(exercise, privateOnly, guard = () => {}) {
  guard()
  const media = mediaOf(exercise)
  const files = media ? [...(media.poster ? [media.poster] : []), media] : []
  if (files.length) {
    const { missing = [] } = await api('/api/media/missing', { method: 'POST', body: JSON.stringify({ hashes: files.map(f => f.hash), privateOnly }) })
    for (const ref of files) {
      guard()
      if (!missing.includes(ref.hash)) continue
      let blob = (await mediaStore.get(ref.hash))?.blob
      if (!blob) { await fetchToStore(ref.hash, ref, { force: true }); blob = (await mediaStore.get(ref.hash))?.blob }
      if (!blob) throw new Error('The exercise media is not available on this device.')
      guard()
      await apiUpload(`/api/media/${ref.hash}`, blob, ref.mime)
      await mediaStore.markSynced(ref.hash)
    }
  }
  guard()
}

export async function publishServerExercise(exercise, guard = () => {}) {
  ++request
  await ensureExerciseMedia(exercise, false, guard)
  guard()
  const { exercise: published } = await api('/api/admin/shared-exercises', { method: 'PUT',
    body: JSON.stringify({ exercise, baseRevision: exercise.serverRetired ? undefined : exercise.serverRevision }) })
  ++request
  return published
}

export async function unpublishServerExercise(exercise, { keepPrivate = true, guard = () => {} } = {}) {
  ++request
  if (keepPrivate) await ensureExerciseMedia(exercise, true, guard)
  guard()
  await api('/api/admin/shared-exercises', { method: 'DELETE',
    body: JSON.stringify({ id: exercise.id, baseRevision: exercise.serverRevision }) })
  ++request
}

export function startServerExercises(store) {
  if (started) return
  started = true
  const refresh = () => refreshServerExercises(store)
  store.subscribe((next, previous) => {
    if (next.user?.id !== previous.user?.id || next.sync?.server !== previous.sync?.server) ++request
    if ((next.ready && !previous.ready) || next.user !== previous.user || next.sync?.server !== previous.sync?.server) refresh()
  })
  setInterval(() => { if (!document.hidden) refresh() }, 30000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh() })
  if (MOBILE) import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) refresh()
  })).catch(() => {})
  refresh()
}
