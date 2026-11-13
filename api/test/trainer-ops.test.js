// The trainer's whitelisted ops, their inverses (the member's Undo), the projections a trainer
// reads, and the nutrition hook: the pure parts of the dashboard, without a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanOps, applyOps, applyRestores, fingerprintOf, OpError } from '../trainers/ops.js';
import { summarize, project, streakWeeks, missedDays, weekOf } from '../trainers/projections.js';
import { stampPut } from '../sync-stamps.js';
import { nullSource, openNutritionSource, nutritionSourceFrom, cleanDay } from '../sources/nutrition.js';

const by = { id: 'u_marco', name: 'Marco' };
const base = () => ({
  unit: 'kg', routines: [{ id: 'r1', name: 'Push A', ex: [{ id: 'bench' }], _ts: 10 }], week: { 1: ['r1'] },
  bodyweight: [{ d: '2026-11-01', w: 70, t: 5 }], measurements: [], workouts: [], edited: { 'week.1': 3 }
});

test('cleanOps lets only the whitelist through, cleaned', () => {
  assert.throws(() => cleanOps([]), OpError);
  assert.throws(() => cleanOps([{ op: 'state.replace' }]), /unknown op/);
  assert.throws(() => cleanOps([{ op: 'custom.put', exercise: { id: 'x' } }]), /unknown op/);   // server-only
  assert.throws(() => cleanOps([{ op: 'bodyweight.put', d: '2026-13-40', w: 70 }]), /weigh-in/);
  assert.throws(() => cleanOps([{ op: 'measurement.put', d: '2026-11-02', values: { soul: 3 } }]), /unknown measurement/);
  assert.throws(() => cleanOps(Array.from({ length: 21 }, () => ({ op: 'routine.remove', id: 'r1' }))), /at most 20/);
  const [r] = cleanOps([{ op: 'routine.put', routine: { name: ' Legs ', ex: [{ id: 'squat', video: 'x' }], photo: 'y', _by: { kind: 'trainer', id: 'fake' } } }]);
  assert.equal(r.routine.name, 'Legs');
  assert.equal(r.routine.photo, undefined);
  assert.equal(r.routine._by, undefined);                  // nobody signs in someone else's name
  assert.equal(r.routine.ex[0].video, undefined);
});

test('applyOps stamps like a second device, labels with _by, and the inverse puts it all back', () => {
  const S = base();
  const cur = JSON.parse(JSON.stringify(S));
  const t = 1000;
  const recs = applyOps(S, cleanOps([
    { op: 'routine.put', routine: { name: 'Legs', ex: [{ id: 'squat' }] } },
    { op: 'week.set', day: 1, ids: [] },
    { op: 'bodyweight.put', d: '2026-11-01', w: 69.5 },
  ]), { by, t });
  const legs = S.routines.find(r => r.name === 'Legs');
  assert.equal(legs._by.name, 'Marco');
  assert.equal(legs._ts, t);
  assert.equal(S.week[1], undefined);
  assert.equal(S.edited['week.1'], t);
  assert.equal(S.bodyweight[0].w, 69.5);
  assert.equal(S.bodyweight[0].t, t);
  assert.equal(S.bodyweight[0]._by.id, 'u_marco');
  // Through stampPut as server.js writes it: the records only grow, nothing is set back.
  stampPut(cur, S, { stamped: true, now: t });
  assert.equal(S.routines.length, 2);

  const touched = recs.flatMap(r => r.touched);
  const fp = fingerprintOf(S, touched);
  assert.deepEqual(fingerprintOf(S, touched), fp);
  applyRestores(S, recs.flatMap(r => r.inverse), { t: 2000 });
  assert.equal(S.routines.some(r => r.name === 'Legs'), false);
  assert.equal(S.deleted.routines[legs.id], 2000);
  assert.deepEqual(S.week[1], ['r1']);
  assert.equal(S.edited['week.1'], 2000);
  assert.equal(S.bodyweight[0].w, 70);
  assert.equal(S.bodyweight[0]._by, undefined);
  assert.notDeepEqual(fingerprintOf(S, touched), fp);
});

test('routine.remove takes it off the week too; undo brings both back', () => {
  const S = base();
  const recs = applyOps(S, cleanOps([{ op: 'routine.remove', id: 'r1' }]), { by, t: 50 });
  assert.equal(S.routines.length, 0);
  assert.equal(S.week[1], undefined);
  assert.equal(S.deleted.routines.r1, 50);
  applyRestores(S, recs[0].inverse, { t: 60 });
  assert.equal(S.routines[0].name, 'Push A');
  assert.deepEqual(S.week[1], ['r1']);
  assert.throws(() => applyOps(base(), cleanOps([{ op: 'routine.remove', id: 'nope' }]), { by, t: 1 }), /no such routine/);
  assert.throws(() => applyOps(base(), cleanOps([{ op: 'week.set', day: 2, ids: ['nope'] }]), { by, t: 1 }), /no such routine/);
});

test('assigning the same routine again replaces the copy, with its custom exercises and a weekday', () => {
  const S = base();
  const origin = { kind: 'trainer', id: 'u_marco', sourceId: 'm1' };
  const ops = [
    { op: 'custom.put', exercise: { id: 'c_x', name: 'Landmine', photo: 'p' } },
    { op: 'routine.put', routine: { name: 'Full', ex: [{ id: 'c_x' }] }, origin },
    { op: 'week.add', day: 3 },
  ];
  applyOps(S, ops, { by, t: 10 });
  applyOps(S, [{ op: 'routine.put', routine: { name: 'Full v2', ex: [{ id: 'c_x' }] }, origin }], { by, t: 20 });
  const copies = S.routines.filter(r => r.origin?.sourceId === 'm1');
  assert.equal(copies.length, 1);
  assert.equal(copies[0].name, 'Full v2');
  assert.equal(copies[0]._f.name, 20);
  assert.deepEqual(S.week[3], [copies[0].id]);
  assert.equal(S.customEx[0].photo, undefined);
  // One of theirs with the same id stays theirs.
  const T = { ...base(), customEx: [{ id: 'c_x', name: 'Mine' }] };
  applyOps(T, ops, { by, t: 10 });
  assert.equal(T.customEx[0].name, 'Mine');
});

test('workout.edit corrects sets in place, labelled, and the undo puts the workout back', () => {
  const S = base();
  S.workouts = [{ id: 'w1', d: '2026-11-03', name: 'Push', start: 1, end: 2, _ts: 5, prs: ['bench'],
    entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true, rpe: 8, media: [{ hash: 'a' }] }, { w: 60, r: 3, done: true }] },
      null, { id: 'curl', sets: [{ sides: { L: { w: 10, r: 8, done: true }, R: { w: 10, r: 6, done: true } } }] }] }];
  assert.throws(() => cleanOps([{ op: 'workout.edit', id: 'w1' }]), /nothing to correct/);
  assert.throws(() => cleanOps([{ op: 'workout.edit', id: 'w1', sets: [{ e: 0, s: 0, ex: 'bench' }] }]), /changes something/);
  assert.throws(() => cleanOps([{ op: 'workout.edit', id: 'w1', sets: [{ e: 0, s: 0, ex: 'bench', w: 9999 }] }]), /weight/);
  const ops = cleanOps([{ op: 'workout.edit', id: 'w1', name: ' Push heavy ', sets: [
    { e: 0, s: 1, ex: 'bench', r: 5 }, { e: 1, s: 0, ex: 'curl', side: 'R', r: 8, sneaky: 1 }] }]);
  assert.equal(ops[0].sets[1].sneaky, undefined);
  const before = JSON.parse(JSON.stringify(S.workouts[0]));
  const recs = applyOps(S, ops, { by, t: 100 });
  const w = S.workouts[0];
  assert.equal(w.name, 'Push heavy');
  assert.equal(w.entries[0].sets[1].r, 5);
  assert.deepEqual(w.entries[0].sets[0], before.entries[0].sets[0]);   // its RPE and video untouched
  assert.equal(w.entries[2].sets[0].sides.R.r, 8);                       // the null entry is skipped, like the projection
  assert.equal(w._edit.name, 'Marco');
  assert.equal(w._by, undefined);                                         // still the member's own workout
  assert.equal(w._ts, 100);
  assert.equal(w._f.entries, 100);
  assert.deepEqual(recs[0].summary, { kind: 'workout.edit', d: '2026-11-03', name: 'Push heavy', n: 2 });
  assert.equal(project(S, { workouts: 'view' }, { today: '2026-11-05' }).workouts.list[0]._edit.name, 'Marco');
  // A workout that changed shape since the trainer looked is refused, not guessed at.
  assert.throws(() => applyOps(S, cleanOps([{ op: 'workout.edit', id: 'w1', sets: [{ e: 0, s: 0, ex: 'curl', w: 1 }] }]), { by, t: 110 }), e => e.code === 'changed-since');
  assert.throws(() => applyOps(S, cleanOps([{ op: 'workout.edit', id: 'w1', sets: [{ e: 1, s: 0, ex: 'curl', w: 1 }] }]), { by, t: 110 }), e => e.code === 'changed-since');   // sides need a side
  assert.throws(() => applyOps(S, cleanOps([{ op: 'workout.edit', id: 'nope', name: 'x' }]), { by, t: 110 }), e => e.code === 'no-workout');
  // One from before workouts had ids goes by date|start.
  S.workouts.push({ d: '2026-10-01', start: 77, name: 'Old', entries: [{ id: 'row', sets: [{ w: 40, r: 10, done: true }] }] });
  applyOps(S, cleanOps([{ op: 'workout.edit', id: '2026-10-01|77', sets: [{ e: 0, s: 0, ex: 'row', w: 45 }] }]), { by, t: 120 });
  assert.equal(S.workouts[1].entries[0].sets[0].w, 45);
  assert.throws(() => cleanOps([{ op: 'workout.edit', id: 'x|y', name: 'a' }]), /bad workout id/);
  applyRestores(S, recs[0].inverse, { t: 200 });
  const back = S.workouts[0];
  assert.equal(back.name, 'Push');
  assert.equal(back.entries[0].sets[1].r, 3);
  assert.equal(back._edit, undefined);
});

test('projections show only the shared categories, without media or notes', () => {
  const S = {
    unit: 'kg', weekStart: 1,
    workouts: [{ id: 'w1', d: '2026-11-03', name: 'Push', start: 1000, end: 3601000, note: 'private', prs: ['bench'],
      entries: [{ id: 'bench', note: 'shoulder', photo: 'abc', sets: [{ w: 100, r: 5, done: true }, { w: 50, r: 5, done: true, phase: 'warmup' }, { w: 90, r: 5, done: false }] }] }],
    bodyweight: [{ d: '2026-10-20', w: 80 }, { d: '2026-11-03', w: 78.5 }],
    routines: [{ id: 'r1', name: 'Push', ex: [{ id: 'bench', video: 'v' }] }], week: { 1: 'r1' },
    dayNotes: { '2026-11-02': { text: 'sick' } }, dayPhotos: { 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': { d: '2026-11-01', m: { kind: 'image', hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mime: 'image/jpeg' }, _ts: 1 }, ['b'.repeat(64)]: { _ts: 2 } }, measurements: [{ d: '2026-11-01', waist: 80, t: 1 }],
  };
  const lv = { metrics: 'view', workouts: 'view', plans: 'off', bodyweight: 'off', measurements: 'off', photos: 'off', notes: 'off', nutrition: 'off' };
  const p = project(S, lv, { today: '2026-11-05' });
  assert.deepEqual(p.shared, ['metrics', 'workouts']);
  assert.equal(p.plans, undefined); assert.equal(p.bodyweight, undefined); assert.equal(p.notes, undefined);
  const w = p.workouts.list[0];
  assert.equal(w.note, undefined); assert.equal(w.entries[0].note, undefined); assert.equal(w.entries[0].photo, undefined);
  assert.equal(w.volume, 500);
  assert.equal(w.sets, 1);
  assert.equal(w.mins, 60);
  assert.equal(p.metrics.stats.lifts[0].id, 'bench');
  // With notes and photos shared, the notes come along and photos as a count.
  const p2 = project(S, { ...lv, notes: 'view', photos: 'view', plans: 'view' }, { today: '2026-11-05' });
  assert.equal(p2.workouts.list[0].note, 'private');
  assert.equal(p2.notes.days['2026-11-02'].text, 'sick');
  assert.equal(p2.photos.count, 1);
  assert.equal(p2.plans.routines[0].ex[0].video, undefined);
  // Nothing shared, nothing there.
  assert.deepEqual(Object.keys(project(S, {}, { today: '2026-11-05' })).sort(), ['customEx', 'shared', 'unit']);
});

test('a body check-in note goes to the trainer only with notes shared (v1.4.5)', () => {
  const S = { unit: 'kg', measurements: [{ d: '2026-11-01', bp: { sys: 120, dia: 80 }, note: 'cuff on the left', t: 1 }] };
  const lv = { measurements: 'view', notes: 'off' };
  const e = project(S, lv, { today: '2026-11-05' }).measurements.entries[0];
  assert.deepEqual(e.bp, { sys: 120, dia: 80 });
  assert.equal(e.note, undefined);
  assert.equal(project(S, { ...lv, notes: 'view' }, { today: '2026-11-05' }).measurements.entries[0].note, 'cuff on the left');
});

test('the summary: streak, this week, flags only where their category is shared', () => {
  const S = {
    unit: 'kg', week: { 1: 'r1', 3: 'r1' }, routines: [{ id: 'r1', name: 'Push', ex: [] }],
    workouts: [{ d: '2026-10-20', prs: [] }, { d: '2026-10-27', prs: ['bench'] }, { d: '2026-11-03', prs: ['squat'] }],
    bodyweight: [{ d: '2026-10-22', w: 80 }, { d: '2026-11-04', w: 78.8 }],
  };
  const all = { metrics: 'view', workouts: 'view', bodyweight: 'view' };
  const s = summarize(S, all, { today: '2026-11-05' });          // a Thursday
  assert.equal(s.lastWorkout, '2026-11-03');
  assert.equal(s.streak, 3);
  assert.deepEqual(s.week, { done: 1, planned: 2 });
  assert.deepEqual(s.flags.find(f => f.kind === 'pr').ex, ['squat']);
  assert.equal(s.flags.find(f => f.kind === 'weight').delta, -1.2);
  assert.equal(s.flags.some(f => f.kind === 'inactive'), false);
  const later = summarize(S, all, { today: '2026-11-14', inactiveDays: 7 });
  assert.equal(later.flags.find(f => f.kind === 'inactive').days, 11);
  assert.ok(later.flags.find(f => f.kind === 'missed').n >= 1);
  // Body weight only: no streak, no PRs, no missed days. Key numbers without workouts: no PR names.
  const bw = summarize(S, { bodyweight: 'view' }, { today: '2026-11-05' });
  assert.equal(bw.streak, undefined);
  assert.deepEqual(bw.flags.map(f => f.kind), ['weight']);
  assert.equal(summarize(S, { metrics: 'view' }, { today: '2026-11-05' }).flags.find(f => f.kind === 'pr').ex, undefined);
});

test('streak weeks follow the freeze rule; missed days skip excused ones', () => {
  const S = { workouts: ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-11-02'].map(d => ({ d })) };
  assert.equal(weekOf('2026-11-05', S), '2026-11-02');
  assert.equal(weekOf('2026-11-05', { weekStart: 0 }), '2026-11-01');
  assert.equal(streakWeeks(S, '2026-11-05'), 5);                                    // the missed week used a freeze
  assert.equal(streakWeeks({ ...S, streakRule: { rule: 'off' } }, '2026-11-05'), 1);
  // Not retroactive: the missed week was judged by `generous`, in force then, so it stays covered.
  assert.equal(streakWeeks({ ...S, streakRule: { rule: 'off', since: '2026-11-02', history: [{ rule: 'generous', since: null }] } }, '2026-11-05'), 5);
  const P = { routines: [{ id: 'r', name: 'x', ex: [] }], week: { 2: 'r', 3: 'r' }, workouts: [], dayNotes: { '2026-11-03': { tag: 'sick' } } };
  assert.deepEqual(missedDays(P, '2026-11-05'), ['2026-11-04']);   // Tuesday has a sick note
  assert.deepEqual(missedDays(P, '2026-11-05', 9), ['2026-11-04', '2026-10-28', '2026-10-27']);
});

test('nutrition: nothing linked by default; the openNutrition adapter asks with the member token only', async () => {
  assert.equal(nullSource.status('u'), 'not-linked');
  assert.equal(await nullSource.getSummary('u'), null);
  assert.equal(nutritionSourceFrom({}), nullSource);
  assert.equal(nutritionSourceFrom({ NUTRITION_SOURCE: 'opennutrition' }), nullSource);   // no URL, no source
  const asked = [];
  const src = openNutritionSource({
    url: 'https://nutri.test/', tokenFor: uid => (uid === 'u_lea' ? 'tok' : null), now: () => Date.parse('2026-11-05T12:00:00Z'),
    fetchImpl: async (u, o) => { asked.push([u, o.headers.Authorization]); return { ok: true, json: async () => ({ days: [{ date: '2026-11-04', kcal: 2100.44, protein: 140, secret: 'x' }, { bad: 1 }] }) }; }
  });
  assert.equal(src.status('u_tim'), 'not-linked');
  assert.equal(src.status('u_lea'), 'ok');
  const s = await src.getSummary('u_lea');
  assert.deepEqual(s.days, [{ date: '2026-11-04', kcal: 2100.4, protein: 140, carbs: null, fat: null, logged: true }]);
  await src.getSummary('u_lea');                                                          // cached
  assert.equal(asked.length, 1);
  assert.equal(asked[0][0], 'https://nutri.test/api/v1/integration/summary?from=2026-10-23&to=2026-11-05');
  assert.equal(asked[0][1], 'Bearer tok');
  assert.equal(cleanDay({ date: 'x' }), null);
});

test('nutrition: reads openNutrition\'s own summary.v1 names (energy, carbohydrate, targets), a missing value stays missing', () => {
  assert.deepEqual(
    cleanDay({ date: '2026-10-05', energy: 2512, protein: 171, carbohydrate: 280, fat: null, complete: true, targets: { energy: 2600, protein: 170 }, proteinMeals: 4 }),
    { date: '2026-10-05', kcal: 2512, protein: 171, carbs: 280, fat: null, target: { kcal: 2600, protein: 170 }, logged: true, proteinMeals: 4 });
  assert.equal(cleanDay({ date: '2026-10-05', kcal: null }).kcal, null);
});
