/* The Coach doing more (v1.4.5): changes to the workout in progress (`adapt`), warm-ups and
 * programmes in a review, and the newer picture the payload carries (weekly sets and recovery per
 * muscle, the active gym, this month's challenges, the daily weigh-in value). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const payloadLib = await import('../coach/core/payload.js');
const { runPipeline } = await import('../coach/core/pipeline.js');
const { validateAdapt, validateReview } = await import('../coach/core/validate.js');
const { SCHEMAS } = await import('../coach/core/schemas.js');
const { muscleLoad, gymOf, challengesOf } = await import('../coach/core/context.js');
const { strictSchema } = await import('../coach/core/adapters/openai.js');

const NOW = Date.parse('2026-10-29T12:00:00Z');
const day = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const set = (w, r, done = true, extra = {}) => ({ w, r, done, ...extra });
const H = 'h'.repeat(16);
// 0025 barbell bench press (chest/pectorals), 0043 barbell full squat, 0294 dumbbell biceps curl
const S = {
  unit: 'kg', lang: 'en', warmupAuto: 'compounds', bwDaily: 'avg',
  equipFilterOn: true, activeEquipId: 'g1',
  equipProfiles: [{ id: 'g1', name: 'Home garage', equipment: ['barbell', 'dumbbell', 'body weight', 'bench'] }],
  plates: { kg: { 20: 1, 10: 2, 5: 2, 2.5: 1, _ts: 1 } },
  dumbbells: { kg: { weights: [5, 10, 15, 20], _ts: 1 } },
  routines: [{ id: 'push', name: 'Push', ex: [
    { id: '0025', sets: 3, reps: 5, weight: 80, warmup: 'own', warmupRows: [{ wb: true, r: 10 }, { wp: 60, r: 5 }] },
    { id: '0294', sets: 3, reps: 10, weight: 14, warmupSets: 2 }
  ] }, { id: 'legs', name: 'Legs', ex: [{ id: '0043', sets: 5, reps: 5, weight: 100, warmup: 'auto' }] }],
  week: { 1: ['push'], 4: ['legs'] },
  programmes: { p1: { id: 'p1', name: 'Bench block', at: 5, weeks: [{ t: { '0025': { pct: 75 } } }, { t: { 'push:0025': { pct: 80, rpe: 8 } } }, { deload: true }] } },
  programme: { id: 'p1', startedOn: day(9), cycle: 1, bump: 0 },
  challenges: { '2026-10': { picked: [{ id: 'workouts', n: 12 }, { id: 'volume', n: 50000, u: 'kg' }, { id: 'evil<script>', n: 3 }], done: ['workouts'], at: 1 } },
  bodyweight: [{ d: day(3), w: 80.4, t: 1, ins: [{ id: 'a', at: '07:00', w: 80 }, { id: 'b', at: '21:00', w: 80.8 }] }, { d: day(1), w: 80.1, t: 1 }],
  workouts: [
    { id: 'w1', d: day(20), name: 'Push', entries: [{ id: '0025', sets: [set(50, 5, true, { warmup: true }), set(80, 5), set(80, 5)] }] },
    { id: 'w2', d: day(5), name: 'Legs', entries: [{ id: '0043', sets: [set(100, 5), set(100, 5), set(100, 5)] }] },
    { id: 'w3', d: day(1), name: 'Push', entries: [{ id: '0025', sets: [set(80, 5), set(80, 5), set(80, 4)] }, { id: '0294', sets: [set(14, 10), set(14, 9)] }] }
  ],
  coach: { consent: { agreedAt: 1 } }
};
const today = {
  name: 'Push', minutes: 15, entries: [
    { id: '0025', target: { sets: 3, reps: 5, weight: 80 }, sets: [set(20, 10, true, { warmup: true }), set(80, 5), set(80, 5, false), set(80, 5, false)] },
    { id: '0294', target: { sets: 3, reps: 10, weight: 14 }, sets: [set(14, 10, false), set(14, 10, false), set(14, 10, false)] },
    { id: '0043', target: { sets: 3, reps: 5, weight: 100 }, sets: [set(100, 5), set(100, 5), set(100, 5)] }
  ]
};

test('context: weekly sets, the last 72 hours and days since, per target muscle', () => {
  const m = muscleLoad(S, NOW);
  const pecs = m.find(x => x.muscle === 'pectorals');
  assert.ok(pecs, JSON.stringify(m));
  assert.equal(pecs.sets7d, 3, 'warm-ups are not work sets, and day 20 is outside the week');
  assert.equal(pecs.sets72h, 3);
  assert.equal(pecs.daysSince, 1);
  assert.equal(pecs.weeklyAvg, 1.3);   // 5 work sets over 4 weeks
  assert.equal(m.find(x => x.muscle === 'glutes' || x.muscle === 'quads').daysSince, 5);
});

test('context: the active gym loads by size only, never by name; challenges are this month’s, cleaned', () => {
  const g = gymOf(S);
  assert.deepEqual(g, { unit: 'kg', equipment: ['barbell', 'dumbbell', 'body weight', 'bench'], plates: [2.5, 5, 10, 20], dumbbells: [5, 10, 15, 20] });
  assert.ok(!JSON.stringify(g).includes('garage'));
  assert.equal(gymOf({ unit: 'kg' }), null);
  assert.deepEqual(challengesOf(S, NOW), { month: '2026-10', goals: [{ id: 'workouts', n: 12, done: true }, { id: 'volume', n: 50000, u: 'kg' }] });
  assert.equal(challengesOf({ ...S, monthlyChallenges: false }, NOW), null);
});

test('review payload: warm-ups, programmes, muscles, gym, challenges and the daily weigh-in value', () => {
  const p = payloadLib.build(S, { handle: H, kind: 'review', now: NOW });
  assert.equal(p.meta.warmups, 'compounds');
  const [bench, curl] = p.plan.routines[0].ex;
  assert.equal(bench.warmup, 'own');
  assert.deepEqual(bench.warmupRows, [{ bar: true, reps: 10 }, { pct: 60, reps: 5 }]);
  assert.equal(curl.warmupSets, 2);
  assert.equal(p.plan.routines[1].ex[0].warmup, 'auto');
  const prog = p.plan.programmes[0];
  assert.equal(prog.id, 'p1');
  assert.deepEqual(prog.weeks[1].targets, [{ exId: '0025', routineId: 'push', pct: 80, rpe: 8 }]);
  assert.deepEqual(prog.running, { startedOn: day(9), week: 2 });
  assert.ok(p.muscles.length && p.gym && p.challenges);
  assert.equal(p.bodyweight.daily, 'avg');
  assert.equal(payloadLib.build({ ...S, bwDaily: undefined }, { handle: H, kind: 'review', now: NOW }).bodyweight.daily, undefined);
  assert.deepEqual(p.bodyweight.series.find(b => b.n), { d: day(3), w: 80.4, n: 2 });
});

test('the fingerprint of a plan does not move because it gained warm-up choices or programmes', () => {
  const plain = { ...S, programmes: undefined, routines: S.routines.map(r => ({ ...r, ex: r.ex.map(({ warmup, warmupRows, ...e }) => e) })) };
  assert.deepEqual(payloadLib.canonicalPlan(plain), payloadLib.canonicalPlan(S));
});

test('adapt payload: the running session indexed, the exercise asked about, like-for-like candidates', () => {
  const p = payloadLib.build(S, { handle: H, kind: 'adapt', now: NOW, today, focus: { entry: 0, reason: 'pain' }, note: 'shoulder pinches at the bottom' });
  assert.equal(p.task, 'adapt');
  assert.deepEqual(p.today.entries.map(e => e.i), [0, 1, 2]);
  assert.deepEqual(p.focus, { entry: 0, exId: '0025', name: 'barbell bench press', reason: 'pain' });
  assert.equal(p.userNote, 'shoulder pinches at the bottom');
  assert.equal(p.conversation, undefined);
  assert.ok(p.library.length <= 36 + 10);
  // Mostly chest work, and the session's own exercises so a change can name them.
  const chest = p.library.filter(e => e.bp === 'chest').length;
  assert.ok(chest > p.library.length / 2, JSON.stringify(p.library.map(e => e.n)));
  assert.ok(p.library.some(e => e.id === '0294'));
  assert.ok(JSON.stringify(p).length < 30000, 'an adapt answers mid-set: the payload stays small');
  // A reason nobody knows reads as other; an index past the session focuses nothing.
  assert.equal(payloadLib.build(S, { handle: H, kind: 'adapt', today, focus: { entry: 0, reason: 'x' } }).focus.reason, 'other');
  assert.equal(payloadLib.build(S, { handle: H, kind: 'adapt', today, focus: { entry: 9 } }).focus, null);
});

const adaptPayload = () => payloadLib.build(S, { handle: H, kind: 'adapt', now: NOW, today, focus: { entry: 0, reason: 'busy' } });

test('validateAdapt: each type, against the open part of the session only', () => {
  const p = adaptPayload();
  const swapTo = p.library.find(e => !today.entries.some(x => x.id === e.id)).id;
  const ok = validateAdapt({
    coach_contract: 1, summary: 'Rack taken, so dumbbells, and a shorter curl.',
    changes: [
      { type: 'swap', entry: 0, exId: '0025', to: swapTo, reps: 8, why: 'The rack is busy.' },
      { type: 'sets', entry: 1, sets: 2, why: 'Short on time.' }
    ]
  }, p.today);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.proposal.changes.map(c => [c.type, c.entry]), [['swap', 0], ['sets', 1]]);
  assert.equal(ok.proposal.changes[1].before, 3);

  const bad = (c, msg) => {
    const r = validateAdapt({ coach_contract: 1, summary: 's', changes: [c] }, p.today);
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.match(r.errors.join(' '), msg);
  };
  bad({ type: 'skip', entry: 2, why: 'x' }, /all logged/);
  bad({ type: 'weight', entry: 0, pct: 30, why: 'x' }, /-50 to \+10/);
  bad({ type: 'swap', entry: 0, to: 'nope', why: 'x' }, /library/);
  bad({ type: 'swap', entry: 0, to: '0294', why: 'x' }, /already in today/);
  bad({ type: 'move', entry: 0, place: 'last', why: 'x' }, /under way/);
  bad({ type: 'sets', entry: 1, sets: 3, why: 'x' }, /no change/);
  bad({ type: 'reps', entry: 7, reps: 8, why: 'x' }, /index/);
  bad({ type: 'delete-workout', entry: 1, why: 'x' }, /not allowed/);
  bad({ type: 'reps', entry: 1, reps: 8 }, /why/);
  const twice = validateAdapt({ coach_contract: 1, summary: 's', changes: [{ type: 'reps', entry: 1, reps: 8, why: 'a' }, { type: 'rest', entry: 1, rest: 90, why: 'b' }] }, p.today);
  assert.match(twice.errors.join(' '), /one change per exercise/);
  assert.equal(validateAdapt({ coach_contract: 1, nochange: true, reading: 'Carry on.' }, p.today).nochange, true);
});

test('adapt pipeline: its own rules and schema reach the provider; a bad answer gets the one repair round', async () => {
  const calls = [];
  const answers = [
    { coach_contract: 1, summary: 'x', changes: [{ type: 'skip', entry: 2, why: 'done already' }] },
    { coach_contract: 1, summary: 'Trim the curls.', changes: [{ type: 'sets', entry: 1, sets: 1, why: 'Short on time, one good set.' }] }
  ];
  const adapter = { spawns: false, async invoke(req) { calls.push(req); return { code: 0, text: JSON.stringify(answers.shift()) }; } };
  const r = await runPipeline({ adapter, cfg: {}, kind: 'adapt', payload: adaptPayload() });
  assert.equal(r.ok, true);
  assert.equal(r.result.changes[0].sets, 1);
  assert.match(calls[0].system, /# Task: adapt the workout in progress/);
  assert.equal(calls[0].schema, SCHEMAS.adapt);
  assert.match(calls[1].prompt, /REPAIR REQUEST/);
});

test('the adapt schema survives the strict copy: every change field is a plain scalar', () => {
  const strict = strictSchema(SCHEMAS.adapt);
  const item = strict.properties.changes.items;
  assert.equal(item.additionalProperties, false);
  for (const [k, v] of Object.entries(item.properties)) assert.ok(['string', 'integer', 'number'].includes(v.type), k);
});

test('review: warm-up changes, explained and bounded', () => {
  const plan = payloadLib.cleanPlan(S);
  const ctx = {};
  const r = validateReview({
    coach_contract: 1, summary: 's', changes: [
      { id: 'c1', type: 'warmup', target: { routineId: 'push', exId: '0294' }, after: { mode: 'own', rows: [{ pct: 50, reps: 10 }, { pct: 75, reps: 4 }] }, why: 'Your first curl set keeps missing a rep; two light sets first.' },
      { id: 'c2', type: 'warmup', target: { routineId: 'legs', exId: '0043' }, after: { mode: 'auto' }, why: 'restates' }
    ]
  }, plan, ctx);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.proposal.changes.map(c => c.id), ['c1'], 'auto on an auto slot restates the plan and is dropped');
  assert.deepEqual(r.proposal.changes[0].after, { mode: 'own', rows: [{ wp: 50, r: 10 }, { wp: 75, r: 4 }] });
  const bad = (after, msg) => {
    const x = validateReview({ coach_contract: 1, summary: 's', changes: [{ id: 'c', type: 'warmup', target: { routineId: 'push', exId: '0025' }, after, why: 'w' }] }, plan, ctx);
    assert.equal(x.ok, false); assert.match(x.errors.join(' '), msg);
  };
  bad({ mode: 'hot' }, /mode/);
  bad({ mode: 'own', rows: [] }, /1-5/);
  bad({ mode: 'own', rows: [{ pct: 60, reps: 5 }, { pct: 40, reps: 3 }] }, /climb/);
  bad({ mode: 'own', rows: [{ pct: 120, reps: 5 }] }, /0-95/);
});

test('review: a programme, new or revised, over exercises of the plan', () => {
  const plan = payloadLib.cleanPlan(S);
  const fresh = validateReview({ coach_contract: 1, summary: 's', changes: [{ id: 'c1', type: 'programme', target: {}, after: {
    name: 'Squat 4 weeks', weeks: [
      { targets: [{ exId: '0043', pct: 72.3 }] }, { targets: [{ exId: '0043', pct: 77.5, rpe: 8 }] }, { rpe: 8.5, targets: [{ exId: '0043', routineId: 'legs', pct: 82.5 }] }, { deload: true }
    ] }, why: 'You asked for a block before the meet: three climbing weeks, then an easy one.' }] }, plan, {});
  assert.equal(fresh.ok, true, JSON.stringify(fresh.errors));
  const after = fresh.proposal.changes[0].after;
  assert.equal(after.name, 'Squat 4 weeks');
  assert.deepEqual(after.weeks[0], { t: { '0043': { pct: 72.5 } } });
  assert.deepEqual(after.weeks[2], { rpe: 8.5, t: { 'legs:0043': { pct: 82.5 } } });
  assert.deepEqual(after.weeks[3], { deload: true });
  assert.equal(fresh.proposal.changes[0].before, null);

  const revise = validateReview({ coach_contract: 1, summary: 's', changes: [{ id: 'c1', type: 'programme', target: { programmeId: 'p1' }, after: { weeks: [{ targets: [{ exId: '0025', pct: 70 }] }] }, why: 'Your last two bench sessions missed the last set.' }] }, plan, {});
  assert.equal(revise.ok, true, JSON.stringify(revise.errors));
  assert.deepEqual(revise.proposal.changes[0].before, { name: 'Bench block', weeks: 3 });
  assert.equal(revise.proposal.changes[0].after.name, 'Bench block');

  const bad = (target, after, msg) => {
    const x = validateReview({ coach_contract: 1, summary: 's', changes: [{ id: 'c', type: 'programme', target, after, why: 'w' }] }, plan, {});
    assert.equal(x.ok, false); assert.match(x.errors.join(' '), msg);
  };
  bad({ programmeId: 'gone' }, { weeks: [{}] }, /not one of plan.programmes/);
  bad({}, { weeks: [{}] }, /name is required/);
  bad({}, { name: 'x', weeks: Array.from({ length: 17 }, () => ({})) }, /1-16/);
  bad({}, { name: 'x', weeks: [{ targets: [{ exId: '9999', pct: 70 }] }] }, /exercise of the plan/);
  bad({}, { name: 'x', weeks: [{ targets: [{ exId: '0043', routineId: 'push', pct: 70 }] }] }, /routine of the plan/);
  bad({}, { name: 'x', weeks: [{ targets: [{ exId: '0043' }] }] }, /needs pct/);
  const two = validateReview({ coach_contract: 1, summary: 's', changes: [
    { id: 'a', type: 'programme', target: {}, after: { name: 'A', weeks: [{}] }, why: 'w' },
    { id: 'b', type: 'programme', target: {}, after: { name: 'B', weeks: [{}] }, why: 'w' }
  ] }, plan, {});
  assert.match(two.errors.join(' '), /one programme change/);
});

test('the system prompt stays a prompt: every task under 20k characters', async () => {
  const { buildPromptParts } = await import('../coach/core/prompt.js');
  for (const kind of ['create', 'review', 'debrief', 'ask', 'adapt']) {
    assert.ok(buildPromptParts(kind, {}).system.length < 20000, kind);
  }
});
