import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const { validateWorkout } = await import('../coach/core/validate.js');
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
const { librarySlice, LIBRARY, isStretch } = await import('../coach/core/library.js');

const active = {
  entries: [
    { key: 'press', id: '0001', target: { sets: 3, reps: 10, weight: 40 }, sets: [{ w: 40, r: 10, done: true }, { w: 40, r: 10, done: false }, { w: 40, r: 10, done: false }] },
    { key: 'row', id: '0002', target: { sets: 3, reps: 12, weight: 30 }, sets: [{ w: 30, r: 12, done: false }] }
  ]
};
const answer = actions => ({ coach_contract: 1, reply: 'Use the pain-free option and continue.', reason: 'discomfort', actions });

test('workout actions resolve against the live entry and cannot increase unfinished work', () => {
  const good = validateWorkout(answer([{ id: 'a1', type: 'adjust-exercise', target: { entryKey: 'press', exerciseId: '0001' }, after: { remainingSets: 1, reps: 8, weight: 30, restSec: 180 }, why: 'Reduce the aggravating work.' }]), active, { libraryIds: ['0001', '0002', '0003'] });
  assert.equal(good.ok, true);
  assert.deepEqual(good.proposal.actions[0].after, { remainingSets: 1, reps: 8, weight: 30, restSec: 180 });

  const heavier = validateWorkout(answer([{ type: 'adjust-exercise', target: { entryKey: 'press', exerciseId: '0001' }, after: { weight: 45 }, why: 'More.' }]), active, { libraryIds: ['0001'] });
  assert.equal(heavier.ok, false);
});

test('an adjustment may only name fields the remaining sets have, and rest stays in range', () => {
  const hold = { entries: [{ key: 'h', id: '0007', sets: [{ sec: 45, done: false }] }] };
  const adjust = after => validateWorkout(answer([{ type: 'adjust-exercise', target: { entryKey: 'h', exerciseId: '0007' }, after, why: 'Shorter today.' }]), hold);
  assert.equal(adjust({ reps: 8 }).ok, false, 'no reps on a timed hold');
  assert.equal(adjust({ weight: 0 }).ok, false, 'no load where there is none');
  assert.equal(adjust({ restSec: 0 }).ok, false);
  assert.deepEqual(adjust({ sec: 30, restSec: 120 }).proposal.actions[0].after, { sec: 30, restSec: 120 });
});

test('completed exercises, invented exercises and duplicate targets are refused', () => {
  const completed = structuredClone(active);
  completed.entries[0].sets.forEach(set => { set.done = true; });
  assert.equal(validateWorkout(answer([{ type: 'skip-exercise', target: { entryKey: 'press', exerciseId: '0001' }, after: {}, why: 'Stop this movement.' }]), completed).ok, false);
  assert.equal(validateWorkout(answer([{ type: 'swap-exercise', target: { entryKey: 'row', exerciseId: '0002' }, after: { id: 'invented', sets: 1 }, why: 'Use another movement.' }]), active, { libraryIds: ['0001', '0002'] }).ok, false);
  assert.equal(validateWorkout(answer([
    { type: 'skip-exercise', target: { entryKey: 'row', exerciseId: '0002' }, after: {}, why: 'Skip.' },
    { type: 'adjust-exercise', target: { entryKey: 'row', exerciseId: '0002' }, after: { reps: 8 }, why: 'Change.' }
  ]), active).ok, false);
});

test('a note needs text, is cut to one line\'s worth, and targets nothing', () => {
  const result = validateWorkout(answer([{ type: 'note', after: { text: '  Lunges felt too easy at 20 reps.  ' }, why: 'Worth knowing next time.' }]), active);
  assert.equal(result.ok, true);
  assert.deepEqual(result.proposal.actions[0].after, { text: 'Lunges felt too easy at 20 reps.' });
  assert.equal('target' in result.proposal.actions[0], false);
  assert.equal(validateWorkout(answer([{ type: 'note', after: {}, why: 'Empty.' }]), active).ok, false);
});

test('a superset moves as a unit, and a swap can carry its reps or hold time', () => {
  const grouped = { entries: [{ key: 'a', id: '0001', sg: 'g', sets: [{ done: false }] }, { key: 'b', id: '0002', sg: 'g', sets: [{ done: false }] }, { key: 'c', id: '0003', sets: [{ done: false }] }] };
  const moved = validateWorkout(answer([{ type: 'move-exercise', target: { entryKey: 'a', exerciseId: '0001' }, after: { afterEntryKey: 'c' }, why: 'The rack is busy.' }]), grouped);
  assert.equal(moved.ok, true);
  const swapped = validateWorkout(answer([{ type: 'swap-exercise', target: { entryKey: 'c', exerciseId: '0003' }, after: { id: '0004', sets: 1, sec: 40 }, why: 'A hold instead.' }]), grouped, { libraryIds: ['0004'] });
  assert.deepEqual(swapped.proposal.actions[0].after, { id: '0004', sets: 1, sec: 40 });
});

test('a workout job runs end to end and holds a checked proposal for that workout', async () => {
  cfg.save({ enabled: true, provider: 'fixture' });
  forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });
  const uid = 'u-workout';
  writeState(DIR, uid, sampleState());
  const session = {
    id: 'live-1', d: '2026-10-08', name: 'Full body A', anchorKey: 'k1',
    coachChat: [{ role: 'user', text: 'My shoulder does not feel right on this.' }],
    entries: [{ key: 'k1', id: '0001', rid: 'r1', target: { sets: 3, reps: 10, weight: 20 }, sets: [{ w: 20, r: 10, done: true }, { w: 20, r: 10, done: false }, { w: 20, r: 10, done: false }] }]
  };
  jobs.enqueue(uid, { kind: 'workout', note: 'My shoulder does not feel right on this.', session });
  const until = Date.now() + 15000;
  while (jobs.status(uid).job && Date.now() < until) await new Promise(r => setTimeout(r, 25));
  const { pending } = jobs.status(uid);
  assert.equal(pending.kind, 'workout');
  assert.equal(pending.activeId, 'live-1');
  assert.equal(pending.reason, 'discomfort');
  assert.deepEqual(pending.actions.map(a => a.type), ['swap-exercise', 'note']);
  assert.deepEqual(pending.actions[0].target, { entryKey: 'k1', exerciseId: '0001' });
  assert.equal(pending.actions[0].after.sets, 2, 'only the unfinished sets move');
  jobs.resolvePending(uid, { accepted: ['a1'] });
  assert.equal(jobs.status(uid).pending, null);
});

test('a question about one exercise brings its close substitutes, for a catalogue or a custom exercise', () => {
  // Any lift whose target muscle has a dozen others across several kinds of equipment.
  const lifts = LIBRARY.filter(e => e.tg && e.eq && !isStretch(e));
  const peers = e => lifts.filter(x => x.tg === e.tg);
  const anchor = lifts.find(e => peers(e).length > 12 && new Set(peers(e).map(x => x.eq)).size >= 4);
  const slice = librarySlice({}, [], { focus: [anchor.id], max: 30, detail: true });
  assert.equal(slice[0].id, anchor.id);
  const near = slice.slice(1, 13);
  assert.ok(near.every(e => e.tg === anchor.tg && e.eq), 'the nearest rows share its target and name their equipment');
  assert.ok(new Set(near.map(e => e.eq)).size >= 4, 'and span several kinds of equipment');

  const custom = { id: 'my-split-squat', n: 'bulgarian split squat', bp: anchor.bp, tg: '' };
  const own = librarySlice({ customEx: [custom] }, [], { focus: [custom.id], max: 30, detail: true }).filter(e => !e.custom);
  assert.ok(own.slice(0, 8).every(e => e.bp === anchor.bp), 'a custom exercise gets substitutes from the body part it names');
});
