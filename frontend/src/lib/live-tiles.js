// What each tile of the live workout widget says right now (lib/live-layout.js has which tiles
// there are), worked out once here for every surface: the workout screen's card, the Lock Screen
// and Dynamic Island, Android's notification and the Home Screen widget. Plain text, finite and
// short (clip), so nothing a platform draws can be handed a NaN or a page of notes.
//
// Set tiles (the weight, the reps, the band...) are about one set, so the Lock Screen can carry
// them with each set it may move on to; the session's (heart rate, volume, the gym) are about
// now. A tile with nothing to say is left out (no heart rate without a source, no band on a set
// without one) and the surface simply does not draw it.
import { stripBidi } from './bidi.js'
import { EXIDX } from './exercises.js'
import { t } from './i18n.js'
import { exerciseNameText, fmtNum, fmtVol } from './format.js'
import { setLabel, supersetUnits, modeOf, isBw, EFFORT, effortOf, sessionVolume, exNoteFor } from './history.js'
import { viewRow, exUnitTag, exUnitOf } from './ex-unit.js'
import { isWarmupRow } from './workout-model.js'
import { speedUnitOf, fmtSpeed } from './speed.js'
import { distUnitOf, fmtDist } from './distance.js'
import { hasIncline, hasLevel } from './incline.js'
import { activeGym, gymLabel, gymsOf } from './gym-inventory.js'
import { sanitizeHr } from './heart-rate.js'
import { bodyKgFor, MET } from './active-energy.js'
import { TILES } from './live-layout.js'
import { recordBaseline, recordHint, recordHintText, recordHintsOn } from './set-records.js'
import { sessionHistory } from './backfill.js'
import { entryDbLoad } from './dumbbells.js'
import { formulaOf } from './onerm.js'
import { setBandsOf, bandText, bandsOf } from './bands.js'

export const TEXT_MAX = 40
export const NOTE_MAX = 60

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const numish = v => num(typeof v === 'string' && v.trim() !== '' ? Number(v) : v)

/** `s` as one line of at most `max` characters (whole letters, never half an emoji), or ''. */
export function clip (s, max = TEXT_MAX) {
  if (s == null) return ''
  const one = String(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(one)
  return chars.length <= max ? one : chars.slice(0, Math.max(1, max - 1)).join('').trimEnd() + '…'
}

const exName = e => (EXIDX[e.id] ? exerciseNameText(EXIDX[e.id]) : String(e?.target?.name || e?.name || e?.id || ''))

// The set's bands by name ("Red + Yellow", lib/bands.js), or the plan's when the set has none.
function bandsText (S, s, cfg) {
  const ids = setBandsOf(s).length ? setBandsOf(s) : setBandsOf({ bands: cfg?.bands })
  return ids.length ? bandText(ids, bandsOf(S)) : ''
}

/**
 * The heart rate to show: the phone's own live reading (headphones that measure it, through the
 * iPhone's workout session) while it is fresh, else the last set the watch measured. `{ bpm, src }`
 * with src 'live' or 'watch', or null.
 */
export function heartNow (A, live = null) {
  const bpm = Math.round(Number(live?.bpm))
  if (bpm >= 25 && bpm <= 250) return { bpm, src: 'live' }
  let best = null
  for (const e of A?.entries || []) {
    for (const s of e?.sets || []) {
      const hr = s?.done ? sanitizeHr(s.hr) : null
      const at = num(s?.at) || 0
      if (hr && (!best || at >= best.at)) best = { bpm: hr.avg, at, src: 'watch' }
    }
  }
  return best ? { bpm: best.bpm, src: best.src } : null
}

/** Heart-rate zone 1 to 5 by share of the age-predicted maximum (Tanaka), or null without a birth year. */
export function hrZone (bpm, S, now = Date.now()) {
  const year = Math.round(Number(S?.birthYear))
  const age = new Date(now).getFullYear() - year
  if (!(bpm > 0) || !(age >= 10 && age <= 100)) return null
  const max = 208 - 0.7 * age
  const p = bpm / max
  return p >= 0.9 ? 5 : p >= 0.8 ? 4 : p >= 0.7 ? 3 : p >= 0.6 ? 2 : p >= 0.5 ? 1 : null
}

/** A rough running kcal for the session so far (strength training's MET for the time gone). */
export function kcalSoFar (S, A, now = Date.now()) {
  const start = num(A?.start)
  if (!start || now <= start) return null
  const hours = Math.min(3, (now - start - (num(A?.pausedMs) || 0)) / 3600e3)
  const met = num(MET?.strength_training) || 5
  const kg = bodyKgFor(S, A)
  const v = Math.round((met - 1) * kg * Math.max(0, hours))
  return v > 0 ? v : null
}

/** The superset partner(s) of entry `idx`: the others in its unit, by name. */
function partnerOf (A, idx) {
  const unit = supersetUnits(A.entries).find(u => u.includes(idx))
  return unit && unit.length > 1 ? unit.filter(i => i !== idx).map(i => exName(A.entries[i])).join(' + ') : ''
}

/** The exercise after the one of `idx`, by name ('' when it is the last). */
function nextNameOf (A, idx) {
  const units = supersetUnits(A.entries)
  const at = units.findIndex(u => u.includes(idx))
  for (let k = at + 1; k < units.length; k++) {
    const u = units[k]
    if (u.some(i => (A.entries[i]?.sets || []).some(s => !s?.done))) return u.map(i => exName(A.entries[i])).join(' + ')
  }
  return ''
}

/** The workout screen's quiet record line for a planned set ("2 more reps for a record"), or ''. */
export function recordLine (S, e, s) {
  if (!recordHintsOn(S) || !s || s.done || isWarmupRow(s)) return ''
  const cfg = { ...(e.target || {}), id: e.id }
  if (modeOf(cfg) !== 'reps') return ''
  const f = formulaOf(S)
  const base = recordBaseline(sessionHistory(S), e.id, { as: entryDbLoad(e), formula: f })
  const row = s.sides ? (!s.sides.L?.done ? s.sides.L : s.sides.R) : s
  return recordHintText(recordHint({ w: row?.w, r: row?.r }, base, f)) || ''
}

/** The effort label for `v` on the profile's scale: "RIR 2", "RPE 8". */
export function effortText (S, v) {
  const kind = effortOf(S)
  const scale = EFFORT[kind] ? kind : 'rir'
  return num(v) == null ? EFFORT[scale].hd + ' –' : `${EFFORT[scale].hd} ${fmtNum(v)}`
}

/**
 * The set tiles for set `setIdx` of entry `entryIdx`, only `keys` asked for: `{ k: text }`, with
 * the ones that have nothing to say left out. `opts.hint` the record hint text for this set.
 */
export function setValues (S, A, entryIdx, setIdx, keys, opts = {}) {
  const e = A?.entries?.[entryIdx]
  const s = e?.sets?.[setIdx]
  const out = {}
  if (!e || !s || !Array.isArray(keys)) return out
  const cfg = { ...(e.target || {}), id: e.id }
  let mode = 'reps'
  try { mode = modeOf(cfg) } catch { mode = 'reps' }
  const row = (() => { try { return viewRow(S, e.id, s) } catch { return s } })()
  const work = (e.sets || []).filter(x => !isWarmupRow(x))
  const warm = !!isWarmupRow(s)
  const put = (k, v) => { const c = clip(v, k === 'notes' ? NOTE_MAX : TEXT_MAX); if (c) out[k] = c }
  for (const k of keys) {
    if (!TILES[k]?.set) continue
    try {
      switch (k) {
        case 'ex': put(k, exName(e)); break
        case 'setOf': put(k, warm ? t('Warm-up') + ' ' + ((e.sets || []).filter(isWarmupRow).indexOf(s) + 1) : t('Set {0} of {1}', work.indexOf(s) + 1, work.length)); break
        case 'target': put(k, stripBidi(setLabel(e.id, row, cfg, speedUnitOf(S))) + exUnitTag(S, e.id)); break
        case 'weight': {
          if (mode !== 'reps') break
          const w = numish(row.w)
          if (isBw(cfg)) put(k, w > 0 ? `+${fmtNum(w)} ${exUnitOf(S, e.id)}` : t('Body weight'))
          else if (w != null) put(k, `${fmtNum(w)} ${exUnitOf(S, e.id)}`)
          break
        }
        case 'reps': { const r = numish(row.r); if (mode === 'reps' && r != null) put(k, fmtNum(Math.round(r))); break }
        case 'effort': if (mode !== 'cardio' && effortOf(S) !== 'none') put(k, effortText(S, s.rir ?? s.rpe ?? null)); break
        case 'warm': put(k, warm ? t('Warm-up') : t('Work set')); break
        case 'time': {
          if (mode === 'time') { const sec = numish(row.sec) ?? numish(cfg.sec); if (sec != null) put(k, `${Math.round(sec)} s`) }
          else if (mode === 'cardio') { const m = numish(row.min) ?? numish(cfg.min); if (m != null) put(k, `${fmtNum(m)} min`) }
          break
        }
        case 'dist': { const km = numish(row.km); if (km > 0) put(k, fmtDist(km, distUnitOf(S))); break }
        case 'speed': { const v = numish(row.speed); if (mode === 'cardio' && v > 0) put(k, fmtSpeed(v, speedUnitOf(S))); break }
        case 'incline': if (hasIncline(row)) put(k, `${fmtNum(Number(row.incline))}%`); break
        case 'level': if (hasLevel(row)) put(k, t('Level {0}', fmtNum(Number(row.level)))); break
        case 'band': put(k, bandsText(S, s, cfg)); break
        case 'equip': { const eq = EXIDX[e.id]?.eq; if (eq) put(k, t(eq)); break }
        case 'partner': put(k, partnerOf(A, entryIdx)); break
        case 'notes': put(k, s.note || e.note || exNoteFor(S, e.id) || ''); break
        case 'pr': put(k, opts.hint ?? recordLine(S, e, s)); break
        case 'next': put(k, nextNameOf(A, entryIdx)); break
        default: break
      }
    } catch { /* one tile that cannot be worked out is left out, never the whole card */ }
  }
  return out
}

/**
 * The session tiles of `keys`: `{ k: text }`. `ctx` { live (the phone's heart rate), now }.
 * Native ones (the rest, the clock, the time since start, the bar) are drawn by the surface.
 */
export function sessionValues (S, A, keys, ctx = {}) {
  const out = {}
  if (!A || !Array.isArray(keys)) return out
  const now = num(ctx.now) || Date.now()
  const put = (k, v) => { const c = clip(v); if (c) out[k] = c }
  let hr
  const heart = () => (hr === undefined ? (hr = heartNow(A, ctx.live)) : hr)
  for (const k of keys) {
    try {
      switch (k) {
        case 'sets': {
          let done = 0, total = 0
          for (const e of A.entries || []) for (const s of e?.sets || []) { total++; if (s?.done) done++ }
          put(k, `${done}/${total}`)
          break
        }
        case 'volume': { const v = num(sessionVolume(A, S)); if (v > 0) put(k, stripBidi(fmtVol(Math.round(v), S?.unit === 'lb' ? 'lb' : 'kg'))); break }
        case 'hr': { const h = heart(); if (h) put(k, t('{0} bpm', h.bpm)); break }
        case 'hrZone': { const h = heart(); const z = h && hrZone(h.bpm, S, now); if (z) put(k, t('Zone {0}', z)); break }
        case 'kcal': { const v = kcalSoFar(S, A, now); if (v) put(k, `${v} kcal`); break }
        case 'gym': { if (gymsOf(S).length) put(k, gymLabel(activeGym(S))); break }
        case 'workout': put(k, A.name || ''); break
        default: break
      }
    } catch { /* as above */ }
  }
  return out
}

/** The heart rate's source for its icon ('live' headphones or phone, 'watch'), or null. */
export const heartSource = (A, live) => heartNow(A, live)?.src || null
