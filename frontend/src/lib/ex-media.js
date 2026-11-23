// Your own photo, GIF or video on a built-in exercise (#259, #534, v1.4.5): the stock animation
// shows how the catalogue does it, yours shows how YOU do it on YOUR machine. Kept like the media
// of a custom exercise, one per exercise, and private: only your own devices ever see it.
//
//   S.exMedia = { '<exercise id>': { m: <MediaRef>, show: 'own' | 'stock', _ts }, … }
//
// One entry per exercise with the time it was last written, merged per key like day notes and
// day photos (lib/sync-merge.js STAMPED_MAPS, api/sync-stamps.js): two devices that each set one
// on a different exercise keep both. Taking one away writes a stamped empty entry (`{ _ts }`),
// never a deleted key, which would come straight back from the other device. `show` is which one
// the exercise shows by default: yours ('own', the default once you add one) or the animation
// ('stock'); the other is one tap away on the picture itself.
//
// The files: media-refs.js stateMediaRefs and api/media.js referencedHashes walk exMedia, so the
// sync uploads them to your own folder on your server, the backups carry them and the clean-ups
// leave them be. A server from before would sweep them, so a signed-in app offers it only where
// GET /api/config says `media.builtin`. Nothing here is ever offered to the community library
// (lib/shared-items.js lists custom exercises and workout photos only), nor written into a plan
// file (lib/plan-share.js), nor handed to API tokens (api/tokens.js).
import { normalizeMediaRef } from './media-refs.js'

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** Your media on one exercise: { m, show } or null (none, cleared or malformed). */
export function exMediaOf(S, id) {
  const e = isMap(S?.exMedia) ? S.exMedia[id] : null
  if (!isMap(e)) return null
  const m = normalizeMediaRef(e.m)
  if (!m || m.kind === 'audio') return null
  return { m, show: e.show === 'stock' ? 'stock' : 'own' }
}

/** Whether the server keeps this: none at all (local or a guest phone), or one that says so. */
export const serverTakesExMedia = (user, config) => !user || (!!config && !!config.media && config.media.builtin === true)

/** Sets your media on exercise `id` (shown by default). False for a ref that is not a picture or clip. */
export function setExMedia(state, id, ref, now = Date.now()) {
  const m = normalizeMediaRef(ref)
  if (!id || !m || m.kind === 'audio') return false
  const map = isMap(state.exMedia) ? state.exMedia : {}
  state.exMedia = { ...map, [id]: { m, show: 'own', _ts: now } }
  return true
}

/** Takes your media off exercise `id`, as a stamped empty entry so the removal syncs. */
export function clearExMedia(state, id, now = Date.now()) {
  const map = isMap(state.exMedia) ? state.exMedia : {}
  if (!map[id]) return false
  state.exMedia = { ...map, [id]: { _ts: now } }
  return true
}

/** Which one exercise `id` shows: 'own' or 'stock'. False when there is nothing of yours there. */
export function setExMediaShow(state, id, show, now = Date.now()) {
  const cur = exMediaOf(state, id)
  if (!cur) return false
  state.exMedia = { ...state.exMedia, [id]: { ...state.exMedia[id], m: cur.m, show: show === 'stock' ? 'stock' : 'own', _ts: now } }
  return true
}
