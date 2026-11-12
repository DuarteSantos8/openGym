import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinIndex, normalizeIndex, cleanEntry, searchRoutines, compactEntry, entryToBundle, asksForBodyweight, FORMAT } from '../coach/core/routine-library.js';
import { validatePlan } from '../coach/core/validate.js';

test('the built-in index is the starter plans, every one a valid entry with its schedule', () => {
  const idx = builtinIndex();
  assert.deepEqual(idx.map(e => e.id), ['starter/ppl', 'starter/upper-lower', 'starter/full-body', 'starter/5x5', 'starter/home-bw', 'starter/dumbbells', 'starter/bands', 'starter/hotel']);
  const home = idx.find(e => e.id === 'starter/home-bw');
  assert.deepEqual(home.equipment, []);
  assert.equal(home.days, 3);
  assert.deepEqual(home.schedule, [[1, 0], [3, 1], [5, 0]]);
  assert.ok(home.sessions[0].exercises.some(x => x.sec), 'a plank stays a timed hold');
});

test('an index is refused unless it says what it is, and broken entries are left out', () => {
  assert.equal(normalizeIndex({ routines: [] }).error, 'not an openGym routines index');
  assert.match(normalizeIndex({ format: FORMAT, version: 2 }).error, /version/);
  const good = { id: 'community/a', title: 'A', sessions: [{ name: 'Day', exercises: [{ id: '0025', sets: 3, reps: 8 }] }] };
  const r = normalizeIndex({ format: FORMAT, version: 1, routines: [
    good, good,
    { id: 'community/b', title: 'B', sessions: [{ exercises: [{ id: 'nope', sets: 3 }] }] },
    { id: 'BAD ID', title: 'C', sessions: good.sessions },
    { id: 'community/d', sessions: good.sessions }
  ] });
  assert.deepEqual(r.entries.map(e => e.id), ['community/a']);
});

test('an entry is bounded field by field', () => {
  const e = cleanEntry({ id: 'x/y', title: 'T'.repeat(200), goal: 'world-domination', level: 'advanced', days: 9, url: 'javascript:alert(1)',
    sessions: [{ name: 'S', exercises: [{ id: '0025', sets: 99, reps: 1000, rest: 90 }] }], schedule: [[1, 0], [8, 0], [2, 5]] });
  assert.equal(e.title.length, 80);
  assert.equal(e.goal, null);
  assert.equal(e.level, 'advanced');
  assert.equal(e.url, undefined);
  assert.deepEqual(e.sessions[0].exercises[0], { id: '0025', sets: 3, reps: 10, rest: 90 });
  assert.deepEqual(e.schedule, [[1, 0]]);
  assert.equal(e.days, 1);
});

test('search: a bodyweight question keeps to plans that need nothing, words rank the rest', () => {
  const idx = builtinIndex();
  assert.ok(asksForBodyweight('3 full body routines only with bodyweight, a pull-up bar'));
  const bw = searchRoutines(idx, { text: '3 full body routines only with bodyweight, pull-up bar' });
  assert.ok(bw.length >= 2);
  assert.ok(bw.every(e => !e.equipment.length));
  const ppl = searchRoutines(idx, { text: 'a push pull legs split' });
  assert.equal(ppl[0].id, 'starter/ppl');
  assert.deepEqual(searchRoutines(idx, { text: 'xyzzy', equipment: ['barbell'] }).map(e => e.id).includes('starter/dumbbells'), false);
});

test('the model reads a compact entry, and an import is a plan the validator takes', () => {
  const e = builtinIndex().find(x => x.id === 'starter/full-body');
  const c = compactEntry(e);
  assert.deepEqual(Object.keys(c).sort(), ['days', 'duration', 'equipment', 'goal', 'id', 'level', 'sessions', 'split', 'title', 'author'].sort());
  assert.ok(c.sessions[0].ex.every(id => typeof id === 'string'));
  const v = validatePlan(entryToBundle(e), {});
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(Object.keys(v.bundle.week), ['1', '3', '5']);
});
