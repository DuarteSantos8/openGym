/* Sounds of one's own (Settings → Sound, v1.4.5): a few short clips a person added, each usable
 * for a sound slot instead of the built-in ones (lib/rest-sounds.js).
 *
 *   S.sounds = [{ id, name, m }]   m: a MediaRef of kind 'audio' (lib/sound-ingest.js wrote it)
 *   S.restSound                    the end of a rest: a built-in id, or 'u:<id>' for one's own
 *   S.holdSound                    the end of a timed hold: the same, absent = as the rest
 *
 * The files live like every other photo or video of the profile: in the device's media store,
 * and signed in on the server (api/media.js, which keeps state.sounds[].m), so every device of
 * the account gets them. An app from before does not know 'u:…' and plays the chime instead
 * (restSoundOf), so nothing breaks on an older phone.
 *
 * What the timer plays is a "tone": a built-in id, or 'u:<sha-256>' naming the file itself, which
 * the native sides find in the app's media folder (RestTone.java / RestTone.swift).
 */
import { normalizeMediaRef } from './media-refs.js'
import { restSoundOf, REST_SOUNDS } from './rest-sounds.js'

export const SOUNDS_MAX = 8
export const NAME_MAX = 40
export const SLOTS = ['rest', 'hold']
const SLOT_KEY = { rest: 'restSound', hold: 'holdSound' }
const TONE_RE = /^u:[0-9a-f]{64}$/

const cleanName = n => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)

/** The profile's own sounds as they may be used: each with a usable WAV ref, ids unique, at most SOUNDS_MAX. */
export function soundsOf (S) {
  const out = []
  const seen = new Set()
  for (const e of Array.isArray(S?.sounds) ? S.sounds : []) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || seen.has(e.id)) continue
    const m = normalizeMediaRef(e.m)
    if (!m || m.kind !== 'audio') continue
    seen.add(e.id)
    out.push({ id: e.id, name: cleanName(e.name) || 'Sound', m })
    if (out.length >= SOUNDS_MAX) break
  }
  return out
}

/** A file name as a sound's name: no extension, underscores and dashes as spaces. */
export const nameFromFile = name => cleanName(String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_-]+/g, ' ')) || 'Sound'

/** Adds a sound to a store draft; returns its id, or null when the list is full. */
export function addSound (s, { name, m }, id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) {
  const list = Array.isArray(s.sounds) ? s.sounds : []
  if (soundsOf(s).length >= SOUNDS_MAX) return null
  s.sounds = [...list, { id, name: cleanName(name) || 'Sound', m }]
  return id
}

/** Takes a sound out of a store draft; a slot that used it goes back to the chime. */
export function removeSound (s, id) {
  s.sounds = (Array.isArray(s.sounds) ? s.sounds : []).filter(e => e?.id !== id)
  for (const k of Object.values(SLOT_KEY)) if (s[k] === 'u:' + id) s[k] = k === 'restSound' ? 'chime' : undefined
  if (s.holdSound === undefined) delete s.holdSound
}

export function renameSound (s, id, name) {
  const n = cleanName(name)
  if (!n) return
  s.sounds = (Array.isArray(s.sounds) ? s.sounds : []).map(e => (e?.id === id ? { ...e, name: n } : e))
}

/** What a slot is set to: a built-in id or 'u:<id>' (a hold without its own follows the rest). */
export function slotChoice (S, slot = 'rest') {
  const raw = S?.[SLOT_KEY[slot] || 'restSound']
  if (typeof raw === 'string' && raw.startsWith('u:') && soundsOf(S).some(e => 'u:' + e.id === raw)) return raw
  if (slot === 'hold' && (raw == null || raw === '')) return slotChoice(S, 'rest')
  if (slot === 'hold' && Object.hasOwn(REST_SOUNDS, raw)) return raw
  return restSoundOf(S)
}

/** Sets a slot on a store draft: a built-in id or 'u:<id>'. The rest keeps the old classic switch right. */
export function setSlot (s, slot, value) {
  if (slot === 'hold') { s.holdSound = value; return }
  s.restSound = value
  s.classicChime = value === 'classic'
}

/** The sound of one's own a slot plays, or null for a built-in one. */
export function slotSound (S, slot = 'rest') {
  const c = slotChoice(S, slot)
  return c.startsWith('u:') ? soundsOf(S).find(e => 'u:' + e.id === c) || null : null
}

/** What the timer plays for a slot: a built-in id, or 'u:<sha-256>' for one's own. */
export function toneFor (S, slot = 'rest') {
  const own = slotSound(S, slot)
  return own ? 'u:' + own.m.hash : slotChoice(S, slot)
}

export const isUserTone = tone => typeof tone === 'string' && TONE_RE.test(tone)
