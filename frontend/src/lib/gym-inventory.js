// Equipment per gym (#808): the plates, dumbbells, bars and machine stacks of each equipment profile.
//
// An equipment profile ("Home", "Big gym", Settings → Equipment) has always said which kinds of kit
// a place has. Since 1.4.4 it also keeps that place's inventories, in the same shapes the settings
// had before (lib/plates.js, lib/dumbbells.js, lib/bar.js), as fields of the profile entry:
//
//   equipProfiles: [{ id, name, equipment, accV, plates, dumbbells, barDefaults, stackWeights, _ts, _f }]
//
// The top-level S.plates, S.dumbbells, S.barDefaults and S.stackWeights stay where they were and
// hold the ACTIVE gym's inventory: a working copy, mirrored both ways. That is the chosen path, for
// three reasons:
//   - every reader (set-row plate lines, rowLoad, dumbbell steps, warm-up ramps, progression and
//     %1RM rounding, drops, the watch's steps, the Coach's "owns no dumbbells") already reads them
//     from S and keeps doing so, so switching the gym switches all of it without touching them;
//   - an older app (1.4.3 and before) reads and edits those same fields and keeps working on the
//     gym that is active, while the other gyms' copies sit in profile fields it never touches
//     (its merge keeps an entry's unknown fields, and so does the server's, api/sync-stamps.js);
//   - the sync needs no new rule: the profile fields merge field by field like any other entry
//     field (sync-merge.js mergeEntry), the top-level ones as they always did.
//
// `S.invGym` names the profile the top-level copy belongs to. When it differs from
// `activeEquipId` (an older app switched the profile, which knows nothing of inventories), the
// copy is first given back to that profile and then the active one's is loaded. syncGymInventory
// runs on every change (useStore update) and settles the two copies:
//   - a profile without a field gets the top-level one (the migration: on update every existing
//     profile starts with exactly what you had, so nothing changes for anyone);
//   - a top-level field changed by this change goes into the active profile;
//   - otherwise (a sync brought a difference) the side edited last wins, per unit or per exercise
//     where the field carries its own `_ts`, for the bars by their edit stamps; a tie keeps the
//     top-level copy, which is what an older app edits.
// With no profile at all nothing here does anything: the top-level fields are the inventory.
import { t } from './i18n-core.js'
import { dropGrid } from './plates.js'
import { exConverted } from './ex-unit.js'
import { modeOf } from './history.js'

export const INV_KEYS = ['plates', 'dumbbells', 'barDefaults', 'stackWeights']
// The fields whose entries carry their own `_ts` (per unit, per exercise).
const STAMPED = new Set(['plates', 'dumbbells', 'stackWeights'])

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const list = v => (Array.isArray(v) ? v : [])
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const norm = v => (isMap(v) ? v : {})
const stampOf = v => (isMap(v) ? Number(v._ts) || 0 : 0)

/** The equipment profiles, each one a gym. */
export const gymsOf = S => list(S?.equipProfiles).filter(p => p && p.id != null)
/** The gym whose inventory is in use: the active equipment profile, filter on or off. */
export const activeGym = S => gymsOf(S).find(p => p.id === S?.activeEquipId) || null
export const gymLabel = p => (p && String(p.name || '').trim()) || t('My gym')

// What the top-level field holds, ready to compare (absent bars = the built-in ones = {}).
const topOf = (S, k) => norm(S[k])
function setTop(S, k, v) {
  // "Your bars" absent means the built-in bars (lib/bar.js); an empty map is written as absent.
  if (k === 'barDefaults' && !Object.keys(v).length) { delete S.barDefaults; return }
  S[k] = v
}

// The same inventory as edited `now`: every entry that carries a stamp gets this one. Loading a
// gym is a choice made now, and a stale stamp would let the other gym's copy win a sync with it.
function restamp(k, v, now) {
  if (!STAMPED.has(k)) return clone(v)
  const out = {}
  for (const [key, e] of Object.entries(v)) out[key] = isMap(e) && '_ts' in e ? { ...clone(e), _ts: now } : clone(e)
  return out
}

// Key by key, the entry edited last; a tie keeps the top-level one.
function newerByKey(top, prof) {
  const out = { ...clone(prof), ...clone(top) }
  for (const k of Object.keys(prof)) if (k in top && stampOf(prof[k]) > stampOf(top[k])) out[k] = clone(prof[k])
  return out
}

// Settles the top-level copy with profile `p` (mutates both). `prev` is the state before this change.
function settle(S, p, prev) {
  for (const k of INV_KEYS) {
    const top = topOf(S, k), own = norm(p[k])
    if (same(top, own)) continue
    if (prev && !same(norm(prev[k]), top)) { p[k] = clone(top); continue }
    if (STAMPED.has(k)) {
      const m = newerByKey(top, own)
      if (!same(m, own)) p[k] = m
      if (!same(m, top)) setTop(S, k, clone(m))
      continue
    }
    const ts = Number(S.edited?.[k]) || 0, ps = Number(p._f?.[k]) || 0
    if (ps > ts) setTop(S, k, clone(own))
    else p[k] = clone(top)
  }
}

function load(S, p, now) {
  for (const k of INV_KEYS) {
    const v = restamp(k, norm(p[k]), now)
    p[k] = v
    setTop(S, k, clone(v))
  }
}

// States already settled, so the next change can skip the work when it touched none of this.
const settled = new WeakSet()

/**
 * Keeps the top-level inventories and the gyms' copies in step (see the top of this file), and
 * records on a running session which gym it is done at. Mutates `S`, a draft whose untouched fields
 * may still be `prev`'s own objects: it never writes into those, it replaces them. Returns S.
 */
export function syncGymInventory(S, prev = null, now = Date.now()) {
  if (!S || typeof S !== 'object') return S
  const quiet = prev && settled.has(prev) && S.equipProfiles === prev.equipProfiles && S.activeEquipId === prev.activeEquipId &&
    S.invGym === prev.invGym && INV_KEYS.every(k => S[k] === prev[k])
  if (!quiet && gymsOf(S).length) {
    const before = S.equipProfiles
    const gyms = clone(list(before))
    const real = gyms.filter(p => p && p.id != null)
    // The migration copies the lists as they were before this change: one made in it (the first
    // edit after the update) is the active gym's alone, and settle hands it over below.
    const base = prev && typeof prev === 'object' ? prev : S
    for (const p of real) for (const k of INV_KEYS) if (!(k in p)) p[k] = clone(topOf(base, k))
    const A = real.find(p => p.id === S.activeEquipId) || null
    const owner = S.invGym != null ? real.find(p => p.id === S.invGym) || null : null
    if (A && S.invGym != null && S.invGym !== A.id) {
      if (owner) settle(S, owner, null)
      load(S, A, now)
      S.invGym = A.id
    } else if (A) {
      if (S.invGym !== A.id) S.invGym = A.id
      settle(S, A, prev)
    } else if (owner) {
      settle(S, owner, prev)
    }
    if (!same(gyms, before)) S.equipProfiles = gyms
  }
  tagSession(S)
  settled.add(S)
  return S
}

// A live session remembers the gym it is done at (`active.gym`), and so does the workout it is
// saved as (lib/finish-workout.js): its plate lines read that gym's plates when it is edited later.
// A past workout logged after the fact, or one being edited, keeps what it had.
function tagSession(S) {
  const a = S.active
  if (!isMap(a) || a.editingWorkoutId || a.backfill || 'gym' in a) return
  const g = activeGym(S)
  if (!g) return
  S.active = { ...a, gym: { id: g.id, name: gymLabel(g) } }
}

/**
 * Makes gym `id` the active one: the current copy goes back to the gym it came from, the new gym's
 * comes in. Mutates S (inside an update). False when there is no such gym or it is active already.
 */
export function switchGym(S, id, now = Date.now()) {
  const gyms = clone(list(S.equipProfiles))
  const to = gyms.find(p => p && p.id === id)
  if (!to) return false
  const fromId = S.invGym != null ? S.invGym : S.activeEquipId
  if (fromId === id && S.activeEquipId === id) return false
  const from = gyms.find(p => p && p.id === fromId)
  if (from) for (const k of INV_KEYS) { const top = topOf(S, k); if (!same(top, norm(from[k]))) from[k] = clone(top) }
  for (const k of INV_KEYS) if (!(k in to)) to[k] = clone(topOf(S, k))
  load(S, to, now)
  S.equipProfiles = gyms
  S.activeEquipId = id
  S.invGym = id
  if (isMap(S.active) && !S.active.editingWorkoutId && !S.active.backfill) S.active = { ...S.active, gym: { id: to.id, name: gymLabel(to) } }
  return true
}

/**
 * Copies one inventory (`kind`, one of INV_KEYS) of gym `fromId` into the active one, for "Copy
 * from Home gym". With `exId`, only that exercise's machine stack. Mutates S; false when there is
 * nothing to copy.
 */
export function copyInventory(S, fromId, kind, { exId = null, now = Date.now() } = {}) {
  const from = gymsOf(S).find(p => p.id === fromId)
  if (!from || !INV_KEYS.includes(kind)) return false
  if (exId != null) {
    const e = norm(from.stackWeights)[exId]
    const next = { ...topOf(S, 'stackWeights') }
    next[exId] = isMap(e) ? { ...clone(e), _ts: now } : { _ts: now }
    S.stackWeights = next
    return true
  }
  setTop(S, kind, restamp(kind, norm(from[kind]), now))
  return true
}

/**
 * S as gym `gymId` has it: its inventories in place of the active one's. For reading only (the
 * editor of a saved workout loads plates from the gym it was done at). S itself when that is the
 * active gym, or the gym is gone.
 */
export function gymView(S, gymId) {
  if (gymId == null || gymId === S?.activeEquipId) return S
  const g = gymsOf(S).find(p => p.id === gymId)
  if (!g) return S
  const out = { ...S }
  for (const k of INV_KEYS) if (k in g) out[k] = g[k]
  return out
}

/** Whether gym `id` holds a machine stack for exercise `exId` (for the stack editor's "Copy from"). */
export const gymHasStack = (S, id, exId) => {
  const e = norm(gymsOf(S).find(p => p.id === id)?.stackWeights)[exId]
  return isMap(e) && Array.isArray(e.weights) && e.weights.length > 0
}

const tidy = w => Math.round(w * 1000) / 1000
/**
 * After a switch mid-workout: every set not done yet moved onto what the new gym has, the heaviest
 * load at or under the planned one that its plates, dumbbells or the machine's stack make (the
 * drop-set grid, lib/plates.js dropGrid). Exercises that the inventory does not touch, sets already
 * done and exercises kept in a unit of their own stay as they are. Mutates S.active (a draft's);
 * returns how many sets moved.
 */
export function reRoundOpenSets(S) {
  const a = S?.active
  if (!isMap(a) || !Array.isArray(a.entries)) return 0
  let moved = 0
  const entries = a.entries.map(e => {
    if (!e || !Array.isArray(e.sets)) return e
    const cfg = { ...(e.target || {}), id: e.id }
    if (modeOf(cfg) !== 'reps' || exConverted(S, e.id)) return e
    const grid = dropGrid(S, cfg)
    if (typeof grid !== 'function') return e
    const snap = w => {
      const v = Number(w)
      if (!(v > 0)) return w
      const n = tidy(Number(grid(v)))
      return Number.isFinite(n) && n > 0 ? n : w
    }
    let touched = false
    const sets = e.sets.map(s => {
      if (!isMap(s)) return s
      if (s.sides && isMap(s.sides.L) && isMap(s.sides.R)) {
        if (s.sides.L.done || s.sides.R.done || s.done) return s
        const L = snap(s.sides.L.w), R = snap(s.sides.R.w), w = snap(s.w)
        if (L === s.sides.L.w && R === s.sides.R.w && w === s.w) return s
        touched = true; moved++
        return { ...s, w, sides: { ...s.sides, L: { ...s.sides.L, w: L }, R: { ...s.sides.R, w: R } } }
      }
      if (s.done === true) return s
      const w = snap(s.w)
      if (w === s.w) return s
      touched = true; moved++
      return { ...s, w }
    })
    return touched ? { ...e, sets } : e
  })
  if (moved) S.active = { ...a, entries }
  return moved
}

/** The gym a saved workout was done at, by name, or null (one from before 1.4.4, or no gyms). */
export const workoutGymName = w => (isMap(w?.gym) && String(w.gym.name || '').trim()) || null

/**
 * The state the workout screen loads plates from: a saved workout being edited reads the gym it was
 * done at, so its plate lines say what was on the bar there; a live session reads the active gym.
 */
export const sessionGymView = S => (S?.active?.editingWorkoutId && isMap(S.active.gym) ? gymView(S, S.active.gym.id) : S)
