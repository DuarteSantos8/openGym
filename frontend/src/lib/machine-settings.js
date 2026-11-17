// An exercise's machine settings: short name/value pairs such as "Seat: 5" or "Leg position: M",
// shown as tags beside the exercise's muscle and equipment so the machine is set in seconds.
//
// They live in the exercise's standing note (S.exNotes), as its first line:
//
//     Seat: 5 · Leg position: M
//     and then whatever else the note says
//
// So nothing new syncs and every version of the app already carries them: an app that does not
// know this shows the line as part of the note. The first line is read as settings only when every
// part of it is "Name: value", parts split by " · "; any other note stays a plain note.

export const SETTINGS_MAX = 8
export const KEY_MAX = 24
export const VALUE_MAX = 16
const SEP = ' · '

// Offered as names to start from, in English; the sheet shows them translated and saves what it
// shows, so a German profile keeps "Sitz".
export const SUGGESTED_KEYS = ['Seat', 'Backrest', 'Leg position', 'Pad', 'Handles', 'Foot plate']

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
// No ":" in a name and no "·" anywhere: those two are what the line is read by.
const text = (v, max) => String(v == null ? '' : v).replace(/·/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const name = (v) => text(String(v == null ? '' : v).replace(/:/g, ' '), KEY_MAX)

/**
 * The pairs worth keeping, in order: both halves trimmed and cut to length, a pair missing either
 * half dropped, a name given twice kept once (its first place, its last value), at most
 * SETTINGS_MAX.
 */
export function cleanSettings(pairs) {
  const out = []
  const at = new Map()
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!p || typeof p !== 'object') continue
    const k = name(p.k), v = text(p.v, VALUE_MAX)
    if (!k || !v) continue
    const id = k.toLocaleLowerCase()
    if (at.has(id)) { out[at.get(id)] = { k: out[at.get(id)].k, v }; continue }
    if (out.length >= SETTINGS_MAX) continue
    at.set(id, out.length)
    out.push({ k, v })
  }
  return out
}

/** "Seat: 5", the way a tag and the note's first line show a pair. */
export const settingLabel = p => `${p.k}: ${p.v}`

/** The pairs as the note's first line; '' for none. */
export const settingsLine = pairs => cleanSettings(pairs).map(settingLabel).join(SEP)

/** A note's first line read as settings: the pairs, or null when it is not a settings line. */
function readLine(line) {
  const parts = String(line).split(SEP)
  if (parts.length > SETTINGS_MAX) return null
  const pairs = []
  for (const part of parts) {
    const i = part.indexOf(': ')
    if (i <= 0) return null
    const k = part.slice(0, i), v = part.slice(i + 2)
    if (k !== name(k) || v !== text(v, VALUE_MAX) || !v) return null
    pairs.push({ k, v })
  }
  const clean = cleanSettings(pairs)
  return clean.length === pairs.length ? clean : null
}

/** A standing note as { pairs, rest }: its settings line, and the note without it. */
export function splitNote(note) {
  const s = String(note == null ? '' : note)
  const nl = s.indexOf('\n')
  const first = nl < 0 ? s : s.slice(0, nl)
  const pairs = readLine(first.trim())
  if (!pairs) return { pairs: [], rest: s.trim() }
  return { pairs, rest: nl < 0 ? '' : s.slice(nl + 1).trim() }
}

/** The note put back together: the settings line, then the rest. */
export const joinNote = (pairs, rest) => [settingsLine(pairs), String(rest == null ? '' : rest).trim()].filter(Boolean).join('\n')

/** An exercise's settings, cleaned; [] when it has none. */
export function settingsFor(S, exId) {
  const n = isMap(S?.exNotes) ? S.exNotes[exId] : null
  return exId == null || typeof n !== 'string' ? [] : splitNote(n).pairs
}

/** An exercise's standing note without its settings line, '' for none. */
export function noteWithoutSettings(S, exId) {
  const n = isMap(S?.exNotes) ? S.exNotes[exId] : null
  return typeof n === 'string' ? splitNote(n).rest : ''
}

/** Room left for an exercise's note text under its settings line (newline included), at most `max`. */
export function noteRoom(S, exId, max) {
  const n = isMap(S?.exNotes) ? S.exNotes[exId] : null
  const line = typeof n === 'string' ? settingsLine(splitNote(n).pairs) : ''
  return Math.max(0, max - (line ? line.length + 1 : 0))
}

/** Whether `rest` as the note text fits under the exercise's settings line within `max`. */
export const noteFits = (S, exId, rest, max) => String(rest == null ? '' : rest).trim().length <= noteRoom(S, exId, max)

/**
 * The exNotes map with the exercise's settings replaced (a new object); the rest of its note is
 * kept whole, and no key is left when nothing remains. When the line and the note together would
 * not fit in `max`, nothing changes and the same map comes back: text is never cut silently.
 */
export function withSettings(notes, exId, pairs, max = Infinity) {
  const next = isMap(notes) ? { ...notes } : {}
  const joined = joinNote(pairs, splitNote(next[exId]).rest)
  if (joined.length > max) return notes
  if (joined) next[exId] = joined
  else delete next[exId]
  return next
}

/**
 * The exNotes map with the exercise's note (without its settings line) replaced; the settings
 * line is kept. When line and text together would not fit in `max`, nothing changes and the same
 * map comes back.
 */
export function withNoteText(notes, exId, rest, max = Infinity) {
  const next = isMap(notes) ? { ...notes } : {}
  const joined = joinNote(splitNote(next[exId]).pairs, rest)
  if (joined.length > max) return notes
  if (joined) next[exId] = joined
  else delete next[exId]
  return next
}

/**
 * Two exercises' standing notes as one, the target's first (a merge, lib/exercise-merge.js): one
 * settings line on top, then the text of both. The source's pairs come first and the target's
 * after them; a name both have keeps the target's value. The target's pairs are never dropped: the
 * source's other pairs fill what is left of SETTINGS_MAX, and any that do not fit are kept as a
 * line of text under the settings instead of being lost. Never cut: the caller checks the length
 * first (lib/exercise-merge.js mergeBlocked).
 */
export function mergeNotes(target, source) {
  const t = splitNote(target), s = splitNote(source)
  const have = new Set(t.pairs.map(p => p.k.toLocaleLowerCase()))
  const extra = s.pairs.filter(p => !have.has(p.k.toLocaleLowerCase()))
  const room = Math.max(0, SETTINGS_MAX - t.pairs.length)
  const pairs = [...extra.slice(0, room), ...t.pairs]
  const left = extra.slice(room).map(settingLabel).join(SEP)
  const text = [...new Set([t.rest, s.rest, left].filter(Boolean))].join('\n')
  return joinNote(pairs, text)
}

/**
 * Names already used on other exercises, most used first (ties by name), without the ones listed
 * in `except`: a gym's machines tend to share their dials.
 */
export function knownKeys(S, except = []) {
  const skip = new Set(except.map(k => String(k).toLocaleLowerCase()))
  const count = new Map()
  for (const n of Object.values(isMap(S?.exNotes) ? S.exNotes : {})) {
    if (typeof n !== 'string') continue
    for (const { k } of splitNote(n).pairs) {
      const id = k.toLocaleLowerCase()
      if (skip.has(id)) continue
      const c = count.get(id) || { k, n: 0 }
      c.n++
      count.set(id, c)
    }
  }
  return [...count.values()].sort((a, b) => b.n - a.n || a.k.localeCompare(b.k)).map(c => c.k)
}
