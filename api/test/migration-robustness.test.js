// Robustness of the v1 → v2 migration: seeded generators drive the invariants that must hold for
// ANY v1 document (well-formed, hand-edited or corrupted), plus the rarest edge cases by name.
// Everything is deterministic (fixed seeds): a failure prints the seed to replay it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrescription, resolveProgressionContext } from '../engine/index.js';
import { migrateProfileV1ToV2, migrationStatus, validateCanonicalActive, validateCanonicalProfile } from '../migration/profile-migration.js';
import { packProfile, unpackProfile } from '../migration/profile-pack.js';
import { assertSyncSize } from '../migration/profile-size.js';
import { LIB_BY_ID } from '../coach/core/library.js';

const clone = v => JSON.parse(JSON.stringify(v));
const migrate = state => migrateProfileV1ToV2(clone(state), LIB_BY_ID);

/* ---------- seeded randomness ---------- */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = arr => arr[int(0, arr.length - 1)];
  const chance = p => next() < p;
  return { next, int, pick, chance };
}

/* ---------- v1 generators ---------- */
const BY_EQ = {};
for (const e of LIB_BY_ID.values()) (BY_EQ[e.eq] ??= []).push(e.id);
const EXERCISES = [
  '0025', '0026', '0009', '3220', '0001', '3293', '0011', ...BY_EQ['dumbbell'].slice(0, 3), ...BY_EQ['cable'].slice(0, 2),
  ...BY_EQ['kettlebell'].slice(0, 2), ...BY_EQ['band'].slice(0, 2), ...BY_EQ['stability ball'].slice(0, 2), ...BY_EQ['sled machine'].slice(0, 1),
  ...BY_EQ['smith machine'].slice(0, 1), ...BY_EQ['trap bar'], ...BY_EQ['weighted'].slice(0, 2), ...BY_EQ['stationary bike'], 'custom-1', 'custom-2'
];
const POLICIES = ['linear', 'greyskull', 'double', 'time', 'off', undefined, 'weird', 'LINEAR', ''];

function genProfile(r, { corrupt = false } = {}) {
  const unit = r.pick(['kg', 'kg', 'lb']);
  const nRoutines = r.int(0, 4);
  const routines = Array.from({ length: nRoutines }, (_, i) => ({
    id: r.chance(0.9) ? `r${i}` : r.pick([i, `r${i % 2}`, `weird id ${i}`, '__proto__', 'constructor']),
    name: `Routine ${i}`, ...(r.chance(0.3) ? { prog: r.pick(POLICIES) } : {}), ...(r.chance(0.1) ? { excludeFromProgression: true } : {}),
    ex: Array.from({ length: r.int(0, 6) }, () => {
      const id = r.pick(EXERCISES);
      const mode = r.chance(0.12) ? r.pick(['time', 'cardio', 'reps', 'bogus']) : undefined;
      return {
        id, ...(mode ? { mode } : {}),
        sets: r.chance(0.9) ? r.int(1, 6) : r.pick([0, -1, 2.5, '3', null, 1e6, 'x']),
        reps: r.chance(0.85) ? r.int(1, 30) : r.pick([0, null, '8', 8.5, -3]),
        ...(r.chance(0.3) ? { repsMin: r.int(1, 12) } : {}), ...(r.chance(0.2) ? { repsMax: r.int(10, 40) } : {}),
        ...(r.chance(0.8) ? { weight: r.pick([0, 20, 22.5, 47, 52, 60, 100.1, 8.75, 0.5, 1000]) } : {}),
        ...(r.chance(0.3) ? { prog: r.pick(POLICIES) } : {}), ...(r.chance(0.25) ? { inc: r.pick([1.25, 2.5, 5, 0.5, 0, -1, '2', 0.3]) } : {}),
        ...(r.chance(0.2) ? { sec: r.int(10, 120) } : {}), ...(r.chance(0.15) ? { min: r.int(5, 40), speed: r.int(4, 14) } : {}),
        ...(r.chance(0.3) ? { warmupSets: r.pick([0, 1, 2, 3, 5, 99, -1, 'a']) } : {}), ...(r.chance(0.1) ? { side: true } : {}),
        ...(r.chance(0.1) ? { assisted: r.chance(0.5) } : {}), ...(r.chance(0.1) ? { bodyweight: r.chance(0.5) } : {}),
        ...(r.chance(0.1) ? { deloadFactor: r.pick([0.9, 0.5, 1.5, -1, 'x', false]) } : {}),
        ...(r.chance(0.1) ? { intensifier: r.pick([{ type: 'dropset', count: 2, pct: 20 }, { type: 'restpause', totalReps: 10, restSec: 15 }, { type: 'x' }, false, 5]) } : {}),
        ...(r.chance(0.1) ? { excludeFromProgression: true } : {}), ...(r.chance(0.1) ? { restSec: r.int(0, 300) } : {}), ...(r.chance(0.1) ? { note: 'n' } : {})
      };
    })
  }));
  const customEx = r.chance(0.5) ? [{ id: 'custom-1', n: 'Mine', bp: 'back', eq: 'barbell' }, { id: 'custom-2', n: 'Run', bp: 'cardio', eq: 'body weight' }] : [];
  const nWorkouts = r.int(0, 14);
  const workouts = Array.from({ length: nWorkouts }, (_, i) => genWorkout(r, i, routines, unit));
  const state = {
    unit, restSec: r.pick([90, 0, 180, null, '60']), _rev: r.int(0, 50), _ts: r.int(0, 99), week: { 1: routines[0]?.id }, exWeights: { '0025': 60 },
    bodyweight: r.chance(0.5) ? [{ d: '2026-01-01', w: 80 }] : [], customEx, routines, workouts, settings: { theme: 'dark' },
    ...(r.chance(0.2) ? { coach: { snapshots: [{ proposalId: 'p', week: { 1: 'r0' }, routines: clone(routines.slice(0, 2)) }] } } : {})
  };
  if (r.chance(0.3)) state.active = genWorkout(r, 99, routines, unit, true);
  return clone(state);
}

function genRow(r, kind) {
  const base = { done: r.chance(0.88) };
  if (kind === 'time') return { ...base, sec: r.int(5, 120) };
  if (kind === 'cardio') return { ...base, min: r.int(1, 60), speed: r.int(3, 15) };
  const row = { ...base, r: r.pick([r.int(1, 25), 0, null, '8', 5.5]), w: r.pick([r.int(0, 140), 21.3, 47, 52.5, 0, null, 1e5, -5, '60']) };
  if (r.chance(0.15)) row.phase = 'warmup';
  else if (r.chance(0.05)) row.warmup = true;
  if (r.chance(0.1)) row.rir = r.int(0, 5);
  if (r.chance(0.1)) row.rpe = r.pick([6, 7.5, 9, 10, 11, 0]);
  if (r.chance(0.07)) { row.type = 'dropset'; row.drops = [{ w: 40, r: 8 }, { w: 30, r: 10 }].slice(0, r.int(0, 2)); }
  if (r.chance(0.05)) { row.type = 'restpause'; row.clusters = [{ r: 5 }, { r: 3 }]; }
  if (r.chance(0.07)) row.sides = { L: { r: r.int(1, 12), w: row.w, done: r.chance(0.8) }, R: { r: r.int(1, 12), w: row.w, done: r.chance(0.8) } };
  return row;
}

function genWorkout(r, i, routines, unit, active = false) {
  const day = String(1 + (i % 28)).padStart(2, '0');
  const d = r.chance(0.96) ? `2026-0${1 + Math.floor(i / 28) % 9}-${day}` : r.pick(['', '2026-1-5', '05/01/2026', 'garbage', null]);
  const routine = routines.length ? r.pick(routines) : null;
  const combined = routines.length > 1 && r.chance(0.15);
  const entries = Array.from({ length: r.int(0, 5) }, () => {
    const cfg = routine && routine.ex.length && r.chance(0.8) ? r.pick(routine.ex) : null;
    const id = cfg ? cfg.id : r.pick(EXERCISES);
    const mode = cfg?.mode === 'time' || cfg?.mode === 'cardio' ? cfg.mode : LIB_BY_ID.get(id)?.bp === 'cardio' ? 'cardio' : 'reps';
    const nSets = r.int(0, 6);
    const sets = Array.from({ length: nSets }, () => genRow(r, mode));
    const entry = { id, sets };
    if (cfg && r.chance(0.8)) entry.target = { mode, sets: cfg.sets, reps: cfg.reps, weight: r.pick([cfg.weight, 62.5, 52.5, 21.3, 0]), ...(mode === 'time' ? { sec: 45 } : {}), ...(mode === 'cardio' ? { min: 20, speed: 8 } : {}) };
    if (cfg && entry.target && r.chance(0.5)) entry.planned = { sets: cfg.sets, reps: cfg.reps };
    if (cfg && (combined || r.chance(0.2))) entry.rid = routine.id;
    if (r.chance(0.04)) entry.noProg = true;
    if (r.chance(0.05)) { delete entry.sets; entry.topW = r.pick([60, 0, null]); }
    if (r.chance(0.05)) entry.note = ' remember ';
    return entry;
  });
  const start = Date.parse(`2026-01-01T18:00:00Z`) + i * 86400000;
  return {
    id: r.chance(0.95) ? `w${i}` : r.pick(['w1', null, 12, '']), d, start, end: start + 3600000,
    ...(routine && r.chance(0.9) ? { routineIds: combined ? [routine.id, routines[0].id] : [routine.id], routineId: routine.id } : {}),
    name: 'W', bw: 80, entries, ...(active ? { cur: r.int(-1, 6) } : {}), ...(r.chance(0.05) ? { excludeFromProgression: true } : {})
  };
}

/* ---------- corruption: replace random leaves/containers with junk ---------- */
const JUNK = [null, '', 'x', '12', -1, 0, 1e308, 1e9, 0.1, true, false, [], {}, [null], { a: 1 }, 'NaN', ' ', '2026-01-01', '__proto__', 9007199254740993];
function corruptions(r, state, n) {
  const paths = [];
  const walk = (v, path) => { if (v && typeof v === 'object') for (const k of Object.keys(v)) { paths.push([...path, k]); walk(v[k], [...path, k]); } };
  walk(state, []);
  const out = clone(state);
  for (let i = 0; i < n && paths.length; i++) {
    const path = r.pick(paths);
    let node = out;
    for (const k of path.slice(0, -1)) { if (node?.[k] == null || typeof node[k] !== 'object') { node = null; break; } node = node[k]; }
    if (!node) continue;
    const last = path[path.length - 1];
    if (r.chance(0.15)) { if (Array.isArray(node)) node.splice(Number(last), 1); else delete node[last]; } else node[last] = clone(r.pick(JUNK));
  }
  return clone(out);
}

/* ---------- the invariants ---------- */
const deepFrozen = v => { if (v && typeof v === 'object') { Object.freeze(v); Object.values(v).forEach(deepFrozen); } return v; };
const nonFinite = (v, at = '$') => {
  if (typeof v === 'number') return Number.isFinite(v) ? null : at;
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { const hit = nonFinite(x, `${at}.${k}`); if (hit) return hit; }
  return null;
};

function checkInvariants(input, label) {
  let status;
  try { status = migrationStatus(input); } catch { return 'rejected'; }          // refused up front: nothing to convert
  if (!status.required) return 'v2';
  const before = JSON.stringify(input);
  const frozen = deepFrozen(clone(input));                                       // a mutation of the input throws
  let out;
  try { out = migrateProfileV1ToV2(frozen, LIB_BY_ID); }
  catch (e) { assert.fail(`${label}: migration threw ${e.stack}`); }
  assert.equal(JSON.stringify(input), before, `${label}: input mutated`);
  const { profile, activeSession } = out;
  const check = validateCanonicalProfile(profile);
  assert.ok(check.ok, `${label}: invalid profile: ${check.errors.slice(0, 3).join(' | ')}`);
  const activeCheck = validateCanonicalActive(profile, activeSession);
  assert.ok(activeCheck.ok, `${label}: invalid active: ${activeCheck.errors.slice(0, 3).join(' | ')}`);
  assert.equal(nonFinite(profile), null, `${label}: non-finite number in profile`);
  assert.equal(nonFinite(activeSession), null, `${label}: non-finite number in active`);
  // Stored form: serialisation loses nothing (no undefined, NaN, Date, Map…).
  assert.deepEqual(JSON.parse(JSON.stringify(profile)), profile, `${label}: profile does not survive JSON`);
  assert.deepEqual(JSON.parse(JSON.stringify(activeSession)), activeSession, `${label}: active does not survive JSON`);
  // Deterministic, and a second pass is a no-op.
  assert.equal(JSON.stringify(migrate(input)), JSON.stringify(out), `${label}: not deterministic`);
  assert.equal(migrateProfileV1ToV2(profile, LIB_BY_ID).profile, profile, `${label}: v2 not returned as is`);
  // The compact wire form is lossless.
  assert.deepEqual(unpackProfile(JSON.parse(JSON.stringify(packProfile(profile)))), profile, `${label}: pack/unpack differs`);
  assert.ok(validateCanonicalProfile(unpackProfile(packProfile(profile))).ok, `${label}: unpacked profile invalid`);
  // Nothing is dropped silently at the top level.
  assert.equal(profile.workouts.length, (input.workouts || []).filter(w => w && typeof w === 'object' && !Array.isArray(w)).length, `${label}: workouts count`);
  assert.equal(profile.routines.length, (input.routines || []).filter(w => w && typeof w === 'object' && !Array.isArray(w)).length, `${label}: routines count`);
  for (const k of Object.keys(input)) if (!['active', 'routines', 'workouts', 'unit', 'prescriptions', 'oneRepMaxes', 'progression', 'coach', 'engineSchemaVersion', 'packed', 'templates'].includes(k) && k !== '__proto__') assert.deepEqual(profile[k], input[k], `${label}: root key ${k} not kept`);
  // The first session after the upgrade can always be generated.
  for (const routine of profile.routines) for (const occ of routine.ex) {
    const ctx = resolveProgressionContext({ trackId: occ.occurrenceId, exerciseId: occ.exerciseId, rule: occ.rule, workouts: profile.workouts, prescriptions: profile.prescriptions, progression: profile.progression, assisted: false });
    let p;
    try {
      p = generatePrescription({ id: 'next', now: '2026-06-01T00:00:00.000Z', trackId: occ.occurrenceId, rule: occ.rule, state: ctx.state, lastPrescription: ctx.lastPrescription,
        lastLog: ctx.baseline && { ...ctx.baseline, id: ctx.baseline.exposureId }, reset: ctx.reset, heldLoad: ctx.heldLoad });
    } catch (e) { assert.fail(`${label}: no next prescription for ${occ.occurrenceId}: ${e.message}`); }
    assert.equal(nonFinite(p), null, `${label}: non-finite next prescription for ${occ.occurrenceId}`);
    assert.ok(p.rows.length >= 1 && p.rows.length <= 60, `${label}: ${p.rows.length} rows for ${occ.occurrenceId}`);
  }
  return 'migrated';
}

// FUZZ_N=<n> (and FUZZ_HARD=<max corruptions>) widen the search: `FUZZ_N=8000 FUZZ_HARD=60 node --test test/migration-robustness.test.js`.
test('fuzz: realistic v1 profiles hold every invariant', () => {
  const seen = { migrated: 0, rejected: 0, v2: 0 };
  for (let seed = 1; seed <= (Number(process.env.FUZZ_N) || 150); seed++) seen[checkInvariants(genProfile(rng(seed)), `seed ${seed}`)]++;
  assert.ok(seen.migrated > 0.9 * (seen.migrated + seen.rejected + seen.v2), JSON.stringify(seen));   // the run really exercises the migration
});

test('fuzz: corrupted v1 profiles never throw and never produce an invalid document', () => {
  const seen = { migrated: 0, rejected: 0, v2: 0 };
  for (let seed = 1; seed <= (Number(process.env.FUZZ_N) * 2.5 || 400); seed++) {
    const r = rng(seed * 7919);
    seen[checkInvariants(corruptions(r, genProfile(r), r.int(1, Number(process.env.FUZZ_HARD) || 12)), `corrupt seed ${seed}`)]++;
  }
  // Heavy corruption turns a list into a non-list now and then, which is refused up front: that is the expected remainder.
  assert.ok(seen.migrated > (process.env.FUZZ_HARD ? 0.5 : 0.9) * (seen.migrated + seen.rejected + seen.v2), JSON.stringify(seen));
});

/* ======================= named edge cases ======================= */
const BENCH = '0025', SQUAT = '0026', DIP = '0009', CARDIO = '3220', SITUP = '0001';
const row = (r, w, extra = {}) => ({ r, w, done: true, ...extra });
const v1 = (over = {}) => ({ unit: 'kg', restSec: 90, routines: [], workouts: [], ...over });
const plan = (ex, over = {}) => ({ id: 'r1', name: 'R', ex: [ex], ...over });
const session = (id, entries, over = {}) => ({ id, d: '2026-01-05', start: Date.UTC(2026, 0, 5, 18), end: Date.UTC(2026, 0, 5, 19), routineIds: ['r1'], routineId: 'r1', name: 'W', entries, ...over });
const entryOf = (id, target, sets, extra = {}) => ({ id, rid: 'r1', target: { mode: 'reps', ...target }, sets, ...extra });
// Migrates, holds every invariant, and hands back the result.
const run = (state, label = 'case') => { state = clone(state); assert.equal(checkInvariants(state, label), 'migrated', label); return migrate(state); };

test('shape: an empty or list-less v1 document migrates to a valid empty v2 profile', () => {
  for (const [label, state] of [['{}', {}], ['null lists', { routines: null, workouts: null }], ['unit only', { unit: 'lb' }], ['junk lists', { routines: [null, 1, 'x', []], workouts: [null, 2, [], 'y'] }]]) {
    const { profile, activeSession } = run(state, label);
    assert.equal(activeSession, null, label);
    assert.deepEqual([profile.routines.length, profile.workouts.length], [state.routines?.filter(r => r && typeof r === 'object' && !Array.isArray(r)).length || 0, 0], label);
  }
});

test('shape: what is not a v1 profile is refused up front, never half-converted', () => {
  for (const bad of [null, undefined, [], 'x', 5, true]) assert.throws(() => migrateProfileV1ToV2(bad, LIB_BY_ID), /profile-not-an-object/);
  assert.throws(() => migrate({ routines: {} }), /invalid-v1-routines/);
  assert.throws(() => migrate({ workouts: 'x' }), /invalid-v1-workouts/);
  assert.throws(() => migrate({ engineSchemaVersion: 3 }), /unsupported-schema/);
  assert.throws(() => migrate({ engineSchemaVersion: 2.5 }), /unsupported-schema/);
  assert.throws(() => migrateProfileV1ToV2(v1(), null), /migration-needs-catalogue/);
  assert.throws(() => migrateProfileV1ToV2(v1(), {}), /migration-needs-catalogue/);
});

test('shape: a schema marker that is not a usable number reads as v1 and is overwritten', () => {
  for (const marker of ['2', 'abc', null, true, 0, -3, 1.5, [], {}]) {
    const { profile } = run(v1({ engineSchemaVersion: marker }), `marker ${JSON.stringify(marker)}`);
    assert.equal(profile.engineSchemaVersion, 2);
  }
});

test('shape: a v1 unit that is not kg/lb falls back to kg, with an in-progress workout too (M13)', () => {
  for (const unit of ['KG', 'lbs', '', 5, null, [], 'pounds']) {
    const { profile, activeSession } = run(v1({ unit, routines: [plan({ id: BENCH, sets: 3, reps: 5, weight: 60 })], active: session('a', [entryOf(BENCH, { sets: 3, reps: 5, weight: 60 }, [row(5, 60)])]) }), `unit ${JSON.stringify(unit)}`);
    assert.equal(profile.unit, 'kg');
    assert.equal(profile.prescriptions[activeSession.exposures[0].prescriptionId].rows[0].load.unit, 'kg');
  }
});

test('keys: __proto__ / constructor as ids and as JSON keys pollute nothing and convert', () => {
  const state = JSON.parse(`{"__proto__":{"polluted":1},"unit":"kg","routines":[{"id":"__proto__","name":"x","ex":[{"id":"constructor","sets":3,"reps":5,"weight":60},{"id":"__proto__","sets":3,"reps":5}]},{"id":"constructor","ex":[{"id":"toString"}]}],
    "workouts":[{"id":"__proto__","d":"2026-01-05","start":1767636000000,"routineIds":["__proto__"],"entries":[{"id":"constructor","rid":"__proto__","target":{"sets":3,"reps":5,"weight":60,"__proto__":{"polluted":2}},"sets":[{"r":5,"w":60,"done":true}]},{"id":"__proto__","sets":[{"r":5,"w":60,"done":true}]}]},{"id":"constructor","entries":[]}],
    "exWeights":{"__proto__":5,"constructor":6},"customEx":[{"id":"__proto__","n":"x","bp":"back","eq":"barbell"}]}`);
  const { profile } = run(state, 'proto');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(profile.workouts.length, 2);
  assert.equal(profile.routines[0].ex.length, 2);
});

test('ids: numeric, colliding, empty and non-scalar ids get unique deterministic ones', () => {
  const state = v1({
    routines: [plan({ id: BENCH, sets: 3, reps: 5 }, { id: 1 }), plan({ id: BENCH, sets: 3, reps: 5 }, { id: '1' }), plan({ id: BENCH, sets: 3, reps: 5 }, { id: [] }), plan({ id: BENCH, sets: 3, reps: 5 }, { id: {} }), plan({ id: BENCH }, { id: '' }), plan({ id: BENCH }, {})],
    workouts: [1, '1', null, [], {}, 'w', 'w', 'w~2', 'w'].map((id, i) => ({ id, d: '2026-01-05', start: 1000 + i, entries: [{ id: BENCH, sets: [row(5, 60)] }] }))
  });
  const { profile } = run(state, 'ids');
  assert.equal(new Set(profile.routines.map(r => r.id)).size, 6);
  assert.equal(new Set(profile.workouts.map(w => w.id)).size, 9);
  assert.equal(new Set(profile.workouts.flatMap(w => w.exposures.map(x => x.exposureId))).size, 9);
  assert.equal(new Set(profile.routines.flatMap(r => r.ex.map(o => o.occurrenceId))).size, 6);
});

test('ids: an exercise id that is an array / object / boolean is not an exercise and is audited', () => {
  const state = v1({ routines: [{ id: 'r1', ex: [{ id: [], sets: 3 }, { id: {}, sets: 3 }, { id: true }, { id: BENCH, sets: 3, reps: 5 }] }],
    workouts: [session('w1', [{ id: [], sets: [row(5, 60)] }, { id: { a: 1 }, sets: [row(5, 60)] }, entryOf(BENCH, { sets: 3, reps: 5 }, [row(5, 60)])])] });
  const { profile } = run(state, 'bad exercise ids');
  assert.equal(profile.routines[0].ex.length, 1);
  assert.equal(profile.workouts[0].exposures.length, 1);
  assert.ok(profile.migrationAudit.discarded.length >= 5);
});

test('dates: every unrepresentable day/start/end converts, is audited, and every output date is a real ISO instant', () => {
  const days = ['2026-02-30', '2026-13-01', '0000-01-01', '+275760-09-13', '9999-12-31', '-000001-01-01', '2026-01-05T10:00', '', '  ', 'x', 5, true, [], {}];
  const stamps = [-1, 0, 1e15, 8.64e15, 8.64e15 + 1, 1e308, '1767636000000', 'abc', NaN, true, [], {}, -8.64e15 - 1];
  for (const d of days) for (const s of stamps) {
    const state = v1({ routines: [plan({ id: BENCH, sets: 3, reps: 5 })], workouts: [session('w', [entryOf(BENCH, { sets: 3, reps: 5 }, [row(5, 60)])], { d, start: s, end: s })], active: session('a', [], { d, start: s }) });
    const { profile, activeSession } = run(state, `d=${JSON.stringify(d)} s=${JSON.stringify(s)}`);
    for (const x of profile.workouts[0].exposures) assert.ok(Number.isFinite(Date.parse(x.completedAt)), `completedAt ${x.completedAt}`);
    for (const p of Object.values(profile.prescriptions)) assert.ok(Number.isFinite(Date.parse(p.generatedAt)));
    assert.ok(activeSession == null || Number.isFinite(Date.parse(activeSession.exposures[0]?.completedAt ?? '2026-01-01')));
  }
});

test('dates: workouts out of order, same-day and undated sessions are replayed oldest first and stably', () => {
  const mk = (id, d, start) => session(id, [entryOf(BENCH, { sets: 3, reps: 5, weight: 60 }, [row(5, 60), row(5, 60), row(5, 60)])], { d, start, end: start + 1 });
  const state = v1({ routines: [plan({ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' })], workouts: [mk('c', '2026-01-09', 3), mk('a', '2026-01-01', 1), mk('b', '2026-01-05', 2), mk('b2', '2026-01-05', 2), mk('u', undefined, undefined)] });
  const { profile } = run(state, 'order');
  const days = profile.workouts.map(w => w.d);
  assert.deepEqual(profile.workouts.slice(-1)[0].id, 'c');
  assert.equal(profile.progression['r1:o0'].lastCompletedLogId, 'c:x0');
  assert.ok(days.length === 5);
});

test('numbers: absurd, negative, fractional and stringly counts/loads/times convert without overflow', () => {
  const nums = [0, -1, -0, 0.5, 1e-9, 1e12, 1e15, 1e16, 1e300, 1.7976931348623157e308, '1e3', ' 7 ', '0x10', '', 'abc', null, true, [], {}, [5]];
  for (const n of nums) {
    const label = `n=${JSON.stringify(n)}`;
    const state = v1({ restSec: n, routines: [plan({ id: BENCH, sets: n, reps: n, repsMin: n, repsMax: n, weight: n, inc: n, sec: n, min: n, speed: n, restSec: n, warmupSets: n, deloadFactor: n, prog: 'double' })],
      workouts: [session('w', [entryOf(BENCH, { sets: n, reps: n, weight: n }, [row(n, n, { rir: n, rpe: n }), { r: n, w: n, done: true, sides: { L: row(n, n), R: row(n, n) } }, { min: n, sec: n, speed: n, done: true }], { topW: n })], { vol: n, bw: n })] });
    run(state, label);
  }
});

test('numbers: sets are capped at the engine maximum and the clamp is not silent (M8)', () => {
  const { profile } = run(v1({ routines: [plan({ id: BENCH, sets: 1e12, reps: 5, weight: 60 })] }), 'sets cap');
  assert.equal(profile.routines[0].ex[0].rule.parameters.sets.max, 50);
  assert.deepEqual(profile.migrationAudit.unsupported.map(u => [u.occurrenceId, u.field, u.value]), [['r1:o0', 'sets', 1e12]]);
  // At the limit nothing is clamped, so nothing is reported.
  assert.deepEqual(run(v1({ routines: [plan({ id: BENCH, sets: 50, reps: 5, weight: 60 })] }), 'sets at cap').profile.migrationAudit.unsupported, []);
});

test('rows: every logged row survives — count, role, status, load, reps (well-formed input)', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const input = genProfile(rng(seed));
    const ids = (input.workouts || []).map(w => w.id);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) continue;   // matched by id below
    const { profile } = migrate(input);
    const outWorkouts = new Map(profile.workouts.map(w => [w.id, w]));
    (input.workouts || []).forEach((w, i) => {
      const out = profile.workouts.find(o => o.exposures.length === (w.entries || []).filter(e => e && typeof e === 'object' && e.id != null && e.id !== '').length && o.id.startsWith(String(w.id ?? `m1-w${i}`)));
      const valid = (w.entries || []).filter(e => e && typeof e === 'object' && e.id != null && e.id !== '');
      assert.ok(out, `seed ${seed}: workout ${i} found`);
      valid.forEach((e, j) => {
        const rows = (e.sets === undefined && e.topW > 0 ? [{ w: e.topW, done: true }] : e.sets || []).filter(r => r && typeof r === 'object');
        const got = out.exposures[j].performance.sets;
        const expected = rows.reduce((n, r) => n + (r.sides?.L && r.sides?.R && typeof r.sides.L === 'object' && typeof r.sides.R === 'object' ? 2 : 1), 0);
        assert.equal(got.length, expected, `seed ${seed} workout ${i} entry ${j}: row count`);
        const done = rows.filter(r => r.done && !r.sides).length;
        assert.equal(got.filter(r => r.status === 'completed' && !r.side).length, done, `seed ${seed} workout ${i} entry ${j}: completed rows`);
      });
    });
    assert.ok(outWorkouts.size > 0 || !(input.workouts || []).length);
  }
});

test('root: v2-owned keys already present on a v1 document cannot break it or its wire form', () => {
  const junk = [
    { prescriptions: { 'w1:p0': { junk: true } } }, { prescriptions: 'x' }, { prescriptions: [] },
    { progression: { 'r1:o0': { trackId: 'other' } } }, { progression: 5 }, { oneRepMaxes: { a: { bad: true } } }, { oneRepMaxes: [] },
    { migrationAudit: 'x' }, { migrationAudit: { unsupported: 'x' } }, { packed: 1 }, { packed: 1, templates: { a: { x: 1 } } }, { templates: {} },
    { _rev: 'x' }, { _rev: -5 }, { _rev: 1.5 }, { _ts: 'x' }
  ];
  for (const over of junk) {
    const label = JSON.stringify(over);
    const state = v1({ routines: [plan({ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' })], workouts: [session('w1', [entryOf(BENCH, { sets: 3, reps: 5, weight: 60 }, [row(5, 60), row(5, 60), row(5, 60)])])], ...over });
    const { profile } = migrate(state);
    const check = validateCanonicalProfile(profile);
    assert.ok(check.ok, `${label}: ${check.errors[0]}`);
    assert.deepEqual(unpackProfile(JSON.parse(JSON.stringify(packProfile(profile)))), profile, `${label}: wire round trip`);
  }
});

test('active: cursors, empty drafts, dangling edit targets and entries sharing the saved workout id', () => {
  const base = { routines: [plan({ id: BENCH, sets: 3, reps: 5, weight: 60 })] };
  const e = entryOf(BENCH, { sets: 3, reps: 5, weight: 60 }, [row(5, 60), { r: null, w: null, done: false }]);
  for (const cur of [undefined, null, -1, 0, 1, 2, 99, 1.5, '1', NaN, 1e15]) {
    const { activeSession } = run(v1({ ...base, active: session('a', [e, e, e], { cur }) }), `cur ${JSON.stringify(cur)}`);
    assert.ok(Number.isInteger(activeSession.cur) && activeSession.cur >= 0 && activeSession.cur < 3);
  }
  for (const [label, active] of [['no entries', session('a', [])], ['entries not a list', session('a', 'x')], ['all invalid', session('a', [null, {}, { id: '' }, 5])], ['edit of nothing', session('a', [e], { editingWorkoutId: 'ghost' })], ['same id as a saved workout', session('w1', [e])], ['id null', session(null, [e])], ['no routine', session('a', [e], { routineIds: [], routineId: null })]]) {
    const { activeSession } = run(v1({ ...base, workouts: [session('w1', [e])], active }), label);
    assert.equal(validateCanonicalActive(migrate(v1({ ...base, workouts: [session('w1', [e])], active })).profile, activeSession).ok, true, label);
  }
});

test('active: a non-object active is dropped without blocking the migration', () => {
  for (const active of [null, 5, 'x', [], [1], true]) {
    const { activeSession } = run(v1({ routines: [plan({ id: BENCH, sets: 3, reps: 5 })], active }), `active ${JSON.stringify(active)}`);
    assert.equal(activeSession, null);
  }
});

test('first session after the upgrade: every plan shape yields a generable, sane prescription', () => {
  const policies = ['linear', 'greyskull', 'double', 'time', 'off', 'x', undefined];
  for (const id of [BENCH, SQUAT, DIP, CARDIO, SITUP, '3293', '0011', '0968', '2138']) for (const prog of policies) for (const unit of ['kg', 'lb']) for (const weight of [undefined, 0, 7.5, 52, 100.1]) {
    const ex = { id, sets: 3, reps: 8, weight, prog, ...(prog === 'time' ? { sec: 40 } : {}) };
    const logged = weight == null ? 0 : weight;
    run(v1({ unit, routines: [plan(ex)], workouts: [1, 2, 3, 4].map(i => session(`w${i}`, [entryOf(id, { sets: 3, reps: 8, weight: logged }, [row(8, logged), row(8, logged), row(i % 2 ? 8 : 3, logged)])], { d: `2026-01-0${i}`, start: Date.UTC(2026, 0, i) })) }), `${id}/${prog}/${unit}/${weight}`);
  }
});

test('scale: 700 sessions x 6 exercises migrate in bounded time, within the sync cap, losslessly', () => {
  const ex = [BENCH, SQUAT, '0023', '0024', '0027', '0028'].map(id => ({ id, sets: 4, reps: 5, weight: 60, prog: 'linear', warmupSets: 2 }));
  const workouts = Array.from({ length: 700 }, (_, i) => session(`w${i}`, ex.map(c => entryOf(c.id, { sets: 4, reps: 5, weight: 60 + (i % 20) }, [row(8, 20, { phase: 'warmup' }), ...Array.from({ length: 4 }, () => row(5, 60 + (i % 20)))])), { d: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), start: Date.UTC(2024, 0, 1 + i) }));
  const state = v1({ routines: [{ id: 'r1', name: 'R', ex }], workouts });
  const t0 = Date.now();
  const { profile } = migrate(state);
  assert.ok(Date.now() - t0 < 20000, `took ${Date.now() - t0} ms`);
  assert.ok(validateCanonicalProfile(profile).ok);
  assert.doesNotThrow(() => assertSyncSize(profile));
  assert.deepEqual(unpackProfile(JSON.parse(JSON.stringify(packProfile(profile)))), profile);
  assert.equal(profile.workouts.length, 700);
});

/* ---- regressions found by the fuzz above, one each ---- */
const nextOf = (profile, j = 0) => {
  const occ = profile.routines[0].ex[j];
  const ctx = resolveProgressionContext({ trackId: occ.occurrenceId, exerciseId: occ.exerciseId, rule: occ.rule, workouts: profile.workouts, prescriptions: profile.prescriptions, progression: profile.progression, assisted: false });
  return generatePrescription({ id: 'next', now: '2026-06-01T00:00:00.000Z', trackId: occ.occurrenceId, rule: occ.rule, state: ctx.state, lastPrescription: ctx.lastPrescription,
    lastLog: ctx.baseline && { ...ctx.baseline, id: ctx.baseline.exposureId }, reset: ctx.reset, heldLoad: ctx.heldLoad });
};
const history = (ex, rows, target = { sets: 1, reps: 5, weight: 0 }) => v1({ routines: [plan(ex)], workouts: [session('w1', [entryOf(ex.id, target, rows)])] });

test('regression: a fractional rep count in the log (5.5) leaves the first session generable, counted as the 5 done', () => {
  const { profile } = run(history({ id: '3293', sets: 1, reps: 5, prog: 'linear', repsMax: 20 }, [row(5.5, 0)]));
  const next = nextOf(profile);
  assert.ok(Number.isInteger(next.prefill.reps), String(next.prefill.reps));
  assert.ok(next.prefill.reps <= 6);
  assert.equal(profile.workouts[0].exposures[0].performance.sets[0].observations[0].value, 5.5);   // the log itself is kept as typed
});

test('regression: an unloaded plan of more than six sets still opens (the ladder keeps its own set count)', () => {
  for (const sets of [7, 12, 50]) {
    const { profile } = run(history({ id: SITUP, sets, reps: 10, weight: 8.75, prog: 'linear' }, Array.from({ length: sets }, () => row(10, 0)), { sets, reps: 10 }), `${sets} sets`);
    assert.equal(nextOf(profile).rows.length, sets);
  }
});

test('regression: a negative logged count, load, time or speed is a typo, not a value', () => {
  const { profile } = run(history({ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' }, [row(-1, -5), row(5, 60), { ...row(5, 60), rir: -3 }]));
  const [bad] = profile.workouts[0].exposures[0].performance.sets;
  assert.deepEqual(bad.observations, []);
  assert.equal(bad.resistance.kind, 'bodyweight');
  const timed = run(v1({ routines: [plan({ id: SITUP, mode: 'time', sets: 2, sec: 30 })], workouts: [session('w1', [entryOf(SITUP, { mode: 'time', sets: 2, sec: 30 }, [{ sec: -30, done: true }, { sec: 30, done: true }])])] })).profile;
  assert.deepEqual(timed.workouts[0].exposures[0].performance.sets[0].observations, []);
  const cardio = run(v1({ routines: [plan({ id: CARDIO, mode: 'cardio', min: 20, speed: 8 })], workouts: [session('w1', [entryOf(CARDIO, { mode: 'cardio', min: 20, speed: 8 }, [{ min: -5, speed: -2, done: true }])])] })).profile;
  assert.deepEqual(cardio.workouts[0].exposures[0].performance.sets[0].observations, []);
});

test('regression: rest-pause clusters are {r, restSec} objects; bare numbers become r, anything else is dropped', () => {
  const rows = [row(12, 60, { type: 'restpause', clusters: [5, '4', { r: 3, restSec: 15 }, { r: 'x', reps: [] }, null, 'y', [], { r: 2, extra: 'kept' }] })];
  const { profile } = run(history({ id: BENCH, sets: 1, reps: 12, weight: 60 }, rows));
  assert.deepEqual(profile.workouts[0].exposures[0].performance.sets[0].clusters, [{ r: 5 }, { r: 4 }, { r: 3, restSec: 15 }, {}, { r: 2, extra: 'kept' }]);
});

test('regression: a rest-pause total typed as text on a logged target cannot corrupt the prescription', () => {
  for (const totalReps of ['x', null, -4, 0, 1e300, [], {}, 12.6]) {
    const state = history({ id: BENCH, sets: 1, reps: 12, weight: 60 }, [row(12, 60)]);
    state.workouts[0].entries[0].target.intensifier = { type: 'restpause', totalReps, restSec: 15 };
    const { profile } = run(state, `totalReps ${JSON.stringify(totalReps)}`);
    const p = Object.values(profile.prescriptions)[0];
    assert.ok(Number.isInteger(p.parameters.reps.min) && p.parameters.reps.min >= 1);
  }
});

test('regression: Coach snapshots whose routines are not a list are left as they were, not fatal', () => {
  for (const routines of [{}, 'x', 5, null, true]) {
    const { profile } = run(v1({ routines: [plan({ id: BENCH, sets: 3, reps: 5 })], coach: { snapshots: [{ proposalId: 'p', routines }, null, 'x', { proposalId: 'q' }] } }), `snapshot ${JSON.stringify(routines)}`);
    assert.deepEqual(profile.coach.snapshots[0].routines, routines);
  }
});

test('regression: an absurd load or time never overflows into the totals, the 1RM or the volume', () => {
  const { profile } = run(history({ id: BENCH, sets: 1, reps: 5, weight: 60 }, [row(5, 1e300), row(1e300, 60), row(5, 1e15), { ...row(2, 1e15), sides: { L: row(1e300, 1e300), R: row(5, 5) } }]));
  assert.ok(Number.isFinite(profile.workouts[0].vol));
  for (const r of Object.values(profile.oneRepMaxes)) assert.ok(Number.isFinite(r.value));
});

test('regression: a 1RM dictionary carried by the document keeps its good records and audits the rest', () => {
  const good = { id: 'one-rep-max:mine', exerciseId: BENCH, value: 100, unit: 'kg', source: 'manual', capturedAt: '2026-01-01T00:00:00.000Z' };
  const state = history({ id: BENCH, sets: 1, reps: 5, weight: 60 }, [row(5, 60)]);
  state.oneRepMaxes = { [good.id]: good, bad: { id: 'bad' }, wrongKey: { ...good, id: 'other' }, dangling: { ...good, id: 'dangling', source: 'estimated', sourceRecordId: 'nowhere' } };
  const { profile } = run(state);
  assert.deepEqual(profile.oneRepMaxes[good.id], good);
  assert.deepEqual(profile.migrationAudit.discarded.map(d => d.path).sort(), ['oneRepMaxes[bad]', 'oneRepMaxes[dangling]', 'oneRepMaxes[wrongKey]']);
});

test('regression: the wire form markers on a v1 root are audited, never carried into the profile', () => {
  const state = history({ id: BENCH, sets: 1, reps: 5, weight: 60 }, [row(5, 60)]);
  Object.assign(state, { packed: 1, templates: { a: { x: 1 } } });
  const { profile } = run(state);
  assert.equal('packed' in profile, false);
  assert.equal('templates' in profile, false);
  assert.deepEqual(profile.migrationAudit.discarded.map(d => d.path), ['packed', 'templates']);
});

/* ---- a loaded lift that never had a weight: v1 holds, v2 must too (v1 progression.js: "No weight logged last time") ---- */
const unweighted = (prog, extra = {}, sessions = 3, loadLogged = 0) => v1({
  routines: [plan({ id: BENCH, sets: 3, reps: 8, prog, repsMin: 6, ...extra })],
  workouts: Array.from({ length: sessions }, (_, i) => session(`w${i}`, [entryOf(BENCH, { sets: 3, reps: 8, ...(extra.weight ? { weight: extra.weight } : {}) }, [row(8, loadLogged), row(8, loadLogged), row(8, loadLogged)])], { d: `2026-01-0${i + 1}`, start: Date.UTC(2026, 0, i + 1) }))
});

test('v1 parity: a loaded lift that never had a weight stays blank — no increment, no rep reset, no deload', () => {
  for (const prog of ['linear', 'greyskull', 'double']) for (const sessions of [1, 2, 5]) {
    const { profile } = run(unweighted(prog, {}, sessions), `${prog} x${sessions}`);
    const next = nextOf(profile);
    assert.ok(!(next.parameters.load.resolved?.value > 0), `${prog}: opens at ${next.parameters.load.resolved?.value}`);
    assert.equal(next.prefill.reps, 8, `${prog}: reps`);
    assert.equal(next.rows.length, 3, `${prog}: sets`);
    assert.deepEqual([profile.progression['r1:o0'].stalls, profile.progression['r1:o0'].readyToIncrement, profile.progression['r1:o0'].readyToDeload], [0, false, false], `${prog}: nothing earned, nothing missed`);
  }
  // Missing the reps over and over without a weight is not a stall either.
  const missed = unweighted('linear', {}, 5);
  missed.workouts.forEach(w => w.entries[0].sets.forEach(s => { s.r = 3; }));
  const after = run(missed).profile;
  assert.ok(!(nextOf(after).parameters.load.resolved?.value > 0));
  assert.equal(after.progression['r1:o0'].stalls, 0);
});

test('v1 parity: no weight lifted keeps the plan weight, and typing one in resumes progression from it', () => {
  const held = nextOf(run(unweighted('linear', { weight: 60 }, 3)).profile);
  assert.equal(held.parameters.load.resolved.value, 60);
  const resumed = unweighted('linear', { weight: 60 }, 3);
  resumed.workouts.push(session('w9', [entryOf(BENCH, { sets: 3, reps: 8, weight: 60 }, [row(8, 40), row(8, 40), row(8, 40)])], { d: '2026-01-09', start: Date.UTC(2026, 0, 9) }));
  assert.equal(nextOf(run(resumed).profile).parameters.load.resolved.value, 42.5);
});
