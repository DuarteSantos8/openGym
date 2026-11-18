import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planChecks, tagOfRef } from '../coach/core/checks.js';
import { EVIDENCE, TAGS } from '../coach/core/evidence.js';

// 0025 is the bench press (chest), 0027 a bent over row (lats and upper back).
const plan = (ex, over = {}) => ({ routines: [{ id: 'a', ex }], week: { 1: ['a'] }, ...over });
const ids = cs => cs.map(c => c.id);

test('lats at 6 sets sit under the default range', () => {
  const S = plan([{ id: '0027', sets: 6 }]);
  const c = planChecks(S, {}).find(x => x.id === 'volume-low:lats');
  assert.ok(c, ids(planChecks(S, {})).join());
  assert.deepEqual(c, { id: 'volume-low:lats', tag: 'volume', muscle: 'lats', sets: 6, low: 10, high: 20 });
});

test('a range the person edited wins, a legacy slug key too', () => {
  const S = plan([{ id: '0027', sets: 6 }], { muscleTargets: { lats: [4, 8] } });
  assert.ok(!ids(planChecks(S, {})).includes('volume-low:lats'));
  const legacy = plan([{ id: '0027', sets: 6 }], { muscleTargets: { 'upper-back': [4, 8] } });
  assert.ok(!ids(planChecks(legacy, {})).includes('volume-low:lats'));
});

test('chest at 24 sets is over the range', () => {
  const c = planChecks(plan([{ id: '0025', sets: 6 }, { id: '0025', sets: 6 }, { id: '0025', sets: 6 }, { id: '0025', sets: 6 }]), {});
  const hi = c.find(x => x.id === 'volume-high:chest');
  assert.deepEqual(hi, { id: 'volume-high:chest', tag: 'volume-cap', muscle: 'chest', sets: 24, low: 10, high: 20 });
});

test('frequency only for strength, only for a weekday plan', () => {
  const S = plan([{ id: '0025', sets: 3 }]);
  const f = planChecks(S, { goal: 'strength' }).find(x => x.id === 'frequency:chest');
  assert.deepEqual(f, { id: 'frequency:chest', tag: 'frequency', muscle: 'chest', sessions: 1 });
  assert.ok(!ids(planChecks(S, { goal: 'muscle' })).some(i => i.startsWith('frequency')));
  const twice = plan([{ id: '0025', sets: 3 }], { week: { 1: ['a'], 4: ['a'] } });
  assert.ok(!ids(planChecks(twice, { goal: 'strength' })).includes('frequency:chest'));
  const rot = { ...S, scheduleMode: 'rotation' };
  assert.ok(!ids(planChecks(rot, { goal: 'strength' })).some(i => i.startsWith('frequency')));
  const queued = { ...S, routines: [{ id: 'a', ex: [{ id: '0025', sets: 3 }] }, { id: 'b', ex: [{ id: '0025', sets: 3 }] }], queue: { ids: ['b'], since: 1, startsOn: '2026-08-17' } };
  assert.ok(!ids(planChecks(queued, { goal: 'strength' })).some(i => i.startsWith('frequency')));
});

test('a supporting muscle does not make a session count', () => {
  const S = { routines: [{ id: 'a', ex: [{ id: '0025', sets: 3 }] }, { id: 'b', ex: [{ id: '0025', sets: 3 }] }], week: { 1: ['a'], 4: ['b'] } };
  // chest in both; triceps is only supporting there, so it has no frequency check either way
  assert.ok(!ids(planChecks(S, { goal: 'strength' })).includes('frequency:triceps'));
});

test('sets per exercise: cap 4, 3 for a beginner', () => {
  const S = plan([{ id: '0025', sets: 5 }]);
  const c = planChecks(S, {}).find(x => x.tag === 'sets-per-exercise');
  assert.deepEqual(c, { id: 'sets-per-exercise:a:0025', tag: 'sets-per-exercise', routine: 'a', exercise: '0025', sets: 5, cap: 4 });
  const b = planChecks(plan([{ id: '0025', sets: 4 }]), { experience: 'new' }).find(x => x.tag === 'sets-per-exercise');
  assert.equal(b.cap, 3);
  assert.ok(!planChecks(plan([{ id: '0025', sets: 4 }]), {}).some(x => x.tag === 'sets-per-exercise'));
});

test('an empty state and an empty week give nothing', () => {
  assert.deepEqual(planChecks({}, null), []);
  assert.deepEqual(planChecks({ routines: [{ id: 'a', ex: [] }], week: {} }, {}), []);
});

test('a muscle with no range is never checked', () => {
  const S = plan([{ id: '0025', sets: 3 }]);
  assert.ok(planChecks(S, {}).every(c => !c.muscle || ['chest', 'lats', 'upper-back', 'front-delts', 'side-delts', 'rear-delts', 'biceps', 'triceps', 'quadriceps', 'hamstring', 'gluteal', 'calves', 'abs'].includes(c.muscle)));
  const forearm = { routines: [{ id: 'a', ex: [{ id: 'c1', sets: 2 }] }], week: { 1: ['a'] }, customEx: [{ id: 'c1', n: 'Curl', muscleWeights: { forearm: 1 } }] };
  assert.deepEqual(planChecks(forearm, { goal: 'strength' }), []);
});

test('checks come in the agreed order', () => {
  const S = plan([{ id: '0027', sets: 5 }, { id: '0025', sets: 5 }, { id: '0025', sets: 5 }, { id: '0025', sets: 5 }, { id: '0025', sets: 5 }]);
  const order = planChecks(S, { goal: 'strength' }).map(c => c.tag);
  const rank = t => ['volume', 'frequency', 'sets-per-exercise', 'volume-cap'].indexOf(t);
  assert.deepEqual(order, [...order].sort((a, b) => rank(a) - rank(b)));
});

test('tagOfRef finds the tag of a listed check, else null', () => {
  const cs = [{ id: 'volume-low:lats', tag: 'volume' }];
  assert.equal(tagOfRef('volume-low:lats', cs), 'volume');
  assert.equal(tagOfRef('volume-low:chest', cs), null);
  assert.equal(tagOfRef(undefined, cs), null);
});

test('every source is cited, graded and has a PubMed id unless it is our rule', () => {
  assert.equal(TAGS.length, 13);
  for (const [tag, e] of Object.entries(EVIDENCE)) {
    assert.ok(e.use && !/\d{4}/.test(e.use), tag);
    for (const s of e.sources) {
      assert.ok(s.cite && s.grade && s.finding, tag);
      if (s.grade !== 'our rule') assert.match(s.pmid, /^\d{7,9}$/, s.cite);
    }
  }
});

test('the docs page has a heading per tag and lists every study', () => {
  const page = readFileSync(new URL('../../docs/COACH_EVIDENCE.md', import.meta.url), 'utf8');
  for (const tag of TAGS) assert.ok(page.includes(`\n## ${tag}\n`), tag);
  for (const e of Object.values(EVIDENCE)) for (const s of e.sources) if (s.pmid) assert.ok(page.includes(s.pmid), s.pmid);
});
