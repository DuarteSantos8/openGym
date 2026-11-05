// A programme run replayed (spec 7, 8, 10, 17). One fold over the run's frozen definition, its
// events and its saved exposures gives where every track stands: its calendar window or rotation
// round, stage, attempt, slots with their outcomes, and the decision each closed week or round took.
// Beside it: where a new session goes (slotFor), what it is generated from (slotInputs) and which
// adopted 1RMs a newer one could replace (referenceProposals). Pure: `today` and every record are
// arguments; nothing is read from a clock or written anywhere.
import { contentHash } from './canonical.js'
import { advanceProgression } from './advance.js'
import { roundLoad } from './load.js'
import { currentOneRm } from './one-rm.js'
import { needsOneRm } from './rules.js'
import { operatorFor, sameStart, valuesOfPrescription } from './program.js'
import { slotOutcome, stageRule } from './programme.js'

// ponytail: a replay walks at most 520 windows or rounds (ten years of weeks); an older run reads as of its 520th.
const MAX_PERIODS = 520
const DAY = 86400000
const REPEAT = { onFailure: 'repeat', onSkipped: 'repeat' }
const ms = at => (typeof at === 'number' ? at : Date.parse(at))
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const byTime = (a, b) => a.t - b.t || cmp(a.id, b.id)
const apptOf = slot => slot.split(':').slice(0, 2).join(':')
const oidOf = slot => slot.split(':').slice(2).join(':')

const fmts = new Map()
/** A timestamp's local calendar date in the run's frozen timezone; a date passes as it is. */
export function dateIn(at, tz) {
  if (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }))
  return fmts.get(tz).format(new Date(ms(at)))
}
// Days counted on the UTC midnights of local dates: a DST change never makes a week 6 or 8 days long.
const dayOf = date => Date.parse(date + 'T00:00:00Z') / DAY
const isoOf = day => new Date(day * DAY).toISOString().slice(0, 10)
// The first day of a day's calendar week (1970-01-01 was a Thursday; weekStart is 0 Sunday or 1 Monday).
const weekOf = (day, ws) => day - (((day + 4 - ws) % 7) + 7) % 7
const calendarWeek = (run, date) => (weekOf(dayOf(date), run.weekStart ?? 1) - weekOf(dayOf(run.startedOn), run.weekStart ?? 1)) / 7 + 1

/** Weeks: the period a local date falls in, 1 from the start's calendar week; 0 before startedOn.
 *  The whole weeks between a pause and its resume are not counted, and while paused it stands still. */
function periodOfDate(run, pauses, date) {
  if (date < run.startedOn) return 0
  let shift = 0
  for (const p of pauses) {
    if (date < p.from) break
    if (!p.to || date < p.to) return calendarWeek(run, p.from) - shift
    shift += calendarWeek(run, p.to) - calendarWeek(run, p.from)
  }
  return calendarWeek(run, date) - shift
}

/** Weeks: the calendar dates of a period's (last) window; `to` is null while a pause holds it open.
 *  Before the start (period 0) it is the partial first window, which opens on startedOn. */
function windowOf(run, pauses, k) {
  k = Math.max(k, 1)
  let shift = 0, open = false
  for (const p of pauses) {
    if (calendarWeek(run, p.from) - shift > k) break
    if (!p.to) { open = true; break }
    shift += calendarWeek(run, p.to) - calendarWeek(run, p.from)
  }
  const from = weekOf(dayOf(run.startedOn), run.weekStart ?? 1) + 7 * (k - 1 + shift)
  return { from: isoOf(from) < run.startedOn ? run.startedOn : isoOf(from), to: open ? null : isoOf(from + 6) }
}

const apptsOf = def => (def.schedule.mode === 'weeks' ? def.schedule.appts.map(a => a.rid) : def.schedule.sequence)
// An appointment counts when it plans a tracked exercise: a routine with none (or a rest token) never holds a round.
const tracked = (def, i) => def.tracks.some(t => t.slots.some(s => s.rid === apptsOf(def)[i]))

/** A track's slots in period k: one per bound occurrence per appointment of its routine (spec 7.2);
 *  in the partial first week only the appointments the activation owed. */
function slotsOf(run, def, track, k) {
  const weekly = def.schedule.mode === 'weeks'
  return apptsOf(def).flatMap((rid, a) => (weekly && k === 1 && run.firstWeek && !run.firstWeek.includes(a) ? [] : track.slots
    .filter(s => s.rid === rid).map(s => ({ id: `p${k}:a${a}:${s.oid}`, rid, oid: s.oid, appt: a, required: !s.optional }))))
}

/**
 * What a run's records say now (RunView: status, period, nominal, tracks, conflicts). `routines`
 * (optional, the profile's `[{ id, ex: [{ occurrenceId }] }]`) lets a slot whose occurrence is gone
 * block its track. Every track walks its own attempts from period 1: an attempt closes with its
 * week (or, in a rotation, once its slots are resolved), is decided by its frozen policy, and
 * carries its values by replaying advanceProgression over its credited work from its entry values.
 */
export function deriveRun({ run, events = [], workouts = [], prescriptions = {}, active = null, today, routines = null }) {
  const tz = run.tz || 'UTC'
  const weekly = run.def.schedule.mode === 'weeks'
  const evs = (Array.isArray(events) ? events : Object.values(events || {})).filter(e => e?.runId === run.id).map(e => ({ ...e, t: ms(e.at) })).sort(byTime)
  const of = type => evs.filter(e => e.type === type)
  const amends = of('amend')
  const latest = amends.at(-1)?.def ?? run.def
  // Competing first captures (from: null) at one instant: the lower canonical content hash (spec 17).
  const refs = of('reference').sort((a, b) => a.t - b.t || (a.from == null && b.from == null ? cmp(contentHash(a.ref), contentHash(b.ref)) : cmp(a.id, b.id)))

  const pauses = []
  for (const e of evs) {
    const open = pauses.length > 0 && !pauses.at(-1).to
    if (e.type === 'pause' && !open) pauses.push({ from: dateIn(e.at, tz), to: null })
    else if (e.type === 'resume' && open) pauses.at(-1).to = dateIn(e.at, tz)
  }

  // Saved exposures of this run, earliest first; an assign event moves one to another slot. Work
  // saved before the run existed (a converted legacy run, spec 15.3) counts only through an assign event.
  const moved = new Map(of('assign').map(e => [e.exposureId, e.slot]))
  const legacy = slot => ({ runId: run.id, trackId: run.def.tracks.find(t => t.slots.some(s => s.oid === oidOf(slot)))?.id, slot })
  const saved = []
  for (const w of workouts) {
    for (const x of w.exposures || []) {
      const g = x.programme ?? (moved.has(x.exposureId) ? legacy(moved.get(x.exposureId)) : null)
      if (g?.runId !== run.id) continue
      const t = ms(x.completedAt ?? w.end ?? w.start), p = prescriptions[x.prescriptionId] ?? null
      saved.push({ x, g, id: x.exposureId, track: g.trackId, slot: moved.get(x.exposureId) ?? g.slot, role: g.role ?? 'work', moved: moved.has(x.exposureId), t, gen: p ? ms(p.generatedAt) : t, p })
    }
  }
  saved.sort(byTime)
  // A slot takes its earliest completed exposure (completedAt, then id); the others stay logged as extra.
  // byPeriod: when each track's work was generated, by the period it was generated for (an
  // assigned correction still started its own week, not the one it fills).
  const credit = new Map(), byPeriod = new Map(), dropped = new Set()
  const started = (track, slot, gen) => { const at = `${track}|${slot.split(':')[0]}`; if (!byPeriod.has(at)) byPeriod.set(at, []); byPeriod.get(at).push(gen) }
  for (const s of saved) {
    if (s.role !== 'extra') { if (!credit.has(`${s.track}|${s.slot}`)) credit.set(`${s.track}|${s.slot}`, []); credit.get(`${s.track}|${s.slot}`).push(s) }
    started(s.track, s.g.slot, s.gen)
  }
  // An open session is pending on its slot, and has started its attempt.
  const live = new Set()
  for (const x of active?.exposures || []) {
    if (x.programme?.runId !== run.id) continue
    live.add(`${x.programme.trackId}|${x.programme.slot}`)
    started(x.programme.trackId, x.programme.slot, ms(prescriptions[x.prescriptionId]?.generatedAt ?? today))
  }

  const disposed = new Map(), resolved = new Map(), closes = new Map(), taken = {}
  const take = (appt, t) => { if (!(appt in taken) || t < taken[appt]) taken[appt] = t }
  for (const s of saved) take(apptOf(s.slot), s.t)
  for (const e of evs) {
    if (e.type === 'skip' || e.type === 'discard') { disposed.set(e.slot, e); take(apptOf(e.slot), e.t) }
    if (e.type === 'bypass') for (const a of e.appts || []) { disposed.set(`p${e.period}:a${a}`, e); take(`p${e.period}:a${a}`, e.t) }
    if (e.type === 'resolve') resolved.set(e.slot, e)
    if (e.type === 'close' && !closes.has(e.period)) { closes.set(e.period, e); apptsOf(run.def).forEach((_, a) => take(`p${e.period}:a${a}`, e.t)) }
  }
  const dispositionOf = slot => disposed.get(slot) ?? disposed.get(apptOf(slot)) ?? null

  // Rotation: a round is consumed once every tracked appointment of it has an exposure or a
  // disposition; time alone never consumes one. consumed[r - 1] is when its last one was resolved.
  const defAt = t => amends.findLast(e => e.t <= t)?.def ?? run.def
  const consumed = []
  for (let r = 1; !weekly && r <= MAX_PERIODS; r++) {
    const d = defAt(consumed.at(-1) ?? -Infinity)
    const times = apptsOf(d).map((_, i) => (tracked(d, i) ? taken[`p${r}:a${i}`] : -Infinity))
    if (times.some(t => t === undefined)) break
    consumed.push(Math.max(...times))
  }
  const periodAt = t => (!Number.isFinite(t) ? 0 : weekly ? periodOfDate(run, pauses, dateIn(t, tz)) : 1 + consumed.filter(c => c < t).length)
  const ended = of('end')[0]
  let now = today < run.startedOn ? 0 : weekly ? periodOfDate(run, pauses, today) : consumed.length + 1
  if (ended) now = Math.min(now, periodAt(ended.t))
  now = Math.min(now, MAX_PERIODS + 1)
  // A converted legacy run starts where its calendar weeks left it (spec 15.3): weekOffset weeks are spent.
  const offset = run.legacy?.weekOffset ?? 0
  const n = Math.max(0, latest.duration.n - offset)
  // An end-policy change counts while the nominal end is still ahead.
  const endPolicy = of('end-policy').filter(e => periodAt(e.t) <= n).at(-1)?.end ?? run.end ?? 'stop'
  const limit = endPolicy === 'stop' ? n : MAX_PERIODS

  const conflicts = []
  const idle = new WeakSet()
  // Consecutive wholly unattempted windows that end the same way are one span (spec 7.4).
  const push = (list, d, quiet) => {
    const last = list.at(-1)
    if (quiet && idle.has(last) && last.stage === d.stage && last.action === d.action && (last.through ?? last.period) === d.period - 1) Object.assign(last, { through: d.period, at: d.at })
    else { list.push(d); if (quiet) idle.add(d) }
  }

  function walk(id) {
    const rt = run.tracks?.[id] ?? {}
    const added = run.def.tracks.some(t => t.id === id) ? null : amends.find(e => e.def.tracks.some(t => t.id === id))
    const removal = amends.find(e => e.t >= (added?.t ?? -Infinity) && !e.def.tracks.some(t => t.id === id))
    const decisions = [], tries = {}
    let k = added ? periodAt(added.t) + 1 : 1, i = added ? 0 : Math.min(offset, run.def.tracks.find(t => t.id === id).stages.length - 1)
    let entry = {}, cycleOk = true, achieved = null, tm = null, state = 'active'
    let def = run.def, known = null, applies = () => true, slots = [], values = entry
    for (;;) {
      // Maintenance shows the current window.
      if (achieved && known && i >= known.stages.length) k = Math.max(k, Math.min(now, limit))
      const gens = byPeriod.get(`${id}|p${k}`) || []
      const startedAt = gens.length ? Math.min(...gens) : null
      const closedWindow = weekly ? now > k || closes.has(k) : k <= consumed.length || closes.has(k)
      // Policy, end policy, references and amends apply from the next attempt with no prescription and no work.
      applies = e => (startedAt != null ? e.t <= startedAt : !closedWindow || periodAt(e.t) <= k)
      def = amends.filter(applies).at(-1)?.def ?? run.def
      // A repair (spec 7.1): an attempt held up by a gone occurrence takes the first later amend
      // that rebinds or drops it, when that amend came while its window was still open. A window
      // that closed unrepaired keeps the closure it had: the occurrence is read as having been there.
      const gone = s => !!routines && !routines.find(r => r.id === s.rid)?.ex?.some(o => o.occurrenceId === s.oid)
      const stuck = d => { const tr = d.tracks.find(t => t.id === id); return !!tr && slotsOf(run, d, tr, k).some(s => s.required && gone(s) && !credit.has(`${id}|${s.id}`) && !dispositionOf(s.id)) }
      const fix = routines && stuck(def) ? amends.find(e => !applies(e) && !stuck(e.def)) : null
      if (fix && periodAt(fix.t) <= k) def = fix.def
      const track = def.tracks.find(t => t.id === id)
      known = track ?? known
      tm ??= rt.tm ?? (track?.tm ? { value: track.tm.value, unit: track.tm.unit } : null)
      slots = []
      values = entry
      // Dropped by an amend: its open week closes as removed, never as succeeded.
      if (!track || (removal && periodAt(removal.t) <= Math.min(k, now))) { state = 'removed'; break }
      if (achieved && i >= track.stages.length) {
        // Maintenance (spec 8.6): its slots are shown and logged; they decide nothing.
        slots = k > limit ? [] : slotsOf(run, def, track, k).map(s => {
          const c = credit.get(`${id}|${s.id}`)?.[0]
          return { ...s, ...(c?.p ? { ...slotOutcome({ prescription: c.p, exposure: c.x }), exposureId: c.id } : { outcome: 'pending', reasons: [] }) }
        })
        state = 'maintenance'
        break
      }
      if (k > limit) break
      const lastWork = track.stages.findLastIndex(s => s.kind === 'work')
      let stage = track.stages[i]
      let attempt = tries[stage.id] ??= 1
      const bound = slotsOf(run, def, track, k)
      const works = s => (credit.get(`${id}|${s.id}`) || []).filter(c => c.role === 'work')
      const workOf = s => works(s).find(c => !dropped.has(c)) ?? null
      // Work generated for another stage or attempt than the replay reaches is a conflict (spec 17);
      // the recorded assignment holds until a conflict event naming one of those exposures says
      // otherwise. Under 'recomputed' that work credits nothing and a redo of the slot takes it.
      const astray = c => !c.moved && (c.x.programme.stage !== stage.id || c.x.programme.attempt !== attempt)
      const off = bound.map(s => works(s)[0]).filter(c => c && astray(c))
      const keep = off.length ? of('conflict').filter(e => e.trackId === id && off.some(c => c.id === e.exposureId)).at(-1)?.keep : null
      if (keep === 'recomputed') for (const s of bound) for (const c of works(s)) if (astray(c)) dropped.add(c)
      if (off.length && keep !== 'recomputed') {
        if (!keep) conflicts.push(...off.map(c => ({ trackId: id, exposureId: c.id })))
        // ponytail: the position follows the record, the values the replay's entry; a recorded branch's own entry values are not rebuilt.
        const j = track.stages.findIndex(s => s.id === off[0].x.programme.stage)
        if (j >= 0) { i = j; stage = track.stages[j]; attempt = tries[stage.id] = off[0].x.programme.attempt }
      }
      const blocked = !closedWindow && bound.some(s => s.required && gone(s) && !credit.has(`${id}|${s.id}`) && !dispositionOf(s.id))
      // R: when the evidence arrived. Work started for this window and finished later, or a later
      // disposition or resolve, moves the effective close to its time (spec 7.4); a correction
      // assigned afterwards is history and does not. `early` is each slot as the window left it.
      let R = -Infinity, base = -Infinity, settled = -Infinity
      const credits = []
      const read = (stage.kind === 'rest' ? [] : bound).map(s => {
        const key = `${id}|${s.id}`
        const c = workOf(s)
        const act = live.has(key)
        let d = c || act ? null : dispositionOf(s.id)
        // Work recomputed away awaits its redo, or a resolve: it is never read as unattempted.
        const redo = !c && !act && !d && works(s).length > 0
        if (!c && !act && !d && !redo && closedWindow) d = { type: 'close' }
        const o0 = redo ? { outcome: closedWindow ? 'unknown' : 'pending', reasons: ['recomputed'] }
          : c && !c.p ? { outcome: 'unknown', reasons: ['missing_prescription'] } : slotOutcome({ prescription: c?.p, exposure: c?.x ?? null, disposition: d, active: act })
        const r = resolved.get(s.id)
        const settles = !!r && !act && (o0.outcome === 'unknown' || o0.outcome === 'pending')
        const o = settles ? { outcome: r.as, reasons: [...o0.reasons, 'resolved'] } : o0
        const t = Math.max(c && periodAt(c.gen) <= k ? c.t : -Infinity, d?.t ?? -Infinity)
        base = Math.max(base, t)
        R = Math.max(R, t, settles ? r.t : -Infinity)
        if (settles) settled = Math.max(settled, r.t)
        if (c) credits.push({ ...c, oid: s.oid })
        const early = weekly ? (periodAt(t) > k ? 'pending' : settles && periodAt(r.t) > k ? o0.outcome : o.outcome) : settles ? o0.outcome : o.outcome
        return { slot: { ...s, outcome: o.outcome, reasons: o.reasons, ...(c ? { exposureId: c.id } : {}) }, early }
      })
      slots = read.map(x => x.slot)
      values = carry(entry, credits)
      if (blocked) { state = 'blocked'; break }
      const required = read.filter(x => x.slot.required)
      if (!closedWindow && (weekly || !required.length || required.some(x => x.slot.outcome === 'pending'))) break

      const reasonsOf = pick => Object.fromEntries(['failed', 'skipped', 'unknown'].map(o => [o, required.filter(x => pick(x) === o).map(x => x.slot.id)]))
      const reasons = reasonsOf(x => x.slot.outcome)
      const pending = required.some(x => x.slot.outcome === 'pending')
      R = Math.max(R, settled)
      const late = required.some(x => x.early !== x.slot.outcome)
      const policy = of('policy').filter(e => e.trackId === id && applies(e)).at(-1)?.policy ?? rt.policy ?? track.policy ?? REPEAT
      const free = stage.kind === 'rest' || (stage.kind === 'recovery' && stage.close === 'calendar')
      const repeat = (reasons.failed.length > 0 && policy.onFailure === 'repeat') || (reasons.skipped.length > 0 && policy.onSkipped === 'repeat')
      const action = free ? 'advance' : pending ? 'hold' : repeat ? 'repeat' : reasons.unknown.length ? 'hold' : 'advance'
      const success = !free && !pending && !reasons.failed.length && !reasons.skipped.length && !reasons.unknown.length
      const endOf = t => (weekly ? windowOf(run, pauses, k).to : dateIn(Number.isFinite(t) ? t : consumed[k - 1] ?? closes.get(k)?.t, tz))
      const decision = (act, at, why = reasons) => ({ stage: stage.id, attempt, period: k, action: act, reasons: why, policy, at })
      const dropBy = t => !!removal && periodAt(removal.t) <= now && removal.t <= t
      if (action === 'hold') { push(decisions, decision('hold', endOf(base))); state = dropBy(Infinity) ? 'removed' : 'held'; break }
      if (late && dropBy(R)) { push(decisions, decision('hold', endOf(base), reasonsOf(x => x.early))); state = 'removed'; break }
      if (late) push(decisions, decision('hold', endOf(base), reasonsOf(x => x.early)))
      const goal = i === lastWork && success
      const quiet = !late && required.length > 0 && required.every(x => x.slot.reasons[0] === 'close')
      push(decisions, decision(goal ? 'achieve' : action, weekly && periodAt(R) > k ? dateIn(R, tz) : endOf(R)), quiet)
      // In a rotation a round's own exposures close it on time, whatever their completedAt: only a later resolve defers.
      const next = Math.max(k + 1, periodAt(weekly ? R : settled) + 1)
      if (action === 'repeat') { tries[stage.id] = attempt + 1; k = next; continue }
      // Advance: a success commits what the attempt earned; a miss keeps the entry values (spec 8.4).
      if (stage.kind === 'work') { if (success) entry = values; else cycleOk = false }
      if (goal) achieved = { stage: stage.id, values: attainedOf(credits), tm }
      // The training max grows once, on leaving a cycle whose work stages were all left by a success.
      if (stage.cycleEnd) { if (cycleOk && tm && track.tm?.increment) tm = { ...tm, value: tm.value + track.tm.increment }; cycleOk = true }
      // Past the last stage with the goal still open, its last work stage is attempted again (spec 8.5).
      const more = i + 1 < track.stages.length
      // ponytail: a track of recovery or rest stages only has no goal to miss; it is achieved when they end.
      if (!more && lastWork < 0) achieved ??= { stage: stage.id, values: {}, tm }
      i = more || achieved ? i + 1 : lastWork
      if (i < track.stages.length) tries[track.stages[i].id] = (tries[track.stages[i].id] ?? 0) + 1
      k = next
    }
    const stage = (def.tracks.find(t => t.id === id) ?? known)?.stages[i]
    return {
      resolved: state === 'removed' || state === 'maintenance',
      view: {
        stage: state === 'maintenance' ? achieved.stage : stage?.id ?? null, attempt: tries[stage?.id] ?? 1, state, period: k, slots, decisions, values,
        ref: refAt(id, rt, applies), nextRef: refAt(id, rt, () => true), tm, ...(achieved ? { achieved } : {}), def
      }
    }
  }
  function refAt(id, rt, applies) {
    let ref = rt.ref ?? null
    // An accept names the reference it replaces: a stale one (another from) is ignored.
    for (const e of refs) if (e.trackId === id && applies(e) && (e.from ?? null) === (ref?.id ?? null)) ref = e.ref
    return ref
  }

  const ids = [...new Set([...run.def.tracks, ...latest.tracks].map(t => t.id))]
  const walked = Object.fromEntries(ids.map(id => [id, walk(id)]))
  const complete = ids.length > 0 && ids.every(id => walked[id].resolved) && ids.some(id => walked[id].view.state === 'maintenance')
  const used = weekly ? Math.max(0, now - 1) : consumed.length
  const stopped = endPolicy === 'stop' && used >= n
  const paused = pauses.some(p => !p.to)
  const status = ended ? 'ended' : complete ? 'complete' : stopped ? 'stopped' : paused ? 'paused' : 'running'
  const tracks = {}
  for (const id of ids) {
    const v = walked[id].view
    tracks[id] = v.state === 'maintenance' && !['running', 'paused'].includes(status) ? { ...v, state: 'achieved' } : v
  }
  const d = defAt(consumed.at(-1) ?? -Infinity)
  const period = weekly ? { index: now, ...windowOf(run, pauses, now) } : { index: now, next: apptsOf(d).findIndex((_, i) => tracked(d, i) && !(`p${now}:a${i}` in taken)) }
  // For slotFor: per appointment, true when a disposition took all of it, else the occurrences recorded or open in it.
  const marks = {}
  for (const slot of [...saved.filter(s => !dropped.has(s)).map(s => s.slot), ...[...live].map(key => key.split('|')[1]), ...disposed.keys(), ...[...closes.keys()].flatMap(k => apptsOf(run.def).map((_, a) => `p${k}:a${a}`))]) {
    const a = apptOf(slot), oid = oidOf(slot)
    if (!oid) marks[a] = true
    else if (marks[a] !== true) marks[a] = [...(marks[a] || []), oid]
  }
  return { status, period, nominal: { used: (endPolicy === 'stop' ? Math.min(used, n) : used) + offset, of: n + offset, unit: latest.duration.unit }, tracks, conflicts, def: latest, pauses, taken: marks }
}

/** Each occurrence's generation inputs, its entry advanced over the attempt's credited work in order.
 *  A recovery exposure (adaptive: false) moves no values, so the last work stays what `lastLog` is. */
function carry(entry, credits) {
  const next = Object.fromEntries(Object.entries(entry).map(([oid, v]) => [oid, { ...v, fresh: true }]))
  for (const c of [...credits].sort(byTime)) {
    if (!c.p || !c.x.actual || c.x.excludedFromProgression) continue
    const v = next[c.oid] ?? { state: null, lastPrescription: null, lastLog: null }
    const state = advanceProgression({ state: v.state, prescription: c.p, log: { id: c.id, actual: c.x.actual, performance: c.x.performance }, now: c.x.completedAt ?? null })
    next[c.oid] = c.p.ruleSnapshot.program.adaptive === false ? { ...v, state, fresh: false } : { state, lastPrescription: c.p, lastLog: c.x, fresh: false }
  }
  return next
}

// What the goal attempt prescribed, per occurrence: the work maintenance repeats.
const attainedOf = credits => Object.fromEntries([...credits].sort(byTime).filter(c => c.p).map(c => [c.oid, { phaseId: c.p.phaseId, values: valuesOfPrescription(c.p) }]))

/**
 * Where a session of occurrence `oid` in routine `rid` on local `date` goes: its slot in the run,
 * as work, maintenance or extra (logged, earning nothing), or null when the run gives it none. In a
 * rotation or an ordered week, continuing past earlier unresolved appointments of the same period
 * lists them in `bypass`; only a recorded bypass event skips them.
 */
export function slotFor({ view, run, rid, oid, date }) {
  const none = { assignment: null, bypass: [] }
  if (view.status !== 'running' || date < run.startedOn) return none
  const found = Object.entries(view.tracks).find(([id, tv]) => tv.def?.tracks.find(t => t.id === id)?.slots.some(s => s.rid === rid && s.oid === oid))
  if (!found || ['removed', 'blocked'].includes(found[1].state)) return none
  const [trackId, tv] = found
  const def = tv.def, weekly = def.schedule.mode === 'weeks'
  const period = weekly ? periodOfDate(run, view.pauses, date) : view.period.index
  const appts = apptsOf(def)
  const owed = i => !weekly || period > 1 || !run.firstWeek || run.firstWeek.includes(i)
  const mark = i => view.taken[`p${period}:a${i}`]
  const open = i => mark(i) !== true && !mark(i)?.includes(oid)
  const mine = appts.map((r, i) => i).filter(i => appts[i] === rid && owed(i))
  const a = mine.find(open) ?? mine[0] ?? appts.indexOf(rid)
  if (a < 0) return none
  const slot = `p${period}:a${a}:${oid}`
  const listed = open(a) && tv.period === period && tv.slots.some(s => s.id === slot)
  const role = !listed ? 'extra' : tv.state === 'maintenance' ? 'maintenance' : tv.state === 'active' ? 'work' : 'extra'
  const bypass = !weekly || def.schedule.ordered ? appts.map((r, i) => i).filter(i => i < a && owed(i) && tracked(def, i) && !mark(i)).map(i => `p${period}:a${i}`) : []
  return { assignment: { slot, trackId, stage: role === 'maintenance' ? tv.achieved.stage : tv.stage, attempt: tv.attempt, role, period }, bypass }
}

// Maintenance (spec 8.6): the achieved stage at the values it was achieved with. Its steps are
// removed (a ladder keeps its rungs, which name the exercise), the sets, reps and seconds they had
// grown are pinned, and the rule is logged without moving anything (adaptive: false, advance.js).
function maintained(rule, attained) {
  const v = attained?.values
  const own = rule.program.phases.filter(ph => ph.id === attained?.phaseId)
  const phases = (own.length ? own : rule.program.phases.slice(0, 1)).map(({ stall, ...ph }) => {
    const pin = m => (v && operatorFor(ph, m) && v[m] != null ? { [m]: typeof v[m] === 'object' ? v[m] : { min: v[m], max: v[m] } } : {})
    return {
      ...ph, target: { mode: 'none' }, exit: null, progression: ph.progression.filter(op => op.metric === 'difficulty'),
      parameters: { ...ph.parameters, ...pin('sets'), ...pin('reps'), ...pin('durationSeconds'), ...(v && operatorFor(ph, 'restSeconds') ? { restSeconds: v.restSeconds } : {}) }
    }
  })
  return { ...rule, program: { ...rule.program, phases, end: 'complete', completion: [], adaptive: false } }
}

// A stage's entry values (spec 6): a declared seed, or 'copy' of the last qualified prescription's
// value, on top of what generation would carry anyway. A number load seed is the rule's own start.
function entryAt(rule, v, seeds) {
  const values = {}
  for (const [m, s] of Object.entries(seeds || {})) {
    if (s === 'copy') { if (v.lastPrescription) values[m] = valuesOfPrescription(v.lastPrescription)[m] }
    else if (m !== 'load' || typeof s === 'object') values[m] = s
  }
  if (!Object.keys(values).length) return null
  const phase = rule.program.phases[0]
  const carried = v.state?.values && v.lastPrescription && v.state.phaseId === phase.id && sameStart(v.lastPrescription.ruleSnapshot, rule) ? v.state.values : {}
  return { phaseId: phase.id, values: { ...carried, ...values } }
}

/**
 * The generatePrescription inputs for an assignment from slotFor: the stage rule of its run-scoped
 * track (`run:<run>:<track>:<oid>`), the state and last prescription and log it opens from, the
 * adopted 1RM frozen for its attempt, plus `at` (entry values) and `effort` (the week's effort, for
 * provenance.programme) when it has them. `{ blocked }` when the occurrence is gone or a percentage
 * has no adopted reference yet.
 */
export function slotInputs({ view, run, assignment, occRule }) {
  if (!occRule) return { blocked: 'occurrence-missing' }
  const { slot, trackId: id, role } = assignment
  const tv = view.tracks[id]
  const oid = oidOf(slot)
  const track = tv.def.tracks.find(t => t.id === id)
  const kept = role === 'maintenance'
  const stage = track.stages.find(s => s.id === (kept ? tv.achieved.stage : assignment.stage))
  const tm = kept ? tv.achieved.tm : tv.tm
  let rule = stageRule({ def: tv.def, track: tm ? { ...track, tm: { ...track.tm, ...tm } } : track, stage, oid, occRule, runId: run.id })
  if (kept) rule = maintained(rule, tv.achieved.values[oid])
  if (needsOneRm(rule) && !tv.ref) return { blocked: 'reference-missing' }
  const v = kept ? {} : tv.values[oid] ?? { fresh: true }
  const target = stage.targets?.[oid] ?? {}
  // The run's captured seed opens the stage's adaptive metrics only: what a week fixes, a percentage, stands as authored.
  const captured = v.state ? {} : Object.fromEntries(Object.entries(run.tracks?.[id]?.seed?.[oid] ?? {}).filter(([m]) => operatorFor(rule.program.phases[0], m)))
  const at = kept ? tv.achieved.values[oid] ?? null : v.fresh ? entryAt(rule, v, { ...captured, ...target.seed }) : null
  return {
    rule, trackId: `run:${run.id}:${id}:${oid}`, state: v.state ?? null, lastPrescription: v.lastPrescription ?? null,
    lastLog: v.lastLog ? { ...v.lastLog, id: v.lastLog.exposureId } : null, oneRm: tv.ref,
    ...(at ? { at } : {}), ...(target.effort ? { effort: target.effort } : {})
  }
}

/**
 * Proposals to adopt a newer 1RM (spec 10.2), one per context that asks and has a percentage
 * depending on it: the adopted and candidate references, and each percentage's load before and
 * after, with equipment rounding. A context is `{ key, exerciseId, ref, pref, percents, rounding, tm? }`;
 * `reviews[key]` with decision 'keep' hides that same candidate, 'later' leaves it listed.
 */
export function referenceProposals({ contexts = [], oneRepMaxes = {}, reviews = {} }) {
  return contexts.flatMap(c => {
    const from = c.ref, to = currentOneRm(oneRepMaxes, c.exerciseId)
    const review = reviews[c.key]
    // ponytail: a training max is rebased by its own explicit action (spec 10.3), never by a 1RM proposal; a 1RM in another unit is not compared.
    if (c.pref !== 'ask' || c.tm || !from || !to || !c.percents?.length || to.unit !== from.unit || to.value === from.value) return []
    if (review?.decision === 'keep' && review.candidateId === to.id) return []
    const at = (ref, percent) => roundLoad(ref.value * percent / 100, c.rounding)
    return [{ key: c.key, exerciseId: c.exerciseId, from, to, candidateId: to.id, samples: c.percents.map(percent => ({ percent, from: at(from, percent), to: at(to, percent) })) }]
  })
}
