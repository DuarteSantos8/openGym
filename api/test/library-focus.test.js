// #829: a review asked for "more core work" could only pick from the same four ab exercises,
// the first four of the waist lane in catalogue order, and a plan that pinned most of the
// review's 60 candidates left nothing new to swap in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payload = await import('../coach/core/payload.js');
const { focusOf } = await import('../coach/core/library.js');

const waist = lib => lib.filter(e => e.bp === 'waist');
const H = 'h'.repeat(16);

test('the body parts and muscles a note names, in a few languages, whole words only', () => {
  const f = focusOf('I want more core work and bigger biceps');
  assert.ok(f.parts.has('waist') && f.parts.has('upper arms'));
  assert.ok(f.muscles.has('biceps'));
  assert.ok(focusOf('Mehr Bauch und Rücken bitte').parts.has('back'));
  assert.ok(focusOf('más abdominales').parts.has('waist'));
  assert.equal(focusOf('ab Montag, abnormal, coreless').parts.size, 0);
  assert.equal(focusOf(undefined, null, 42).parts.size, 0);
});

test('a review note asking for core work gets a real choice of core exercises', () => {
  const S = sampleState();
  const plain = payload.build(S, { handle: H, kind: 'review' }).library;
  const core = payload.build(S, { handle: H, kind: 'review', note: 'Add more core work please' }).library;
  assert.ok(waist(core).length >= 10, `only ${waist(core).length} core exercises`);
  assert.ok(waist(core).length > waist(plain).length * 2, `${waist(core).length} vs ${waist(plain).length}`);
  assert.ok(core.length <= 60 + payload.REVIEW_FRESH, 'the size budget holds');
  // Deterministic: the same note gives the same slice.
  assert.deepEqual(core.map(e => e.id), payload.build(S, { handle: H, kind: 'review', note: 'Add more core work please' }).library.map(e => e.id));
});

test('the profile goal counts as a focus too', () => {
  const S = sampleState();
  S.coach = { ...(S.coach || {}), profile: { goal: 'abs', equipment: [] } };
  const lib = payload.build(S, { handle: H, kind: 'review' }).library;
  assert.ok(waist(lib).length >= 10);
});

test('a lane is spread over its exercises, not its first few', () => {
  const ids = waist(payload.librarySlice({}, [], { max: 60, focus: 'core' })).map(e => e.id);
  const prefix = payload.LIBRARY.filter(e => e.bp === 'waist').slice(0, ids.length).map(e => e.id);
  assert.notDeepEqual(ids, prefix);
  // ...and still from the well-known exercises first, not yoga or mobility
  assert.ok(ids.every(id => /^\d{4}$/.test(id)), ids.join(' '));
});

test('a plan that pins the whole budget still leaves room for alternatives', () => {
  const S = sampleState();
  const lifts = payload.LIBRARY.filter(e => e.bp === 'chest').slice(0, 70).map(e => ({ id: e.id }));
  S.routines = [{ id: 'big', name: 'Everything', ex: lifts }];
  const lib = payload.build(S, { handle: H, kind: 'review', note: 'more core' }).library;
  const pinned = new Set(lifts.map(e => e.id));
  const fresh = lib.filter(e => !pinned.has(e.id));
  assert.ok(lifts.every(e => lib.some(x => x.id === e.id)), 'the plan is all there');
  assert.ok(fresh.length >= payload.REVIEW_FRESH, `${fresh.length} alternatives`);
  assert.ok(waist(fresh).length >= 6, `${waist(fresh).length} core alternatives`);
});
