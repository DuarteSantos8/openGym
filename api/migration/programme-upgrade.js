/* The contract-1 upgrade (spec 15): today's programmes (frontend/src/lib/programmes.js, the shape a
 * v2 profile still carries) become engine definitions, and the running one a run that goes on at
 * its calendar week under the legacy choices, labelled as such.
 *
 * Pure and deterministic like the v1 → v2 migration it is chained onto: every id derives from a
 * source id, every date from the profile (its newest workout, the run's own dates), and the
 * catalogue is an argument. Prescriptions, exposures, progression and 1RM records are never
 * touched. Nothing is returned unless the result validates and replays.
 */
import { ENGINE_CONTRACT, ENGINE_SCHEMA, contractOf } from './profile-version.js';
import { validateCanonicalProfile } from './profile-validation.js';
import { assertSyncSize } from './profile-size.js';
import { isAssisted, isBodyweight } from './profile-migration.js';
import { currentOneRm, deriveRun, needsOneRm, validateProgramme } from '../engine/index.js';
import { scalable } from '../engine/programme.js';
import { cmp, dateIn, dayOf, isoOf, weekOf } from '../engine/programme-run.js';

// lib/programmes.js: 1 to 16 weeks, a %1RM of 30 to 110, an RPE of 6 to 10, both to the half.
const MAX_WEEKS = 16, MAX_TRACKS = 50, PCT_MAX = 110;
// What a legacy deload week without a %1RM took off (lib/progression.js DELOAD_FACTOR).
const DELOAD_FACTOR = 0.9;
// The legacy calendar never held a week: the preserved choice, never presented as the user's.
const LEGACY = { onFailure: 'advance', onSkipped: 'advance' };

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);
const copy = v => JSON.parse(JSON.stringify(v));
const half = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi ? Math.round(v * 2) / 2 : null);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
// The first day of a date's calendar week, on engine/programme-run.js's day numbers.
const weekStartOf = (date, ws) => weekOf(dayOf(date), ws);
// The zone the reminder fires by is the profile's own (api/queue.js reads it the same way); UTC without one.
function zoneOf(tz) {
  if (typeof tz !== 'string' || !tz) return 'UTC';
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

/** A legacy week as lib/programmes.js cleanWeek reads it: a target with neither number is none. */
function cleanWeek(w) {
  const t = {};
  for (const [k, x] of Object.entries(isObj(w?.t) ? w.t : {})) {
    const pct = half(x?.pct, 30, PCT_MAX), rpe = half(x?.rpe, 6, 10);
    if (pct != null || rpe != null) t[k] = { pct, rpe };
  }
  return { deload: w?.deload === true, rpe: half(w?.rpe, 6, 10), t };
}

// The occurrence's phase at a %1RM: the same groups and their anchor ratios, its steps removed.
function percentPhase(ph, percent) {
  const { stall, ...rest } = copy(ph);
  const { loadTo, ...parameters } = rest.parameters;
  return { ...rest, parameters: { ...parameters, load: { mode: 'percent_1rm', percent } }, target: { mode: 'none' }, progression: [], exit: null };
}

/** One track per occurrence: a stage per legacy week, the occurrence's own rule unless a %1RM fixes it. */
function trackOf(p, rid, occ, weeks, ctx) {
  const oid = occ.occurrenceId, rule = occ.rule, id = `t:${p.id}:${oid}`;
  const info = ctx.customEx.find(c => String(c.id) === occ.exerciseId) || ctx.catalogue.get(occ.exerciseId) || null;
  const st = ctx.progression[oid];
  const ph = rule.program.phases.find(x => x.id === st?.phaseId) ?? rule.program.phases[0];
  // lib/session-start.js programmePlan: a %1RM and the deload factor only ever reached reps work under an external load.
  // An occurrence made in the app may store no mode: read it as the session does (a duration is a hold, else the catalogue's).
  const mode = occ.mode ?? (rule.program.phases[0].parameters.durationSeconds ? 'time' : info?.bp === 'cardio' ? 'cardio' : 'reps');
  const external = mode === 'reps' && !isBodyweight(occ, info) && !(typeof occ.assisted === 'boolean' ? occ.assisted : isAssisted(info));
  // A flat %1RM is a load for the anchor; groups of their own (a training max, explicit per-set loads) are never guessed (spec 15.2).
  const anchored = ph.groups.every(g => g.load.basis === 'anchor');
  let repair = null;
  const stages = weeks.map((w, i) => {
    // lib/programmes.js programmeSlot: the routine's own entry, whole, else the exercise's.
    const own = w.t[`${rid}:${occ.exerciseId}`] || w.t[occ.exerciseId] || {};
    const pct = external ? own.pct : null;
    if (pct != null && !anchored) repair = ph.groups.some(g => g.load.basis === 'training_max') ? 'training-max' : 'group-loads';
    const target = pct != null && anchored ? { own: 'set', phase: percentPhase(ph, pct) }
      : { own: 'inherit', ...(w.deload && external && scalable(rule) ? { deload: { factor: DELOAD_FACTOR } } : {}) };
    const rpe = own.rpe ?? w.rpe;
    if (rpe != null) target.effort = { mode: 'advisory', rpe };
    // A deload week stays out of progression and passes with the calendar, as it did.
    return { id: `s${i + 1}`, kind: w.deload ? 'recovery' : 'work', ...(w.deload ? { close: 'calendar' } : {}), targets: { [oid]: target } };
  });
  // Spec 6: the occurrence's steps come back after a fixed week at a declared seed: the load where
  // the ordinary track stands (else the rule's own start), the other metrics copied from that week.
  const metrics = [...new Set(rule.program.phases.flatMap(x => x.progression.map(op => op.metric)))];
  const load = st?.phaseId === rule.program.phases[0].id && st.values?.load?.mode === 'absolute' ? st.values.load.value : rule.program.phases[0].parameters.load.value ?? 0;
  let prev = null;
  for (const s of stages) {
    const t = s.targets[oid];
    if (t.own === 'inherit' && prev?.own === 'set' && metrics.length) t.seed = Object.fromEntries(metrics.map(m => [m, m === 'load' ? load : 'copy']));
    if (s.kind === 'work') prev = t;
  }
  if (repair) ctx.summary.push({ kind: 'repair', programmeId: p.id, trackId: id, reason: repair });
  return { id, exerciseId: occ.exerciseId, slots: [{ rid, oid }], stages, refs: 'inherit', repair };
}

/**
 * A legacy programme `{ id, name, at, weeks, days | sequence, src? }` as a contract-1 definition.
 * `routines` are the profile's v2 routines, `catalogue` LIB_BY_ID; `customEx`, `progression` (the
 * ordinary tracks, for the seeds after a fixed week) and `weekStart` are the profile's own.
 * Notes for the adoption summary go to `summary`. A loop is bound to calendar weeks and marked
 * `needs: ['binding']`; what cannot be converted faithfully is kept, marked `needs: ['repair']`.
 */
export function convertLegacyProgramme(p, { routines = [], catalogue, customEx = [], progression = {}, weekStart = 1, summary = [] } = {}) {
  const ctx = { catalogue, customEx: list(customEx), progression: isObj(progression) ? progression : {}, summary };
  const weeks = list(p.weeks).slice(0, MAX_WEEKS).map(cleanWeek);
  if (!weeks.length) weeks.push(cleanWeek({}));
  const have = new Map(list(routines).map(r => [r.id, r]));
  const sequence = list(p.sequence).filter(x => typeof x === 'string' && x);
  const loop = sequence.some(x => x !== 'rest');
  const order = d => (d - weekStart + 7) % 7;
  // Weekdays in the week's own order, the day kept as a label; a loop's routines once per week, in its order.
  const appts = loop ? sequence.filter(rid => have.has(rid)).map(rid => ({ rid }))
    : Object.entries(isObj(p.days) ? p.days : {}).filter(([d]) => /^[0-6]$/.test(d)).sort(([a], [b]) => order(+a) - order(+b))
      .flatMap(([d, ids]) => [].concat(ids ?? []).filter(rid => have.has(rid)).map(rid => ({ rid, day: +d })));
  const needs = new Set(loop ? ['binding'] : []);
  // A routine kept out of progression never took programme targets (session-start.js noProg).
  let tracks = [...new Set(appts.map(a => a.rid))].filter(rid => have.get(rid).excludeFromProgression !== true)
    .flatMap(rid => list(have.get(rid).ex).map(occ => trackOf(p, rid, occ, weeks, ctx)));
  if (tracks.some(t => t.repair)) needs.add('repair');
  // ponytail: past 50 tracks the rest stay ordinary work until a repair (their targets kept in `src`); a merge would guess links.
  if (tracks.length > MAX_TRACKS) { needs.add('repair'); summary.push({ kind: 'repair', programmeId: p.id, reason: 'too-many-tracks', tracks: tracks.slice(MAX_TRACKS).map(t => t.id) }); tracks = tracks.slice(0, MAX_TRACKS); }
  const def = {
    id: p.id, name: String(p.name ?? '').trim().slice(0, 80), at: Number.isFinite(p.at) ? p.at : 0, rev: 1, ...(typeof p.src === 'string' ? { src: p.src } : {}),
    schedule: { mode: 'weeks', appts }, duration: { n: weeks.length, unit: 'weeks' }, end: 'stop', refs: 'inherit',
    tracks: tracks.map(({ repair, ...t }) => t)
  };
  // Nothing scheduled any more, or a conversion this build cannot run: archived, readable, pending repair.
  const check = needs.has('repair') ? { ok: true } : validateProgramme(def, { routines });
  const empty = !appts.length || !tracks.length;
  if (empty || !check.ok) { needs.add('repair'); summary.push({ kind: 'repair', programmeId: p.id, reason: empty ? 'empty' : check.errors[0] }); }
  if (loop) summary.push({ kind: 'binding', programmeId: p.id });
  // A programme waiting on a repair or a binding keeps its legacy source verbatim: no week or target is lost (spec 15.2, 16).
  return needs.size ? { ...def, src: copy(p), needs: [...needs] } : def;
}

// A repeated round's cumulative bump, on percentages only (spec 15.3), capped as lib/programmes.js did.
const bumped = (def, bump) => ({
  ...def, tracks: def.tracks.map(t => ({ ...t, stages: t.stages.map(s => ({ ...s, targets: Object.fromEntries(Object.entries(s.targets).map(([oid, x]) => [oid,
    x.own === 'set' ? { ...x, phase: { ...x.phase, parameters: { ...x.phase.parameters, load: { ...x.phase.parameters.load, percent: Math.min(PCT_MAX, x.phase.parameters.load.percent + bump) } } } } : x])) })) }))
});

/** The ordinary track's values its steps would carry on from: the run's captured seed. */
function seedOf(rule, st) {
  const ph = rule.program.phases[0];
  // ponytail: an ordinary track in a later phase (a ladder's loaded regime) seeds nothing; its stage opens at its own start.
  if (!st?.values || st.phaseId !== ph.id) return null;
  const seed = Object.fromEntries(ph.progression.map(op => op.metric).filter(m => st.values[m] != null).map(m => [m, copy(st.values[m])]));
  return Object.keys(seed).length ? seed : null;
}

/** The legacy run as a run of `def`, with its events (pause, this week's credits). */
function convertRun(s, legacyRun, def, ctx) {
  const { ws, tz, summary, events } = ctx;
  const S0 = legacyRun.startedOn, P = isDate(legacyRun.pausedOn) ? legacyRun.pausedOn : null;
  // No clock: "now" is the profile's newest date (a workout, the start, the pause).
  // A workout's day is the one the athlete logged it on (`d`, local), else its time in the run's zone:
  // the same frame for "now" and for this week's credits.
  const dayOfWorkout = w => (isDate(w?.d) ? w.d : Number.isFinite(w?.end ?? w?.start) ? dateIn(w.end ?? w.start, tz) : null);
  const A = [S0, P, ...list(s.workouts).map(dayOfWorkout)].filter(Boolean).sort().at(-1);
  // lib/programmes.js programmeStatus: the calendar week the run stands in, frozen at a pause.
  const at = P && P < A ? P : A;
  const week = Math.max(1, (weekStartOf(at, ws) - weekStartOf(S0, ws)) / 7 + 1);
  const n = def.duration.n, offset = Math.min(week - 1, n);
  const startedOn = week === 1 ? S0 : isoOf(weekStartOf(at, ws));
  const cycle = Math.max(1, Math.round(Number(legacyRun.cycle) || 1)), bump = Math.max(0, Number(legacyRun.bump) || 0);
  const id = `run:${def.id}:${S0}:${cycle}`;
  const runDef = bump ? bumped(def, bump) : copy(def);
  const appts = runDef.schedule.appts;
  // The first window owes the appointments from the start on: none before it is invented (spec 7.2).
  const from = dayOf(startedOn) - weekStartOf(startedOn, ws);
  const firstWeek = appts.map((a, i) => i).filter(i => appts[i].day == null || (appts[i].day - ws + 7) % 7 >= from);
  const tracks = {};
  for (const t of runDef.tracks) {
    const oid = t.slots[0].oid;
    const occ = s.routines.find(r => r.id === t.slots[0].rid).ex.find(o => o.occurrenceId === oid);
    const ref = t.stages.some(st => st.targets[oid]?.own === 'set') || needsOneRm(occ.rule) ? currentOneRm(s.oneRepMaxes, t.exerciseId) : undefined;
    if (ref !== undefined) summary.push(ref ? { kind: 'reference', runId: id, trackId: t.id, exerciseId: t.exerciseId, ref: copy(ref) } : { kind: 'reference-missing', runId: id, trackId: t.id, exerciseId: t.exerciseId });
    const seed = seedOf(occ.rule, s.progression[oid]);
    // Config may preselect the reference preference (spec 6.1); it is no acceptance of anything.
    tracks[t.id] = { policy: { ...LEGACY }, ack: 'legacy', refs: s.refUpdates === 'keep' ? 'keep' : 'ask', ...(ref ? { ref: copy(ref) } : {}), ...(seed ? { seed: { [oid]: seed } } : {}) };
  }
  const run = { id, programmeId: def.id, def: runDef, startedOn, weekStart: ws, tz, at: A, end: 'stop', cycle, bump, firstWeek, tracks, legacy: { weekOffset: offset } };
  summary.push({ kind: 'legacy-choices', runId: id, policy: { ...LEGACY }, end: 'stop' });
  const own = {};
  if (P) own[`${id}:pause`] = { id: `${id}:pause`, runId: id, type: 'pause', at: P < startedOn ? startedOn : P };
  // This week's sessions logged before the upgrade fill its appointments, each once, earliest first
  // (spec 15.3): only work linked to a bound occurrence and its routine, never a paused or ended run's.
  if (!P && week <= n) {
    const taken = new Set();
    const xs = list(s.workouts).filter(w => dayOfWorkout(w) >= startedOn && dayOfWorkout(w) <= A).flatMap(w => list(w.exposures))
      .filter(x => !x.programme && !x.excludedFromProgression && s.prescriptions[x.prescriptionId] && typeof x.completedAt === 'string')
      .sort((a, b) => cmp(a.completedAt, b.completedAt) || cmp(a.exposureId, b.exposureId));
    for (const x of xs) {
      const track = runDef.tracks.find(t => t.slots.some(sl => sl.oid === x.occurrenceId && sl.rid === x.routineId));
      const a = track && firstWeek.find(i => appts[i].rid === x.routineId && !taken.has(`${i}:${x.occurrenceId}`));
      if (a == null) continue;
      taken.add(`${a}:${x.occurrenceId}`);
      const slot = `p1:a${a}:${x.occurrenceId}`;
      own[`${id}:assign:${x.exposureId}`] = { id: `${id}:assign:${x.exposureId}`, runId: id, type: 'assign', at: x.completedAt, exposureId: x.exposureId, slot };
      summary.push({ kind: 'credit', runId: id, trackId: track.id, exposureId: x.exposureId, slot });
    }
  }
  // Read-back: the run replays, and every credit lands on its slot.
  const view = deriveRun({ run, events: Object.values(own), workouts: s.workouts, prescriptions: s.prescriptions, today: A, routines: s.routines });
  for (const e of Object.values(own)) if (e.type === 'assign' && !Object.values(view.tracks).some(tv => tv.slots.some(x => x.exposureId === e.exposureId))) throw new Error(`invalid-upgrade credit ${e.exposureId}`);
  Object.assign(events, own);
  return run;
}

/**
 * Upgrade a canonical (v2) profile to contract 1: `S.programmes` as engine definitions, a running
 * `S.programme` as `S.programmeRuns[runId]` with `S.programme = { runId, saved }`, occurrences whose
 * own rule needs a 1RM given their adopted reference. `summary` feeds the adoption notice.
 * A contract-1 profile comes back as it is; an output that does not validate throws, the input untouched.
 */
export function upgradeEngineContract(state, catalogue) {
  if (contractOf(state) >= ENGINE_CONTRACT) return { state, summary: [] };
  if (state?.engineSchemaVersion !== ENGINE_SCHEMA) throw new Error('upgrade-needs-v2');
  if (typeof catalogue?.get !== 'function') throw new Error('upgrade-needs-catalogue');
  const summary = [], events = {}, runs = {};
  // Occurrences are the one thing changed in place: copied before a reference is written.
  const routines = list(state.routines).map(r => ({ ...r, ex: list(r.ex).map(occ => {
    if (!needsOneRm(occ.rule) || occ.ref) return occ;
    const ref = currentOneRm(state.oneRepMaxes, occ.exerciseId);
    summary.push(ref ? { kind: 'reference', occurrenceId: occ.occurrenceId, exerciseId: occ.exerciseId, ref: copy(ref) } : { kind: 'reference-missing', occurrenceId: occ.occurrenceId, exerciseId: occ.exerciseId });
    return ref ? { ...occ, ref: copy(ref) } : occ;
  }) }));
  const s = { ...state, routines };
  const ws = state.weekStart === 0 ? 0 : 1;
  const ctx = { routines, catalogue, customEx: state.customEx, progression: state.progression, weekStart: ws, summary };
  // Entries lib/programmes.js already ignored (no id) have nothing to convert; the caller's backup keeps them.
  const programmes = {};
  for (const [pid, p] of Object.entries(isObj(state.programmes) ? state.programmes : {})) {
    if (isObj(p) && typeof p.id === 'string' && p.id) programmes[pid] = convertLegacyProgramme({ ...p, id: pid }, ctx);
  }
  let selector = state.programme ?? null;
  if (isObj(selector)) {
    const def = programmes[selector.id];
    const saved = isObj(selector.saved) ? copy(selector.saved) : null;
    // A run whose programme is gone keeps only the plan to put back, as lib/programmes.js did.
    if (!def || !isDate(selector.startedOn)) selector = { runId: null, saved };
    else {
      const run = convertRun(s, selector, def, { ws, tz: zoneOf(state.reminder?.tz), summary, events });
      runs[run.id] = run;
      selector = { runId: run.id, saved };
    }
  }
  const out = { ...s, engineContractRevision: ENGINE_CONTRACT };
  if ('programmes' in state) out.programmes = programmes;
  if ('programme' in state) out.programme = selector;
  if (Object.keys(runs).length) out.programmeRuns = runs;
  if (Object.keys(events).length) out.programmeEvents = events;
  const check = validateCanonicalProfile(out);
  if (!check.ok) throw new Error(`invalid-upgrade ${check.errors[0]}`);
  // Packed as it travels (profile-size.js), from copies of the lists: pack's identity cache must never hold the caller's own.
  assertSyncSize({ ...out, workouts: [...list(out.workouts)], prescriptions: { ...out.prescriptions } });
  return { state: out, summary };
}
