// Voice clips of one's own (Settings → Timer alerts → Voice, v1.4.5): a recording or a file per
// moment of the spoken cues (lib/voice-styles.js MOMENTS), played instead of that moment's line.
// A friend shouting "you can do it", your own "rest is over", anything you like.
//
// They are sounds of one's own (lib/user-sounds.js) in the same list, S.sounds, with the moment
// they are for in `voice`:   { id, name, m, voice: 'restOver' }
// So they are kept, synced and backed up exactly like those: the WAV in the device's media store,
// on the server that keeps sounds (api/media.js referencedHashes walks every entry of S.sounds),
// on every device of the account. They are not sounds for a slot (soundsOf leaves them out), and
// they are never offered to the community library (lib/shared-items.js lists soundsOf only): a
// recording of someone's voice stays with the account that made it.
//
// The same ingest as every sound of one's own (lib/sound-ingest.js: decoded, mono, trimmed,
// normalised, a 16-bit WAV), cut at CLIP_SEC, at most CLIPS_PER_MOMENT per moment, one picked at
// random each time.
import { normalizeMediaRef } from './media-refs.js'
import { MOMENTS } from './voice-styles.js'

export const CLIPS_PER_MOMENT = 3
export const CLIP_SEC = 10
const NAME_MAX = 40
const cleanName = n => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)

/** A moment's clips as they may be played: { id, name, m } with a usable audio ref. */
export function voiceClipsOf (S, moment) {
  if (!MOMENTS.includes(moment)) return []
  const out = []
  const seen = new Set()
  for (const e of Array.isArray(S?.sounds) ? S.sounds : []) {
    if (!e || typeof e !== 'object' || e.voice !== moment || typeof e.id !== 'string' || !e.id || seen.has(e.id)) continue
    const m = normalizeMediaRef(e.m)
    if (!m || m.kind !== 'audio') continue
    seen.add(e.id)
    out.push({ id: e.id, name: cleanName(e.name) || 'Clip', m })
    if (out.length >= CLIPS_PER_MOMENT) break
  }
  return out
}

/** Every voice clip of the profile, all moments. */
export const allVoiceClips = S => MOMENTS.flatMap(m => voiceClipsOf(S, m))

/** Adds a clip to a store draft; its id, or null when the moment has its CLIPS_PER_MOMENT already. */
export function addVoiceClip (s, moment, { name, m }, id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) {
  if (!MOMENTS.includes(moment) || voiceClipsOf(s, moment).length >= CLIPS_PER_MOMENT) return null
  s.sounds = [...(Array.isArray(s.sounds) ? s.sounds : []), { id, name: cleanName(name) || 'Clip', m, voice: moment }]
  return id
}

export function removeVoiceClip (s, id) {
  s.sounds = (Array.isArray(s.sounds) ? s.sounds : []).filter(e => !(e?.id === id && typeof e.voice === 'string'))
}

/** One of a moment's clips at random; null when it has none. */
export function pickClip (S, moment, rnd = Math.random) {
  const list = voiceClipsOf(S, moment)
  if (!list.length) return null
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))]
}
