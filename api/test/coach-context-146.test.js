/* What the Coach reads since coach-146: strength records, body measurements, health and the loop,
 * each behind its switch under "What the Coach sees" (core/categories.js). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordsOf, measurementsOf, healthOf, cleanVitals, rotationOf } from '../coach/core/context.js';
import { shareOf, OPTIONAL_CATEGORIES } from '../coach/core/categories.js';
import { build } from '../coach/core/payload.js';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const day = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const set = (w, r) => ({ w, r, done: true });
const workout = (n, id, sets) => ({ id: 'w' + n + id, d: day(n), entries: [{ id, sets }] });

test('records: best e1RM, recent against the 8 weeks before, warm-ups and high reps ignored', () => {
  const S = { workouts: [
    workout(70, '0025', [set(100, 5)]),
    workout(40, '0025', [set(100, 5), { w: 200, r: 1, warmup: true, done: true }]),
    workout(10, '0025', [set(110, 5), set(60, 20)]),
    workout(5, '0032', [set(50, 8)])
  ] };
  const r = recordsOf(S, NOW);
  const bench = r.find(x => x.id === '0025');
  assert.equal(bench.best, 128.3);
  assert.equal(bench.bestOn, day(10));
  assert.equal(bench.recent, 128.3);
  assert.equal(bench.before, 116.7);
  assert.equal(bench.trendPct, 10);
  assert.ok(r.find(x => x.id === '0032'));
  assert.equal(r[0].id, '0025', 'the most trained first');
});

test('measurements: latest and about eight weeks before, health keys and junk left out', () => {
  const S = { measurements: [
    { d: day(70), t: 1, waist: 90, bpSys: 130, bpDia: 85, other: [] },
    { d: day(3), t: 2, waist: 86.25, chest: 101, note: 'after holiday', bpSys: 120, bpDia: 80, pulse: 60 },
    { d: day(1), t: 3, chest: 'x' }
  ] };
  const m = measurementsOf(S, NOW);
  assert.deepEqual(m.find(x => x.key === 'waist'), { key: 'waist', last: 86.3, on: day(3), was: 90, wasOn: day(70) });
  assert.deepEqual(m.find(x => x.key === 'chest'), { key: 'chest', last: 101, on: day(3) });
  assert.ok(!m.some(x => ['bpSys', 'bpDia', 'pulse', 't', 'note'].includes(x.key)));
});

test('health: check-ins of two weeks, bounded vitals, the latest blood pressure', () => {
  const S = {
    dayForm: { [day(1)]: { sleep: 2, energy: 3, sore: 9, stress: 4 }, [day(30)]: { sleep: 5 }, bogus: { sleep: 1 } },
    measurements: [{ d: day(3), bpSys: 120, bpDia: 80, pulse: 60 }]
  };
  const h = healthOf(S, NOW, { sleep: { v: 380, d: day(1), usual: 450 }, steps: { v: -5 }, hrv: { v: 9999 }, evil: { v: 1 } });
  assert.deepEqual(h.checkins, [{ d: day(1), sleep: 2, energy: 3, stress: 4 }]);
  assert.deepEqual(h.vitals, { sleep: { v: 380, d: day(1), usual: 450 } });
  assert.deepEqual(h.bloodPressure, { d: day(3), sys: 120, dia: 80, pulse: 60 });
  assert.equal(healthOf({}, NOW, null), null);
  assert.equal(cleanVitals('nope'), null);
});

test('rotation: the loop and what is next, only when the plan runs as one', () => {
  assert.deepEqual(rotationOf({ scheduleMode: 'rotation', rotation: { sequence: ['a', 'b', null], at: 4 } }), { sequence: ['a', 'b', 'rest'], next: 'b' });
  assert.equal(rotationOf({ scheduleMode: 'week', rotation: { sequence: ['a'] } }), null);
});

test('the switches: records and measurements on, health off, until the person says otherwise', () => {
  assert.deepEqual(OPTIONAL_CATEGORIES.map(c => [c.id, c.on]), [['records', true], ['measurements', true], ['health', false]]);
  assert.deepEqual(shareOf({}), { records: true, measurements: true, health: false });
  assert.deepEqual(shareOf({ coach: { share: { records: false, health: true, junk: 1 } } }), { records: false, measurements: true, health: true });
});

test('the payload carries each block only when its switch is on, and never health by default', () => {
  const S = {
    workouts: [workout(5, '0025', [set(100, 5)]), workout(3, '0025', [set(100, 5)]), workout(1, '0025', [set(102.5, 5)])],
    measurements: [{ d: day(2), waist: 85 }],
    dayForm: { [day(1)]: { sleep: 2 } }
  };
  const on = build(S, { handle: 'h'.repeat(16), kind: 'ask', note: 'how am I doing?', now: NOW });
  assert.ok(on.records && on.records.length);
  assert.ok(on.measurements && on.measurements.length);
  assert.equal(on.health, undefined, 'health stays home until switched on');
  const all = build({ ...S, coach: { share: { health: true, records: false, measurements: false } } }, { handle: 'h'.repeat(16), kind: 'review', now: NOW, vitals: { steps: { v: 8000 } } });
  assert.equal(all.records, undefined);
  assert.equal(all.measurements, undefined);
  assert.deepEqual(all.health.vitals, { steps: { v: 8000 } });
  const create = build({ ...S, coach: { share: { health: true } } }, { handle: 'h'.repeat(16), kind: 'create', now: NOW });
  assert.equal(create.health, undefined, 'a new plan reads none of it');
});
