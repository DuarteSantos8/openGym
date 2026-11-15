/* What the Coach may do from the chat (core/ask-actions.js): each action checked, and the
 * plan-shaped ones turned into the proposal they are, through the plan and review validators. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAsk } from '../coach/core/validate.js';
import { attemptOnce } from '../coach/core/pipeline.js';
import { build } from '../coach/core/payload.js';
import { builtinIndex, compactEntry } from '../coach/core/routine-library.js';

const plan = { routines: [{ id: 'r1', name: 'Legs', ex: [{ id: '0043', sets: 3, reps: 8 }, { id: '0085', sets: 3, reps: 8 }] }], week: { 1: 'r1' } };
const payload = { plan, library: [], routineLibrary: [compactEntry(builtinIndex()[4])] };
const ask = (actions, extra = {}) => validateAsk({ coach_contract: 1, answer: 'Here you go.', actions }, payload, extra);

test('three full-body bodyweight routines with a schedule become one created plan', () => {
  const items = ids => ids.map(id => ({ id, sets: 3, reps: 10 }));
  const r = ask([
    { type: 'routine', name: 'Full body A', items: items(['0662', '1197', '3381']), why: 'push, legs, pull' },
    { type: 'routine', name: 'Full body B', items: items(['2921', '0781', '0815']) },
    { type: 'routine', name: 'Full body C', items: [{ id: '0463', sets: 3, sec: 40 }, { id: 662, sets: 3, reps: 12 }] },
    { type: 'schedule', day: 1, name: 'Full body A' }, { type: 'schedule', day: 3, name: 'full body b' }, { type: 'schedule', day: 5, name: 'Full body C' }
  ]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.kind, 'create');
  assert.deepEqual(r.proposal.bundle.routines.map(x => x.name), ['Full body A', 'Full body B', 'Full body C']);
  assert.deepEqual(r.proposal.bundle.week, { 1: 'r0', 3: 'r1', 5: 'r2' });
  assert.equal(r.proposal.bundle.routines[2].ex[0].mode, 'time');
  assert.equal(r.proposal.bundle.routines[2].ex[1].id, '0662', 'a numeric id is read as the padded one');
  assert.equal(r.proposal.summary, 'Here you go.');
});

test('a routine naming an exercise the library lacks, or off their equipment, goes back for repair', () => {
  const bad = ask([{ type: 'routine', name: 'X', items: [{ id: 'abcd', sets: 3, reps: 10 }] }]);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /not in the exercise library/);
  const barbell = ask([{ type: 'routine', name: 'X', items: [{ id: '0043', sets: 3, reps: 5 }] }], { equipment: ['body weight'] });
  assert.equal(barbell.ok, false);
  assert.match(barbell.errors[0], /equipment/);
  assert.equal(ask([{ type: 'routine', name: 'X', items: [] }]).ok, false);
  assert.equal(ask([{ type: 'launch-rockets' }]).ok, false);
  assert.equal(ask([{ type: 'schedule', day: 2, name: 'Nope' }, { type: 'routine', name: 'A', items: [{ id: '0662' }] }]).ok, false);
});

test('swap, target and schedule on routines they have become a review change-set', () => {
  const r = ask([
    { type: 'swap', routineId: 'r1', exId: '0085', to: '0739', why: 'knee-friendlier' },
    { type: 'target', routineId: 'r1', exId: '0043', sets: 4, reps: 6 },
    { type: 'schedule', day: 4, routineId: 'r1' }
  ]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.kind, 'review');
  assert.deepEqual(r.proposal.changes.map(c => c.type), ['swap-exercise', 'sets', 'reps', 'week']);
  assert.equal(r.proposal.changes[0].before, null);
  assert.equal(r.proposal.changes[1].before, 3, 'before is read off the plan, not the answer');
  assert.equal(ask([{ type: 'swap', routineId: 'nope', exId: '0085', to: '0739' }]).ok, false);
  assert.equal(ask([{ type: 'target', routineId: 'r1', exId: '0043' }]).ok, false);
  // Asking for what the plan already says is an answer, not a proposal.
  const same = ask([{ type: 'target', routineId: 'r1', exId: '0043', sets: 3 }]);
  assert.deepEqual([same.ok, same.kind], [true, undefined]);
});

test('the cards: a one-off workout, start, note, own exercise, an exercise card and a library import', () => {
  const r = ask([
    { type: 'workout', name: 'Quick one', items: [{ id: '0662', sets: 2, reps: 15 }] },
    { type: 'start', routineId: 'r1' },
    { type: 'note', text: 'Left knee is sensitive on deep squats.' },
    { type: 'exercise', name: 'Towel row', bp: 'back' },
    { type: 'show', exId: '0043' }, { type: 'show', exId: '0043' },
    { type: 'import', libraryId: 'starter/home-bw' }
  ]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.kind, undefined);
  assert.deepEqual(r.proposal.actions.map(a => a.type), ['workout', 'start', 'note', 'exercise', 'show', 'import']);
  assert.equal(r.proposal.actions[4].name.length > 0, true);
  assert.equal(r.proposal.actions[5].title, 'Bodyweight at home');
  assert.equal(ask([{ type: 'start', routineId: 'zzz' }]).ok, false);
  assert.equal(ask([{ type: 'import', libraryId: 'community/not-offered' }]).ok, false);
  assert.equal(ask([{ type: 'show', exId: '99999' }]).ok, false);
});

test('the pipeline: a question answered with routines waits as a created plan, sources ride along', async () => {
  const S = { workouts: [], routines: [], coach: { profile: { goal: 'general', equipment: [] } } };
  const p = build(S, { handle: 'h'.repeat(16), kind: 'ask', note: 'one full body routine with bodyweight only', now: Date.parse('2026-11-08T12:00:00Z') });
  assert.ok(p.library.length > 10);
  const answer = JSON.stringify({ coach_contract: 1, answer: 'One routine.', actions: [{ type: 'routine', name: 'Anywhere', items: [{ id: p.library.find(e => !e.custom).id, sets: 3, reps: 10 }] }] });
  const adapter = { spawns: false, invoke: async () => ({ code: 0, text: answer, sources: [{ url: 'https://e.org', title: 'E' }] }) };
  const r = await attemptOnce({ adapter, cfg: {}, kind: 'ask', payload: p });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.kind, 'create');
  assert.equal(r.result.bundle.routines[0].name, 'Anywhere');
  const plain = { spawns: false, invoke: async () => ({ code: 0, text: '{"coach_contract":1,"answer":"Rest 2 min."}', sources: [{ url: 'https://e.org/s', title: 'S' }] }) };
  const q = await attemptOnce({ adapter: plain, cfg: {}, kind: 'ask', payload: p });
  assert.equal(q.kind, undefined);
  assert.deepEqual(q.result, { answer: 'Rest 2 min.', sources: [{ url: 'https://e.org/s', title: 'S' }] });
});

test('a bodyweight question narrows the library to exercises that need nothing', () => {
  const S = { workouts: [], routines: [], coach: { profile: { equipment: ['barbell', 'dumbbell'] } } };
  const p = build(S, { handle: 'h'.repeat(16), kind: 'ask', note: 'generate 3 full body routines only with bodyweight (pull bar, push-ups, core, legs)' });
  const { LIB_BY_ID } = awaitLib;
  assert.ok(p.library.every(e => e.custom || ['body weight'].includes(LIB_BY_ID.get(e.id)?.eq)));
});
const awaitLib = await import('../coach/core/library.js');
