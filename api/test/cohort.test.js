/* "Compare with others": medians across the profiles that opted in, gated on a minimum
 * headcount, computed from the state files on disk. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const cohort = await import('../coach/cohort.js');

const today = new Date().toISOString().slice(0, 10);
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
// One workout per week for `weeks` weeks, each with one top set on exercise 0001 (and 0002).
const lifter = (w1, w2, { unit = 'kg', weeks = 4 } = {}) => sampleState({
  unit,
  workouts: Array.from({ length: weeks }, (_, i) => ({
    id: 'w' + i, d: daysAgo(i * 7 + 1), name: 'A', start: 1, end: 60001, vol: 0, prs: [],
    entries: [
      { id: '0001', sets: [{ w: w1, r: 5, done: true }, { w: w1 * 2, r: 5, done: true, warmup: true }] },
      ...(w2 ? [{ id: '0002', sets: [{ w: w2, r: 10, done: true }] }] : [])
    ]
  }))
});
const e = (w, r) => w * (1 + Math.min(r, 12) / 30);

cfg.save({ enabled: true, provider: 'fixture', community: true });
writeState(DIR, 'a', lifter(100, 40));
writeState(DIR, 'b', lifter(80, 30));
writeState(DIR, 'c', lifter(60, null));
writeState(DIR, 'd', lifter(220, 88, { unit: 'lb', weeks: 8 }));   // ≈ 100 kg / 40 kg
writeState(DIR, 'quiet', lifter(500, 500));                         // never opts in

test('a profile that does not share sees nothing, whatever the others do', () => {
  assert.deepEqual(cohort.computeCohort('a'), { ok: false, enabled: true, sharing: false });
  assert.equal(cohort.cohortForPayload('a'), null);
});

test('below the minimum headcount there are no numbers, only how many are missing', () => {
  jobs.setShare('a', true); jobs.setShare('b', true);
  const r = cohort.computeCohort('a');
  assert.equal(r.ok, false);
  assert.equal(r.people, 2);
  assert.equal(r.minPeople, cohort.MIN_PEOPLE);
  assert.equal(cohort.cohortForPayload('a'), null);
});

test('medians, headcounts and the requester\'s own numbers; warm-ups never count', () => {
  jobs.setShare('c', true); jobs.setShare('d', true);
  const r = cohort.computeCohort('a');
  assert.equal(r.ok, true);
  assert.equal(r.people, 4);
  assert.equal(r.unit, 'kg');
  const ex1 = r.exercises.find(x => x.id === '0001');
  assert.equal(ex1.people, 4);
  // bests in kg: 100, 80, 60, ~99.8 → sorted 60, 80, 99.8, 100 → median index 2
  assert.equal(ex1.median, Math.round(e(220 * 0.45359237, 5) * 10) / 10);
  assert.equal(ex1.you, Math.round(e(100, 5) * 10) / 10);
  // 0002 is trained by three (a, b, d) — in; a's value is her own.
  const ex2 = r.exercises.find(x => x.id === '0002');
  assert.equal(ex2.people, 3);
  assert.equal(ex2.you, Math.round(e(40, 10) * 10) / 10);
  // The quiet profile's absurd numbers are nowhere.
  assert.ok(r.exercises.every(x => x.median < 200));
  // a: 4 workouts in 8 weeks → 0.5; d: 8 → 1; median of [0.5,0.5,0.5,1] → 0.5
  assert.equal(r.sessionsPerWeek.you, 0.5);
  assert.equal(r.sessionsPerWeek.median, 0.5);
  // a is the strongest on 0001 (3 of 3 others at or below) and joint-top on 0002 with d's
  // 88 lb ≈ 39.9 kg just under 40 → 2 of 2 → rank 100.
  assert.equal(r.rankPct, 100);
  assert.equal(cohort.computeCohort('c').rankPct, 0);
});

test('a requester in pounds gets pounds back; the prompt always gets kilograms', () => {
  const r = cohort.computeCohort('d');
  assert.equal(r.unit, 'lb');
  const ex1 = r.exercises.find(x => x.id === '0001');
  assert.equal(ex1.you, Math.round(e(220, 5) * 10) / 10);
  const p = cohort.cohortForPayload('d');
  assert.equal(p.unit, 'kg');
  assert.equal(p.people, 4);
  assert.equal(p.exercises.find(x => x.id === '0001').you, Math.round(e(220 * 0.45359237, 5) * 10) / 10);
  assert.ok(!('people' in p.exercises[0]));
});

test('opting out takes effect immediately, cache or no cache', () => {
  assert.equal(cohort.computeCohort('a').people, 4);
  jobs.setShare('d', false);
  const r = cohort.computeCohort('a');
  assert.equal(r.people, 3);
  assert.equal(r.exercises.find(x => x.id === '0002'), undefined);   // only two left on it
  jobs.setShare('a', false);
  assert.equal(cohort.computeCohort('a').sharing, false);
  assert.equal(cohort.computeCohort('b').ok, false);                  // two sharing
});

test('the admin switch decides whether the prompt ever sees a cohort', () => {
  jobs.setShare('a', true); jobs.setShare('d', true);
  assert.ok(cohort.cohortForPayload('a'));
  cfg.save({ community: false });
  assert.equal(cohort.cohortForPayload('a'), null);
  cfg.save({ community: true });
});
