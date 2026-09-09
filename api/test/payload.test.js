import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payload = await import('../coach/core/payload.js');
const { handleFor, HANDLE_LENGTH } = await import('../coach/handle.js');

test('the server handle is stable per uid, distinct across uids, and never the uid', () => {
  assert.equal(handleFor('uid-a'), handleFor('uid-a'));
  assert.notEqual(handleFor('uid-a'), handleFor('uid-b'));
  assert.equal(handleFor('uid-a').length, HANDLE_LENGTH);
  assert.ok(!handleFor('uid-a').includes('uid-a'));
});

test('build refuses to run without a handle — a payload must never fall back to the uid', () => {
  assert.throws(() => payload.build(sampleState(), { kind: 'review' }), /handle/);
});

/* The promise the consent screen makes is only as good as this test. It asserts on the
   *absence* of things, which is the awkward direction to test and the only one that matters:
   a field added to the state blob next year must not be able to ride along. */
test('payload never carries identity, credentials or device data', () => {
  const S = sampleState({
    // Everything below is either private, irrelevant to coaching, or both — and all of it is
    // realistically present in a live state blob.
    theme: 'dark', accent: 'lime', body: 'male', gifSize: 'full',
    reminder: { on: true, time: '08:00', tz: 'Europe/Lisbon' },
    _ts: Date.now()
  });
  const p = payload.build(S, { handle: handleFor('user-abc-123'), kind: 'review' });
  const json = JSON.stringify(p);

  assert.ok(!json.includes('user-abc-123'), 'the uid must never appear');
  assert.equal(p.meta.profile.length, 16, 'an opaque handle stands in for the uid');
  for (const forbidden of ['theme', 'accent', 'gifSize', 'reminder', 'Europe/Lisbon', 'passkey', 'credential', 'subscription', 'invite']) {
    assert.ok(!json.includes(forbidden), `payload leaked ${forbidden}`);
  }
});

test('the same profile always gets the same handle, and two profiles never share one', () => {
  const S = sampleState();
  const a1 = payload.build(S, { handle: handleFor('uid-a'), kind: 'review' }).meta.profile;
  const a2 = payload.build(S, { handle: handleFor('uid-a'), kind: 'review' }).meta.profile;
  const b = payload.build(S, { handle: handleFor('uid-b'), kind: 'review' }).meta.profile;
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
});

test('review payload carries the plan, the window, effort and aggregates', () => {
  const p = payload.build(sampleState(), { handle: handleFor('u1'), kind: 'review', note: 'shoulder pinches' });
  assert.equal(p.task, 'review');
  assert.equal(p.plan.routines.length, 1);
  assert.equal(p.plan.routines[0].ex[0].name, '3/4 sit-up', 'exercise names are resolved for the model');
  assert.equal(p.window.workouts.length, 1);
  assert.equal(p.window.workouts[0].entries[0].sets[0].rpe, 9.5, 'effort survives into the payload');
  assert.equal(p.userNote, 'shoulder pinches');
  assert.equal(p.meta.effortScale, 'rpe');
  assert.ok(p.aggregates.adherence.plannedPerWeek === 3);
  assert.ok(Array.isArray(p.library) && p.library.length > 0);
});

test('a stalling exercise shows up in the aggregates the way the engine counts it', () => {
  const S = sampleState();
  // Three sessions that all fell short of the 10-rep target.
  S.workouts = ['2026-07-06', '2026-07-13', '2026-07-20'].map((d, i) => ({
    id: 'w' + i, d, name: 'A', start: 0, end: 60000, entries: [{
      id: '0001', target: { sets: 3, reps: 10, weight: 20 },
      sets: [{ w: 20, r: 9, done: true }, { w: 20, r: 8, done: true }, { w: 20, r: 7, done: true }]
    }]
  }));
  const p = payload.build(S, { handle: handleFor('u1'), kind: 'review' });
  const ex = p.aggregates.exercises.find(e => e.id === '0001');
  assert.equal(ex.stalls, 3, 'three misses in a row is a stall of three');
  assert.equal(ex.lastOk, false);
});

test('a set that was never ticked off is a miss, not a gap', () => {
  const S = sampleState();
  S.workouts = [{
    id: 'w1', d: '2026-07-20', name: 'A', start: 0, end: 60000, entries: [{
      id: '0001', target: { sets: 3, reps: 10, weight: 20 },
      sets: [{ w: 20, r: 10, done: true }, { w: 20, r: 10, done: true }, { w: 20, r: 10, done: false }]
    }]
  }];
  const p = payload.build(S, { handle: handleFor('u1'), kind: 'review' });
  assert.equal(p.aggregates.exercises.find(e => e.id === '0001').stalls, 1);
});

test('the review window is bounded even for someone with years of history', () => {
  const S = sampleState();
  S.workouts = Array.from({ length: 200 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - i);
    return { id: 'w' + i, d: d.toISOString().slice(0, 10), name: 'A', start: 0, end: 60000, entries: [] };
  }).reverse();
  const p = payload.build(S, { handle: handleFor('u1'), kind: 'review' });
  assert.ok(p.window.workouts.length <= payload.MAX_SESSIONS, 'session cap holds');
  const oldest = new Date(p.window.workouts[0].d);
  const limit = new Date(); limit.setDate(limit.getDate() - payload.MAX_WEEKS * 7 - 1);
  assert.ok(oldest >= limit, 'nothing older than the week cap gets in');
});

test('creation payload carries working weights so baselines start from evidence', () => {
  const p = payload.build(sampleState(), { handle: handleFor('u1'), kind: 'create' });
  assert.equal(p.task, 'create');
  assert.ok(!p.window, 'creation does not ship the training window');
  assert.equal(p.history.workingWeights.find(w => w.id === '0001').best, 20);
});

test('the library is filtered to the equipment someone actually has', () => {
  // Slice entries are slimmed to { id, n, bp } — resolve the equipment through the catalogue.
  const eqOf = id => (payload.LIBRARY.find(e => e.id === id) || {}).eq;
  const dumbbell = payload.librarySlice({}, ['dumbbell']);
  assert.ok(dumbbell.length > 0);
  assert.ok(dumbbell.every(e => eqOf(e.id) === 'dumbbell'), 'nothing outside the filter');
  assert.ok(dumbbell.every(e => e.eq === undefined && e.id && e.n && e.bp), 'entries are slim');
  assert.ok(payload.librarySlice({}, ['dumbbell', 'barbell']).some(e => eqOf(e.id) === 'barbell'));
  // Custom exercises always travel: they exist nowhere else and the model cannot guess them.
  const withCustom = payload.librarySlice({ customEx: [{ id: 'cx1', n: 'Sandbag carry', bp: 'back' }] }, ['dumbbell']);
  assert.equal(withCustom[0].id, 'cx1');
});

test('the library slice is capped, balanced across body parts, deterministic, and keeps what the user trains', () => {
  const { MAX_LIBRARY, LIBRARY } = payload;
  const all = payload.librarySlice({}, []);
  assert.ok(LIBRARY.length > MAX_LIBRARY, 'the catalogue is bigger than the cap, or this test proves nothing');
  assert.equal(all.length, MAX_LIBRARY);
  const byBp = {};
  all.forEach(e => { byBp[e.bp] = (byBp[e.bp] || 0) + 1; });
  const parts = Object.keys(byBp).length;
  assert.ok(parts >= 8, `only ${parts} body parts represented`);
  // Small groups (neck has two rows) run out early and their share flows to the rest, so the
  // bound is "nobody dominates", not "everyone equal".
  assert.ok(Math.max(...Object.values(byBp)) <= MAX_LIBRARY / 4, `one body part dominates: ${JSON.stringify(byBp)}`);
  assert.equal(byBp.neck, LIBRARY.filter(e => e.bp === 'neck').length, 'a tiny group is present in full');
  assert.deepEqual(all.map(e => e.id), payload.librarySlice({}, []).map(e => e.id), 'same slice every time');

  // An exercise the user already trains rides along even when the filter would exclude it.
  const barbell = LIBRARY.find(e => e.eq === 'barbell');
  const kept = payload.librarySlice({}, ['dumbbell'], { keep: [barbell.id] });
  assert.equal(kept[0].id, barbell.id);
  assert.ok(kept.length <= MAX_LIBRARY + 1);

  // …and through build(): the plan's own exercises are in the slice for a review.
  const S = sampleState();
  const planIds = S.routines.flatMap(r => r.ex.map(e => e.id));
  const p = payload.build(S, { handle: 'h'.repeat(16), kind: 'review' });
  assert.ok(planIds.every(id => p.library.some(e => e.id === id)), 'every plan exercise is in the slice');
  assert.ok(p.library.length <= MAX_LIBRARY + planIds.length);
});

test('equipment nobody in the library has still yields a usable library', () => {
  // Better a slightly larger payload than a Coach that cannot propose anything at all.
  assert.ok(payload.librarySlice({}, ['moon rocks']).length > 0);
});

test('declined changes are carried forward so the Coach does not nag', () => {
  const S = sampleState();
  S.coach.log = [{ decisions: [{ status: 'rejected', type: 'sets', why: 'bench accessory volume -1 set' }] }];
  const p = payload.build(S, { handle: handleFor('u1'), kind: 'review' });
  assert.equal(p.previouslyDeclined.length, 1);
  assert.equal(p.previouslyDeclined[0].type, 'sets');
});

/* ---------- debriefs and the cohort ---------- */
const debriefState = () => sampleState({
  workouts: [
    { id: 'w0', d: '2026-07-06', name: 'Full body A', start: 1000, end: 1000 + 40 * 60000, vol: 500, prs: [], entries: [{ id: '0001', sets: [{ w: 18, r: 10, done: true }] }] },
    { id: 'wx', d: '2026-07-10', name: 'Other', start: 1000, end: 1000 + 30 * 60000, vol: 100, prs: [], entries: [{ id: '0007', sets: [{ sec: 45, done: true }] }] },
    { id: 'w1', d: '2026-07-13', name: 'Full body A', start: 1000, end: 1000 + 42 * 60000, vol: 560, prs: [], entries: [{ id: '0001', sets: [{ w: 20, r: 9, done: true }] }] },
    { id: 'w2', d: '2026-07-20', name: 'Full body A', start: 1000, end: 1000 + 45 * 60000, vol: 600, prs: ['0001'], entries: [{ id: '0001', target: { sets: 3, reps: 10, weight: 20 }, sets: [{ w: 20, r: 10, done: true, warmup: true }, { w: 20, r: 10, done: true }, { w: 20, r: 9, done: true }, { w: 20, r: 8, done: false }] }] }
  ]
});

test('a debrief payload carries one session, its predecessors of the same routine, and no library', () => {
  const p = payload.build(debriefState(), { handle: handleFor('u'), kind: 'debrief', workoutId: 'w2' });
  assert.equal(p.task, 'debrief');
  assert.equal(p.session.id, 'w2');
  assert.equal(p.session.entries[0].sets.length, 4);
  assert.deepEqual(p.previous.map(w => w.d), ['2026-07-06', '2026-07-13']);
  assert.equal('library' in p, false);
  assert.equal('window' in p, false);
  assert.ok(p.aggregates && Array.isArray(p.aggregates.exercises));
  assert.ok(p.bodyweight.series.every(b => b.d <= '2026-07-20'));
});

test('an unknown workout id falls back to the latest session', () => {
  const p = payload.build(debriefState(), { handle: handleFor('u'), kind: 'debrief', workoutId: 'nope' });
  assert.equal(p.session.id, 'w2');
  const latest = payload.build(debriefState(), { handle: handleFor('u'), kind: 'debrief' });
  assert.equal(latest.session.id, 'w2');
});

test('workoutMeta counts done work sets, keeps the stored volume and the PR count', () => {
  const m = payload.workoutMeta(debriefState(), 'w2');
  assert.deepEqual(m, { id: 'w2', d: '2026-07-20', name: 'Full body A', minutes: 45, vol: 600, sets: 2, prs: 1 });
  assert.equal(payload.workoutMeta(sampleState({ workouts: [] }), 'w2'), null);
  // No stored volume: computed from the work sets.
  const S = sampleState({ workouts: [{ id: 'q', d: '2026-07-01', start: 1, end: 60001, entries: [{ id: '0001', sets: [{ w: 10, r: 10, done: true }, { w: 10, r: 10, done: true, phase: 'warmup' }] }] }] });
  assert.equal(payload.workoutMeta(S, 'q').vol, 100);
});

test('the cohort rides along on a review and a debrief only when handed in', () => {
  const cohort = { unit: 'kg', people: 4, sessionsPerWeek: { median: 2.5, you: 3 }, exercises: [{ id: '0001', name: 'x', median: 50, you: 55 }] };
  const review = payload.build(sampleState(), { handle: handleFor('u'), kind: 'review', cohort });
  assert.deepEqual(review.cohort, cohort);
  const debrief = payload.build(debriefState(), { handle: handleFor('u'), kind: 'debrief', cohort });
  assert.deepEqual(debrief.cohort, cohort);
  assert.equal('cohort' in payload.build(sampleState(), { handle: handleFor('u'), kind: 'review' }), false);
  assert.equal('cohort' in payload.build(sampleState(), { handle: handleFor('u'), kind: 'create', cohort }), false);
});

test('a refine with no plan to refine is a fresh plan with a note, never refine.previous = null', () => {
  const S = sampleState();
  const p = payload.build(S, { handle: handleFor('u1'), kind: 'create', refine: 'three days, no barbell', previous: null });
  assert.equal(p.task, 'create');
  assert.equal(p.refine, undefined);
  assert.equal(p.userNote, 'three days, no barbell');
  const q = payload.build(S, { handle: handleFor('u1'), kind: 'create', refine: 'shorter', previous: { routines: [] } });
  assert.deepEqual(q.refine, { text: 'shorter', previous: { routines: [] } });
  assert.equal(q.userNote, undefined);
});

test('the last few chat lines travel as conversation — user text and Coach verdicts only, never the message being sent', () => {
  const S = sampleState();
  S.coach = { ...(S.coach || {}), chat: [
    { role: 'coach', kind: 'text', text: 'Hi — I’m your Coach.' },
    { role: 'user', kind: 'intake' },
    { role: 'user', kind: 'text', text: 'my knee hurts on lunges' },
    { role: 'coach', kind: 'error', text: 'The Coach couldn’t run.' },
    { role: 'coach', kind: 'nochange', text: 'Nothing to change yet; watch the knee.' },
    { role: 'coach', kind: 'applied', text: 'Applied 2 changes' },
    { role: 'user', kind: 'text', text: 'x'.repeat(500) },
    { role: 'user', kind: 'text', text: 'and what about that?' }
  ] };
  const p = payload.build(S, { handle: handleFor('u1'), kind: 'review', note: 'and what about that?' });
  assert.deepEqual(p.conversation.map(l => l.who), ['coach', 'user', 'coach', 'user']);
  assert.equal(p.conversation[1].text, 'my knee hurts on lunges');
  assert.equal(p.conversation[3].text.length, payload.CONVERSATION_CHARS, 'long lines are cut');
  assert.ok(!JSON.stringify(p.conversation).includes('couldn’t run'), 'error lines are noise');
  assert.ok(!p.conversation.some(l => l.text === 'and what about that?'), 'the current message rides in userNote');
  const d = payload.build(S, { handle: handleFor('u1'), kind: 'debrief' });
  assert.equal(d.conversation, undefined, 'a debrief reads one session and nothing else');
  const none = payload.build(sampleState(), { handle: handleFor('u1'), kind: 'review' });
  assert.equal(none.conversation, undefined);
});
