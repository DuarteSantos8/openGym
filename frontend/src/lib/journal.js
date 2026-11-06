// The journal (Stats → More → Journal): every note the app keeps, in one feed.
//
// Notes live where they were written and stay there: a workout's own note on the workout, an
// exercise's note for the day on its entry, a set's on the set (lib/set-notes.js), the standing note
// in S.exNotes, a routine's tip on its slot (#1003), a day off's in S.dayNotes, a check-in's on the
// measurement entry, a sauna's on the recovery session. The journal only reads them back, so nothing
// is stored twice and an edit anywhere shows here at once. The two things it keeps itself:
//
//   S.journalFolders = { '<id>': { name, filter: { kinds, exId, from, to, q, media }, _ts }, … }
//     A folder is a saved filter, not a box: a note is never filed, it turns up in every folder
//     whose filter it matches. Cleared with a stamped empty entry, like every STAMPED_MAPS map.
//
//   S.gymNotes = { '<gymId>|<exId>': { text, _ts }, '<gymId>|*': { text, _ts }, … }
//     A note pinned at one gym (an equipment profile, lib/gym-inventory.js): "seat 4, pad 2" is only
//     true at the gym with that machine. With an exercise it shows on that exercise in the workout,
//     without one ('*') at the top of the workout, both only while that gym is the active one.
import { NOTE_MAX } from './history.js'
import { setNoteOf } from './set-notes.js'
import { dayNoteOf, DAY_NOTE_LABEL } from './day-notes.js'
import { recoverySessionsOf, RECOVERY_LABEL } from './recovery-sessions.js'
import { workoutMediaOf } from './media-refs.js'
import { gymsOf, activeGym } from './gym-inventory.js'

// In the order the filter offers them. Labels are English source strings.
export const NOTE_KINDS = ['workout', 'exercise', 'set', 'standing', 'tip', 'gym', 'body', 'day', 'recovery']
export const NOTE_KIND_LABEL = {
  workout: 'Workout notes', exercise: 'Exercise notes', set: 'Set notes', standing: 'Always-on notes',
  tip: 'Routine tips', gym: 'Gym pins', body: 'Check-in notes', day: 'Day notes', recovery: 'Recovery notes',
}
export const NOTE_KIND_ICON = {
  workout: 'note', exercise: 'dumbbell', set: 'list', standing: 'info', tip: 'lightbulb',
  gym: 'mapPin', body: 'ruler', day: 'calendar', recovery: 'sparkles',
}
// Kinds that are about one exercise, and so can be pinned at a gym for it.
export const EXERCISE_KINDS = new Set(['exercise', 'set', 'standing', 'tip', 'gym'])
export const FOLDERS_MAX = 30
export const ANY_EX = '*'

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const txt = v => (typeof v === 'string' ? v.trim() : '')
const dayOfTs = ts => {
  const n = Number(ts)
  if (!(n > 0)) return null
  const d = new Date(n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const wkey = w => (w?.id != null ? String(w.id) : `${w?.d}|${w?.start}`)

/**
 * Every note, newest first; notes without a day of their own (always-on, tips, gym pins) after the
 * dated ones. Each is { key, kind, text, d (or null), title?, exId?, wid?, gymId?, routineId?,
 * pinned?, media?, tag?, recKind? }. `key` is stable across renders, for React and for opening one.
 */
export function collectNotes(S) {
  const out = []
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    if (!w || !ISO.test(String(w.d || ''))) continue
    const wid = wkey(w)
    const media = workoutMediaOf(w, Infinity).length > 0
    const base = { d: w.d, wid, title: w.name || '', ...(media ? { media: true } : {}) }
    if (txt(w.note)) out.push({ key: 'w:' + wid, kind: 'workout', text: txt(w.note), ...base })
    ;(Array.isArray(w.entries) ? w.entries : []).forEach((en, ei) => {
      if (!en) return
      if (txt(en.note)) out.push({ key: `e:${wid}:${ei}`, kind: 'exercise', text: txt(en.note), exId: en.id, ...(en.notePin ? { pinned: true } : {}), ...base })
      ;(Array.isArray(en.sets) ? en.sets : []).forEach((s, si) => {
        const n = setNoteOf(s)
        if (n) out.push({ key: `s:${wid}:${ei}:${si}`, kind: 'set', text: n, exId: en.id, setNo: si + 1, ...base })
      })
    })
  }
  for (const m of Array.isArray(S?.measurements) ? S.measurements : []) {
    if (m && ISO.test(String(m.d || '')) && txt(m.note)) out.push({ key: 'm:' + m.d, kind: 'body', text: txt(m.note), d: m.d })
  }
  for (const d of Object.keys(isMap(S?.dayNotes) ? S.dayNotes : {})) {
    const n = dayNoteOf(S, d)
    if (n && n.text) out.push({ key: 'd:' + d, kind: 'day', text: n.text, d, ...(n.tag ? { tag: n.tag, title: DAY_NOTE_LABEL[n.tag] } : {}) })
  }
  for (const r of recoverySessionsOf(S)) {
    if (r.note) out.push({ key: 'r:' + r.id, kind: 'recovery', text: r.note, d: r.d, recKind: r.kind, title: RECOVERY_LABEL[r.kind], rid: r.id })
  }
  // Newest day first; within a day the order they were found in (a workout's notes stay together).
  const dated = out.map((n, i) => [n, i]).sort((a, b) => (a[0].d < b[0].d ? 1 : a[0].d > b[0].d ? -1 : a[1] - b[1])).map(([n]) => n)

  const undated = []
  for (const [exId, v] of Object.entries(isMap(S?.exNotes) ? S.exNotes : {})) {
    if (txt(v)) undated.push({ key: 'x:' + exId, kind: 'standing', text: txt(v), d: null, exId })
  }
  for (const r of Array.isArray(S?.routines) ? S.routines : []) {
    ;(Array.isArray(r?.ex) ? r.ex : []).forEach((slot, i) => {
      if (slot && txt(slot.note)) undated.push({ key: `t:${r.id}:${i}`, kind: 'tip', text: txt(slot.note), d: null, exId: slot.id, routineId: r.id, title: r.name || '' })
    })
  }
  const gyms = new Map(gymsOf(S).map(g => [String(g.id), g]))
  for (const [k, v] of Object.entries(isMap(S?.gymNotes) ? S.gymNotes : {})) {
    const p = readGymNoteKey(k)
    if (!p || !txt(v?.text) || !gyms.has(p.gymId)) continue
    undated.push({ key: 'g:' + k, kind: 'gym', text: txt(v.text), d: null, since: dayOfTs(v._ts), gymId: p.gymId, title: gyms.get(p.gymId).name || '', ...(p.exId !== ANY_EX ? { exId: p.exId } : {}) })
  }
  return [...dated, ...undated]
}

/** A clean filter: every field optional, junk dropped. */
export function normFilter(f) {
  const o = isMap(f) ? f : {}
  const kinds = Array.isArray(o.kinds) ? [...new Set(o.kinds.filter(k => NOTE_KINDS.includes(k)))] : []
  const out = {}
  if (kinds.length && kinds.length < NOTE_KINDS.length) out.kinds = kinds
  if (typeof o.exId === 'string' && o.exId) out.exId = o.exId.slice(0, 80)
  if (ISO.test(String(o.from || ''))) out.from = o.from
  if (ISO.test(String(o.to || ''))) out.to = o.to
  if (out.from && out.to && out.from > out.to) [out.from, out.to] = [out.to, out.from]
  const q = txt(o.q).slice(0, 80)
  if (q) out.q = q
  if (o.media === true) out.media = true
  return out
}

/** Whether the filter narrows anything at all. */
export const filterIsEmpty = f => Object.keys(normFilter(f)).length === 0

// Case and accent blind, so "presion" finds "presión".
const fold = s => String(s || '').toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * The notes `filter` lets through. A date range keeps only dated notes, since an always-on note has
 * no day to fall in. `nameOf(exId)` lets the text search find a note by its exercise's name too.
 */
export function filterNotes(notes, filter, nameOf = null) {
  const f = normFilter(filter)
  const kinds = f.kinds ? new Set(f.kinds) : null
  const q = f.q ? fold(f.q) : ''
  return notes.filter(n => {
    if (kinds && !kinds.has(n.kind)) return false
    if (f.exId && n.exId !== f.exId) return false
    if ((f.from || f.to) && !n.d) return false
    if (f.from && n.d < f.from) return false
    if (f.to && n.d > f.to) return false
    if (f.media && !n.media) return false
    if (q) {
      const hay = fold(n.text) + ' ' + fold(n.title) + (n.exId && nameOf ? ' ' + fold(nameOf(n.exId)) : '')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** How many notes each kind has, for the filter's chips. */
export function kindCounts(notes) {
  const out = {}
  for (const n of notes) out[n.kind] = (out[n.kind] || 0) + 1
  return out
}

/** The exercises that have a note, most noted first, for the filter's exercise picker. */
export function notedExercises(notes) {
  const n = new Map()
  for (const x of notes) if (x.exId) n.set(x.exId, (n.get(x.exId) || 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count }))
}

/** Days that hold a dated note in `month` ('YYYY-MM'), for the calendar strip's dots. */
export function noteDaysIn(notes, month) {
  const out = new Set()
  for (const n of notes) if (n.d && n.d.startsWith(month)) out.add(n.d)
  return out
}

/* ---------- folders: saved filters ---------- */

/** Every folder, alphabetical, as { id, name, filter }. */
export function foldersOf(S) {
  const map = isMap(S?.journalFolders) ? S.journalFolders : {}
  const out = []
  for (const [id, v] of Object.entries(map)) {
    const name = txt(v?.name).slice(0, 40)
    if (name) out.push({ id, name, filter: normFilter(v.filter) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** S.journalFolders with `id` set to { name, filter } (or cleared with null), stamped `now`. */
export function withFolder(map, id, folder, now = Date.now()) {
  const name = txt(folder?.name).slice(0, 40)
  const entry = folder && name ? { name, filter: normFilter(folder.filter), _ts: now } : { _ts: now }
  return { ...(isMap(map) ? map : {}), [id]: entry }
}

/* ---------- gym pins ---------- */

export const gymNoteKey = (gymId, exId = ANY_EX) => `${gymId}|${exId || ANY_EX}`
export function readGymNoteKey(k) {
  const i = String(k).indexOf('|')
  if (i <= 0 || i === k.length - 1) return null
  return { gymId: k.slice(0, i), exId: k.slice(i + 1) }
}

/** The note pinned for `exId` (or the whole workout, ANY_EX) at the active gym, or null. */
export function gymNoteFor(S, exId = ANY_EX) {
  const g = activeGym(S)
  if (!g) return null
  const v = isMap(S?.gymNotes) ? S.gymNotes[gymNoteKey(g.id, exId)] : null
  const text = txt(v?.text)
  return text ? { text, gym: g } : null
}

/** The text pinned for `exId` at `gymId`, '' for none. */
export const gymNoteText = (S, gymId, exId = ANY_EX) => txt((isMap(S?.gymNotes) ? S.gymNotes[gymNoteKey(gymId, exId)] : null)?.text)

/** S.gymNotes with the pin at `gymId` for `exId` set to `text` (blank clears it), stamped `now`. */
export function withGymNote(map, gymId, exId, text, now = Date.now()) {
  const clean = String(text ?? '').trim().slice(0, NOTE_MAX)
  return { ...(isMap(map) ? map : {}), [gymNoteKey(gymId, exId)]: clean ? { text: clean, _ts: now } : { _ts: now } }
}
