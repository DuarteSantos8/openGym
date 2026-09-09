// The AI Coach, on the client side: everything that decides what a proposal *does* to a plan.
//
// The server produces proposals; it never writes into your state. Applying one is ordinary
// local editing — snapshot, mutate the draft, log — which is what makes it work offline, sync
// like every other change, and stay reversible without the server knowing anything about it.
//
// Every function here is pure over a draft state `s` (call them inside store.update), so the
// interesting parts are testable without a browser, a server or an AI account. That matters
// more here than elsewhere in the app: this is the code that edits a plan on the strength of
// something a language model said, and "it looked right on my phone" is not a standard.
//
// The screens that call it arrive in PR 4. Nothing in this file needs one to be tested, which
// is the point of it being separate from them.

import { EXIDX } from './exercises.js'
import { modeOf, isBw, isPerSide, cleanupSg } from './history.js'
import { uid, todayISO, DAYN } from './format.js'
import { mergePlan } from './plan-share.js'
import { POLICIES } from './progression.js'
import { t } from './i18n.js'

// Bumping this re-prompts everyone: it means what we share, or who we share it with, changed.
export const CONSENT_VERSION = 1

// Bounds. The whole state has to stay inside the server's 5 MB body limit, and a Coach log
// that grows forever is exactly the kind of thing that eats it invisibly. Worst case here is
// ~75 KB; the namespace guard is the backstop for the case nobody predicted.
export const SNAPSHOT_MAX = 3
export const LOG_MAX = 50
export const CHAT_MAX = 40
export const TIMINGS_MAX = 5
const NAMESPACE_MAX = 256 * 1024

export const emptyCoach = () => ({
  consent: null, profile: null, cadence: 'off', lastReview: null, log: [], snapshots: [],
  // The conversation as the user saw it (views/CoachChat.jsx): their messages, and what the
  // Coach did with them. Short, synced, and trimmed with the log — the proposal itself lives
  // server-side (or in the phone's device file) until it is applied or dismissed.
  chat: [],
  // How long the last few jobs took, so the typing bubble can say "usually about 2 minutes".
  timings: []
})
const coachOf = s => (s.coach = s.coach || emptyCoach())

/* ============================ gating ============================ */

// One predicate, one place. Every Coach entry point in the UI is behind it, which is what
// makes "an instance with no provider is byte-identical to before" a claim worth testing.
//
// The demo build is the one exception, and it is deliberate: it has no backend and no
// account, but it does have a canned provider, and hiding the app's most interesting feature
// from the page people are sent to look at it on would be a strange choice.
//
// The mobile build has two ways in, both chosen in Settings (views/CoachSetup.jsx): a phone
// paired to a self-hosted server is an ordinary signed-in profile and takes the web rule; a
// phone that brought its own API key runs the Coach itself (lib/coach-local.js). Nothing
// chosen means nothing shown — the same "invisible unless configured" promise the web keeps.
export const coachAvailable = (config, user, { demo, mobile, coachMode } = {}) =>
  mobile ? (coachMode === 'byok' || !!(config?.coach?.enabled && user))
    : demo ? true : !!(config?.coach?.enabled && user)

// What each data category means, in the user's words. Rendered from the same list the payload
// builder uses (api/coach/core/categories.js), so the screen cannot promise less than leaves.
export const CATEGORY_TEXT = {
  plan: ['Your plan', 'Routines, exercises, sets and reps, your weekly schedule and progression settings.'],
  training: ['Your logged training', 'Sets you logged in the review window — weights, reps, times, effort ratings and how long sessions took.'],
  bodyweight: ['Body weight', 'Weigh-ins from the same window, and your goal weight if you set one.'],
  profile: ['What you tell the Coach', 'Your intake answers, including any limitations or injuries you describe.'],
  prefs: ['A few preferences', 'Your unit, your language and which effort scale you log.']
}
export const hasConsent = S => !!S?.coach?.consent?.agreedAt && S.coach.consent.version === CONSENT_VERSION

/* ============================ plan fingerprint ============================ */

/**
 * Mirror of `canonicalPlan` in api/coach/payload.js — field for field, including the rule
 * that every absent value is written out as a zero so "no weight" and "0 kg" cannot hash
 * apart, and that `bodyweight`/`side` are *resolved* against the catalogue rather than copied,
 * so a plan that says nothing and an exercise the dataset already calls bodyweight hash the
 * same. If you change one, change both; coach.test.js checks them against shared fixtures.
 */
export function canonicalPlan(S) {
  return {
    routines: (S.routines || []).map(r => ({
      id: r.id, name: r.name || '', prog: r.prog || '',
      ex: (r.ex || []).map(e => {
        const mode = modeOf(e)
        return {
          id: e.id, mode, sets: e.sets || 0,
          reps: mode === 'reps' ? (e.reps || 0) : 0,
          sec: mode === 'time' ? (e.sec || 0) : 0,
          min: mode === 'cardio' ? (e.min || 0) : 0,
          speed: mode === 'cardio' ? (e.speed || 0) : 0,
          weight: mode === 'cardio' ? 0 : (e.weight || 0),
          prog: e.prog || '', inc: e.inc || 0, repsMin: e.repsMin || 0, repsMax: e.repsMax || 0,
          bodyweight: isBw(e), side: isPerSide(e),
          sg: e.sg || ''
        }
      })
    })),
    // A weekday holds a routine-id list now. `[].concat` folds a legacy bare string and a
    // one-element list to the same shape, so their fingerprint is identical — no false-stale
    // storm on the first load after the upgrade. `?.length` keeps a stray `[]` out. Insertion
    // order is preserved and never sorted (it is the merge order).
    week: Object.fromEntries([1, 2, 3, 4, 5, 6, 0].filter(d => S.week?.[d]?.length).map(d => [d, [].concat(S.week[d])]))
  }
}

/** FNV-1a-ish 64-bit fingerprint. Mirror of hashPlan in api/coach/core/plan-hash.js. */
export function hashPlan(plan) {
  const canon = JSON.stringify({
    routines: (plan?.routines || []).map(r => [r.id, r.name, r.prog, (r.ex || []).map(e =>
      [e.id, e.mode, e.sets, e.reps, e.sec, e.min, e.speed, e.weight, e.prog, e.inc,
        e.repsMin, e.repsMax, e.bodyweight, e.side, e.sg].join(':')
    )]),
    // `plan` is a canonicalPlan output, so each day is already an array. `{1:['r1']}` → "1=r1",
    // byte-identical to the pre-upgrade fingerprint; `{3:['r2','r3']}` → "3=r2+r3". Weekday
    // keys still sorted; the routine list within a day never is.
    week: Object.keys(plan?.week || {}).sort().map(k => k + '=' + [].concat(plan.week[k]).join('+'))
  })
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < canon.length; i++) {
    const c = canon.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ ((c << 3) | i & 7), 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}
export const planHash = S => hashPlan(canonicalPlan(S))

/* ============================ staleness ============================ */

const findRoutine = (S, id) => (S.routines || []).find(r => r.id === id) || null
const findEx = (routine, id) => (routine?.ex || []).find(e => e.id === id) || null

/** The plan's current value for whatever a change is about — what `before` is checked against. */
export function currentValue(S, change) {
  const r = findRoutine(S, change.target?.routineId)
  const e = change.target?.exId ? findEx(r, change.target.exId) : null
  switch (change.type) {
    case 'sets': return e?.sets ?? null
    case 'reps': return e?.reps ?? null
    case 'repsMin': return e?.repsMin ?? null
    case 'repsMax': return e?.repsMax ?? null
    case 'sec': return e?.sec ?? null
    case 'inc': return e?.inc ?? null
    case 'exercise-prog': return e?.prog ?? null
    case 'routine-prog': return r?.prog ?? null
    case 'rename-routine': return r?.name ?? null
    case 'week': return [].concat(S.week?.[change.target?.weekday] ?? [])   // routine-id list; [] = rest
    default: return undefined            // structural changes have no single scalar to compare
  }
}

/**
 * Mark what can no longer be applied. Two independent checks, because they fail differently:
 * the whole proposal is stale when the plan has moved since it was computed, and an individual
 * change is stale when the thing it names is gone or has already been changed by hand.
 *
 * A stale change is disabled, never silently skipped — someone who edited their plan on
 * another device should be told why the suggestion is greyed out.
 */
export function markStale(proposal, S) {
  if (!proposal) return proposal
  const planMoved = !!proposal.planHash && proposal.planHash !== planHash(S)
  const changes = (proposal.changes || []).map(c => {
    const r = c.target?.routineId ? findRoutine(S, c.target.routineId) : null
    let stale = false
    if (c.type !== 'add-routine' && c.type !== 'week' && !r) stale = true
    else if (c.target?.exId && !findEx(r, c.target.exId)) stale = true
    else if (c.type === 'week') {
      // The day's value is a routine-id list; `before` may be a list (a combined day) or a
      // legacy bare string. Compare by canonical join so order matters but shape does not.
      const join = v => [].concat(v ?? []).join('+')
      if (c.before != null && join(currentValue(S, c)) !== join(c.before)) stale = true
    }
    else {
      const cur = currentValue(S, c)
      // `before` is what the Coach saw. If the live plan disagrees, someone has already
      // changed it — applying would silently overwrite their edit with a stale premise.
      if (cur !== undefined && c.before != null && cur !== c.before && cur !== null) stale = true
    }
    return { ...c, status: stale ? 'stale' : (c.status === 'stale' ? 'proposed' : c.status || 'proposed') }
  })
  return { ...proposal, planMoved, changes }
}
export const applicable = proposal => (proposal?.changes || []).filter(c => c.status !== 'stale')

/* ============================ validation ============================ */

/** Client-side mirror of the server's gate — the plan must survive a bad day at either end. */
export function validateProposal(p) {
  if (!p || typeof p !== 'object') throw new Error(t('That proposal can’t be read.'))
  if (p.bundle) {
    if (!Array.isArray(p.bundle.routines) || !p.bundle.routines.length) throw new Error(t('That proposal can’t be read.'))
    // The server rejects a routine with no exercises; so must this, or an empty one is appended,
    // gets scheduled, and "start today's session" opens a workout with nothing in it.
    for (const r of p.bundle.routines) {
      if (!Array.isArray(r.ex) || !r.ex.length) throw new Error(t('That proposal can’t be read.'))
    }
    return true
  }
  if (!Array.isArray(p.changes)) throw new Error(t('That proposal can’t be read.'))
  for (const c of p.changes) {
    if (!CHANGE_APPLY[c.type]) throw new Error(t('That proposal can’t be read.'))
  }
  return true
}

/* ============================ snapshots & revert ============================ */

const clone = o => JSON.parse(JSON.stringify(o))

/**
 * Remember the `dayPlan` entries an apply step deleted, on the snapshot that will undo it.
 *
 * A patch, not a clone: `dayPlan` holds every date the user ever rescheduled, and three copies
 * of it in the snapshot ring would crowd real snapshots out of the 256 KB namespace budget that
 * `trim()` enforces. The first value recorded for a date wins — that is the pre-apply one.
 */
function recordDayPlanDrops(s, dropped) {
  if (!Object.keys(dropped).length) return
  const snaps = coachOf(s).snapshots || []
  const snap = snaps[snaps.length - 1]
  if (!snap) return
  snap.dayPlanRestore = { ...dropped, ...(snap.dayPlanRestore || {}) }
}

/**
 * Drop per-date reschedules from `iso` onwards.
 *
 * A created plan replaces the whole week, so overrides made against the old one are no longer
 * about anything: `'rest'` would hide a session the new plan schedules, and a routine id wins
 * over the new week on that day. Past dates stay — those are history, not intent.
 */
function sweepDayPlan(s, fromIso) {
  const dropped = {}
  Object.keys(s.dayPlan || {}).forEach(iso => {
    if (iso >= fromIso) { dropped[iso] = s.dayPlan[iso]; delete s.dayPlan[iso] }
  })
  recordDayPlanDrops(s, dropped)
}

/** Snapshot `{routines, week}` before touching either. The unit of revert (FR-30/31). */
export function pushSnapshot(s, proposalId, label) {
  const c = coachOf(s)
  c.snapshots = [...(c.snapshots || []), {
    at: Date.now(), proposalId: proposalId || null, label: label || '',
    routines: clone(s.routines || []), week: clone(s.week || {})
  }].slice(-SNAPSHOT_MAX)
  trim(s)
}

/**
 * Put the plan back the way it was before the last applied change-set.
 *
 * Workouts are untouched, and that is not an oversight: the log is what happened. Reverting a
 * plan re-derives every future target from that same history, which is exactly what the
 * progression engine does anyway.
 */
export function revertLast(s) {
  const c = coachOf(s)
  const snap = (c.snapshots || []).pop()
  if (!snap) return false
  s.routines = clone(snap.routines)
  s.week = clone(snap.week)
  // Snapshots taken before this field existed have nothing to put back.
  if (snap.dayPlanRestore) Object.assign(s.dayPlan, snap.dayPlanRestore)
  appendLog(s, { kind: 'revert', at: Date.now(), proposalId: snap.proposalId, summary: t('Reverted the last Coach changes.') })
  return true
}
export const canRevert = S => !!(S?.coach?.snapshots || []).length

/* ============================ the log ============================ */

export function appendLog(s, entry) {
  const c = coachOf(s)
  const e = { id: entry.id || uid(), ...entry }
  c.log = [...(c.log || []), e].slice(-LOG_MAX)
  trim(s)
  return e.id
}
export const logEntry = (S, id) => (S?.coach?.log || []).find(e => e.id === id) || null

/**
 * What a created plan looked like, small enough to keep: names, days and prescriptions, no
 * rationale text. The full bundle was merged into the plan already; this is what the chat
 * shows back when someone opens an old proposal months later.
 */
export function lightBundle(b) {
  if (!b) return null
  return {
    name: b.name || '', summary: b.summary || '', week: { ...(b.week || {}) },
    routines: (b.routines || []).map(r => ({
      id: r.id, name: r.name, emoji: r.emoji || '', why: r.why || '',
      ex: (r.ex || []).map(e => ({
        id: e.id, sets: e.sets, mode: e.mode || 'reps',
        ...(e.reps != null ? { reps: e.reps } : {}), ...(e.sec != null ? { sec: e.sec } : {}),
        ...(e.min != null ? { min: e.min } : {}), ...(e.weight ? { weight: e.weight } : {}),
        ...(e.why ? { why: String(e.why).slice(0, 200) } : {})
      }))
    }))
  }
}
const decisionOf = (c, status) => ({ id: c.id, type: c.type, target: c.target || null, before: c.before ?? null, after: c.after ?? null, why: c.why, routineName: c.routineName || null, status })


/**
 * Last line of defence for the 5 MB sync body: if the Coach namespace ever outgrows its
 * budget, drop the oldest history rather than let a PUT start failing for reasons nobody
 * would connect to this feature.
 */
function trim(s) {
  const c = coachOf(s)
  let guard = 0
  while (JSON.stringify(c).length > NAMESPACE_MAX && guard++ < 60) {
    if ((c.chat || []).length > 8) c.chat.shift()
    else if ((c.snapshots || []).length > 1) c.snapshots.shift()
    else if ((c.log || []).length > 1) c.log.shift()
    else break
  }
}

/* ============================ the conversation ============================ */

/**
 * One line of the chat: `{ id, role: 'user'|'coach', kind, text?, at, ref? }`.
 * kinds — user: 'intake' (the questionnaire, rendered from the live profile), 'text';
 *         coach: 'text', 'applied', 'dismissed', 'reverted', 'error', 'nochange'.
 */
export function appendChat(s, entry) {
  const c = coachOf(s)
  c.chat = [...(c.chat || []), { id: entry.id || uid(), at: entry.at || Date.now(), ...entry }].slice(-CHAT_MAX)
  trim(s)
}

/** A job just finished: remember how long it took, for the next typing bubble. */
export function recordTiming(s, ms) {
  if (!(ms > 0)) return
  const c = coachOf(s)
  c.timings = [...(c.timings || []), Math.round(ms)].slice(-TIMINGS_MAX)
}
/**
 * What to promise in the typing bubble. Median of the observed runs, but never slower than
 * the most recent one: after a speed-up (a faster model, a warmed cache) the median drags
 * three old 8-minute runs along, and telling someone "about 8 min" for a one-minute job is
 * worse than being briefly optimistic. A slow outlier still cannot scare anyone — the median
 * wins in that direction.
 */
export function estimateMs(S) {
  const raw = (S?.coach?.timings || []).filter(n => n > 0)
  if (!raw.length) return null
  const sorted = [...raw].sort((a, b) => a - b)
  return Math.min(sorted[Math.floor(sorted.length / 2)], raw[raw.length - 1])
}

/** The questionnaire, as the lines the chat shows back to the user. */
export function profileLines(p) {
  if (!p) return []
  const goal = { strength: 'Get stronger', muscle: 'Build muscle', general: 'General fitness', fatloss: 'Lose fat', endurance: 'Endurance' }[p.goal]
  const exp = { new: 'New to lifting', returning: 'Coming back after a break', regular: 'Training regularly' }[p.experience]
  const lines = []
  if (goal) lines.push(t(goal))
  if (exp) lines.push(t(exp))
  if (p.daysPerWeek) lines.push(p.daysPerWeek === 1 ? t('1 day a week') : t('{0} days a week', p.daysPerWeek))
  if (p.sessionMin) lines.push(t('{0} min per session', p.sessionMin))
  if (p.equipment?.length) lines.push(p.equipment.join(', '))
  if (p.limitations) lines.push(t('Limits: {0}', p.limitations))
  if (p.likes) lines.push(t('Likes: {0}', p.likes))
  if (p.dislikes) lines.push(t('Avoid: {0}', p.dislikes))
  if (p.notes) lines.push(p.notes)
  return lines
}

/* ============================ applying a created plan ============================ */

/**
 * Accepting a created plan is exactly importing a plan file (FR-18): routines arrive as new
 * ones with fresh ids, existing routines and history are never touched, and the week schedule
 * only moves if you asked it to.
 */
export function applyCreatedPlan(s, proposal, { schedule } = {}) {
  validateProposal(proposal)
  pushSnapshot(s, proposal.id, t('Before the Coach’s plan'))
  const bundle = proposal.bundle
  // The Coach's `why` texts are for the review screen; they have no place in the routine data.
  const stripped = {
    ...bundle,
    routines: bundle.routines.map(r => ({ ...r, why: undefined, ex: r.ex.map(e => ({ ...e, why: undefined, name: undefined })) }))
  }
  const res = mergePlan(s, stripped, { schedule })
  // Only when the week actually moved — with the switch off the old schedule still stands, and
  // so do the reschedules made against it.
  if (schedule) sweepDayPlan(s, todayISO())
  res.logId = appendLog(s, {
    kind: 'create', at: Date.now(), proposalId: proposal.id,
    summary: proposal.summary || '', routines: res.routines, iteration: proposal.iteration || 1,
    bundle: lightBundle(bundle), scheduled: !!schedule
  })
  return res
}

/* ============================ applying a change-set ============================ */

// One implementation per allowed type. The object is the closed list on this side of the
// wire: a type with no entry here cannot be applied, whatever the server let through.
const CHANGE_APPLY = {
  'add-exercise': (s, c) => {
    const r = need(findRoutine(s, c.target.routineId))
    const a = c.after || {}
    const e = { id: a.id, sets: a.sets || 3, mode: a.mode || 'reps' }
    if (e.mode === 'cardio') { e.min = a.min || 20; e.speed = a.speed || 8 }
    else if (e.mode === 'time') e.sec = a.sec || 45
    else e.reps = a.reps || 10
    if (a.weight > 0) e.weight = a.weight
    if (POLICIES.includes(a.prog)) e.prog = a.prog
    if (Number.isInteger(a.repsMin)) e.repsMin = a.repsMin
    if (Number.isInteger(a.repsMax)) e.repsMax = a.repsMax
    // Only when the Coach disagreed with the catalogue: an absent flag has always meant
    // "whatever the exercise says", and writing one out would freeze today's dataset into
    // the plan.
    if (a.bodyweight != null) e.bodyweight = !!a.bodyweight
    if (a.side) e.side = true
    const at = Number.isInteger(a.position) ? Math.min(a.position, r.ex.length) : r.ex.length
    r.ex.splice(at, 0, e)
    cleanupSg(r.ex)
  },
  'remove-exercise': (s, c) => {
    const r = need(findRoutine(s, c.target.routineId))
    r.ex = r.ex.filter(e => e.id !== c.target.exId)
    cleanupSg(r.ex)
  },
  'swap-exercise': (s, c) => {
    const r = need(findRoutine(s, c.target.routineId))
    const i = r.ex.findIndex(e => e.id === c.target.exId)
    if (i < 0) throw new Error('missing exercise')
    const old = r.ex[i], a = c.after || {}
    // Keep the old prescription unless the Coach deliberately changed it: a swap is about the
    // movement, and silently resetting sets and reps would be a second change nobody approved.
    //
    // The two v1.2.4 flags are the exception, and they have to be: they describe the *movement*,
    // not the prescription. Carrying `side: true` from a lunge onto a leg press would make the
    // app halve a rep count that was never per-side, so an explicit flag is dropped and the new
    // exercise goes back to whatever the catalogue says about it.
    const { bodyweight, side, ...keep } = old
    r.ex[i] = { ...keep, id: a.id, ...(a.sets ? { sets: a.sets } : {}), ...(a.reps ? { reps: a.reps } : {}), ...(a.weight > 0 ? { weight: a.weight } : {}) }
  },
  sets: (s, c) => { need(findExIn(s, c)).sets = c.after },
  reps: (s, c) => { need(findExIn(s, c)).reps = c.after },
  repsMin: (s, c) => { need(findExIn(s, c)).repsMin = c.after },
  repsMax: (s, c) => { need(findExIn(s, c)).repsMax = c.after },
  sec: (s, c) => { need(findExIn(s, c)).sec = c.after },
  cardio: (s, c) => {
    const e = need(findExIn(s, c))
    if (c.after?.min != null) e.min = c.after.min
    if (c.after?.speed != null) e.speed = c.after.speed
  },
  inc: (s, c) => { need(findExIn(s, c)).inc = c.after },
  'exercise-prog': (s, c) => { need(findExIn(s, c)).prog = c.after },
  'routine-prog': (s, c) => { need(findRoutine(s, c.target.routineId)).prog = c.after },
  reorder: (s, c) => {
    const r = need(findRoutine(s, c.target.routineId))
    const by = new Map(r.ex.map(e => [e.id, e]))
    const next = c.after.map(id => by.get(id)).filter(Boolean)
    // Distinct exercises, not just the right count: an order naming one id twice maps to the
    // same object twice and still counts right, which drops an exercise and leaves the
    // survivor aliased into two slots that then edit each other.
    if (next.length !== r.ex.length || new Set(next).size !== r.ex.length) throw new Error('incomplete reorder')
    r.ex = next
    cleanupSg(r.ex)
  },
  superset: (s, c) => {
    const r = need(findRoutine(s, c.target.routineId))
    const i = r.ex.findIndex(e => e.id === c.target.exId)
    if (i < 0) throw new Error('missing exercise')
    if (!c.after?.link) { delete r.ex[i].sg; cleanupSg(r.ex); return }
    // Splicing the partner out from under the anchor when they are the same exercise leaves
    // nothing to tag; refuse rather than reorder the routine on the way to a TypeError.
    if (c.after.with === c.target.exId) throw new Error('superset with itself')
    const j = r.ex.findIndex(e => e.id === c.after.with)
    if (j < 0) throw new Error('missing partner')
    // Supersets are a property of adjacency in this app; move the partner next to it first.
    const [partner] = r.ex.splice(j, 1)
    const at = r.ex.findIndex(e => e.id === c.target.exId)
    r.ex.splice(at + 1, 0, partner)
    const tag = uid().slice(0, 6)
    r.ex[at].sg = tag
    r.ex[at + 1].sg = tag
  },
  'add-routine': (s, c) => {
    const a = c.after
    s.routines.push({
      id: uid(), name: a.name, emoji: a.emoji || '🏋️',
      ...(POLICIES.includes(a.prog) ? { prog: a.prog } : {}),
      ex: a.ex.map(e => ({
        id: e.id, sets: e.sets || 3, mode: e.mode || 'reps',
        ...(e.mode === 'time' ? { sec: e.sec || 45 } : { reps: e.reps || 10 }),
        ...(Number.isInteger(e.repsMax) ? { repsMax: e.repsMax } : {}),
        ...(e.bodyweight != null ? { bodyweight: !!e.bodyweight } : {}),
        ...(e.side ? { side: true } : {})
      }))
    })
  },
  'remove-routine': (s, c) => {
    const id = c.target.routineId
    s.routines = s.routines.filter(r => r.id !== id)
    // A week pointing at a routine that no longer exists reads as a rest day anyway; clearing
    // it keeps the plan honest rather than merely harmless.
    Object.keys(s.week || {}).forEach(d => { if (s.week[d] === id) delete s.week[d] })
    // RoutineEdit does the same on a hand-deleted routine. A pointer left behind here is not
    // merely inert: the day still counts as overridden, so it wears a "rescheduled" badge for good.
    const dropped = {}
    Object.keys(s.dayPlan || {}).forEach(iso => {
      if (s.dayPlan[iso] === id) { dropped[iso] = id; delete s.dayPlan[iso] }
    })
    recordDayPlanDrops(s, dropped)
  },
  'rename-routine': (s, c) => { need(findRoutine(s, c.target.routineId)).name = c.after },
  week: (s, c) => {
    // A single-routine op: the slot is a list, but the Coach only ever names one routine (or
    // rest), and it replaces the day. This collapses a combined day to one routine — the same
    // stated limitation as a DayOverride (see docs/COMBINE_ROUTINES.md §8).
    const d = c.target.weekday
    if (c.after == null || c.after === 'rest') delete s.week[d]
    else s.week[d] = [c.after]
  }
}
export const CHANGE_TYPES = Object.keys(CHANGE_APPLY)

function findExIn(s, c) { return findEx(findRoutine(s, c.target.routineId), c.target.exId) }
function need(x) { if (!x) throw new Error('missing target'); return x }

/**
 * Apply the accepted subset, atomically (FR-30).
 *
 * Atomic comes free from how the store works: `update()` hands us a throwaway clone and only
 * keeps it if we return normally. Throwing part-way through therefore discards every change
 * this function already made, which is precisely the transaction we want — no half-applied
 * change-set, ever.
 */
export function applyChangeSet(s, proposal, acceptedIds) {
  validateProposal(proposal)
  const accepted = new Set(acceptedIds || [])
  const changes = (proposal.changes || []).filter(c => accepted.has(c.id) && c.status !== 'stale')
  if (!changes.length) return { applied: 0 }

  pushSnapshot(s, proposal.id, t('Before the Coach’s changes'))
  const applied = []
  for (const c of changes) {
    CHANGE_APPLY[c.type](s, c)
    applied.push(decisionOf(c, 'accepted'))
  }
  // Turned-down changes keep their before/after too: the chat shows the whole proposal back
  // later, and "you declined something about sets" is not a memory anyone can use.
  const rejected = (proposal.changes || [])
    .filter(c => !accepted.has(c.id))
    .map(c => decisionOf(c, c.status === 'stale' ? 'stale' : 'rejected'))

  const logId = appendLog(s, {
    kind: 'review', at: Date.now(), proposalId: proposal.id,
    summary: proposal.summary || '', evidence: proposal.evidence || null,
    notes: proposal.notes || [], decisions: [...applied, ...rejected]
  })
  coachOf(s).lastReview = { at: Date.now() }
  return { applied: applied.length, rejected: rejected.length, logId }
}

/** Turned down whole, or expired: recorded so a later review knows not to re-propose it. */
export function recordDismissal(s, proposal) {
  const logId = appendLog(s, {
    kind: proposal.kind === 'create' ? 'create' : 'review', at: Date.now(), proposalId: proposal.id,
    summary: proposal.summary || '', dismissed: true,
    evidence: proposal.evidence || null, notes: proposal.notes || [],
    ...(proposal.bundle ? { bundle: lightBundle(proposal.bundle), iteration: proposal.iteration || 1 } : {}),
    decisions: (proposal.changes || []).map(c => decisionOf(c, 'rejected'))
  })
  if (proposal.kind !== 'create') coachOf(s).lastReview = { at: Date.now() }
  return logId
}

/** A debrief has no decision to make: it is read, kept, and shown again on request. */
export function recordDebrief(s, proposal) {
  return appendLog(s, {
    kind: 'debrief', at: Date.now(), proposalId: proposal.id,
    workout: proposal.workout || null,
    summary: proposal.summary || '', score: proposal.score ?? null,
    highlights: proposal.highlights || [], watch: proposal.watch || [], nextTime: proposal.nextTime || []
  })
}

/* ============================ display helpers ============================ */

export const exName = id => EXIDX[id]?.n || t('Unknown exercise')
// Catalogue names are lower-case; a title reads better with each word capitalised, and doing it
// here rather than with CSS keeps a German sentence around the name from being Title Cased too.
const cap = s => String(s || '').replace(/(^|\s)(\p{L})/gu, (m, sp, ch) => sp + ch.toUpperCase())
export const exTitle = id => cap(exName(id))

/** Human label for a change, used on the review screen and in the log. */
export function changeTitle(c, S) {
  const ex = c.target?.exId ? exTitle(c.target.exId) : null
  switch (c.type) {
    case 'add-exercise': return t('Add {0}', exTitle(c.after?.id))
    case 'remove-exercise': return t('Drop {0}', ex)
    case 'swap-exercise': return t('Swap {0} for {1}', ex, exTitle(c.after?.id))
    case 'sets': return t('{0}: sets', ex)
    case 'reps': return t('{0}: reps', ex)
    case 'repsMin': return t('{0}: rep-range floor', ex)
    case 'repsMax': return t('{0}: rep-range ceiling', ex)
    case 'sec': return t('{0}: hold time', ex)
    case 'cardio': return t('{0}: duration & pace', ex)
    case 'inc': return t('{0}: load step', ex)
    case 'exercise-prog': return t('{0}: progression', ex)
    case 'routine-prog': return t('Routine progression')
    case 'reorder': return t('Reorder exercises')
    case 'superset': return c.after?.link ? t('Superset {0} with {1}', ex, exTitle(c.after.with)) : t('Unlink superset on {0}', ex)
    case 'add-routine': return t('Add routine “{0}”', c.after?.name)
    case 'remove-routine': return t('Remove a routine')
    case 'rename-routine': return t('Rename routine to “{0}”', c.after)
    case 'week': return Number.isInteger(c.target?.weekday) ? t('{0}: what’s planned', t(DAYN[c.target.weekday])) : t('Change what’s planned on one day')
    default: return c.type
  }
}

/** Short before/after strings for the diff column. */
export function changeValues(c, S) {
  const routineName = id => (S?.routines || []).find(r => r.id === id)?.name || id
  const fmt = v => {
    // `week` first — its value is a routine-id list (an array is also an object, so it has to
    // win before the generic branches). Render as " + "-joined routine names; null / empty /
    // "rest" all read as Rest.
    if (c.type === 'week') {
      const ids = [].concat(v ?? []).filter(x => x && x !== 'rest')
      return ids.length ? ids.map(routineName).join(' + ') : t('Rest')
    }
    if (v == null) return '—'
    if (typeof v === 'object') return v.id ? exTitle(v.id) : v.name || JSON.stringify(v)
    if (Array.isArray(v)) return v.length + ''
    return String(v)
  }
  if (['add-exercise', 'add-routine', 'reorder'].includes(c.type)) return null
  if (['remove-exercise', 'remove-routine'].includes(c.type)) return null
  return { before: fmt(c.before), after: fmt(c.after) }
}
