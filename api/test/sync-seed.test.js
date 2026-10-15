/* The onboarding seed (sync-seed.js): what it checks, what it fills in, what it leaves alone, and
   that sending it again changes nothing. The route is in server-sync-onboarding.test.js. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeed, seedState, seedView } from '../sync-seed.js';
import { highestStamp } from '../sync-stamps.js';

const NOW = Date.UTC(2026, 9, 15, 9);
const TODAY = '2026-10-15';
let n = 0;
const newId = () => `r${++n}`;

const PLAN = {
  routines: [
    { name: 'Full Body A', emoji: 'figureStrength', ex: [{ id: '0043', sets: 3, reps: 8 }, { id: '0025', sets: 3, reps: 8 }] },
    { name: 'Full Body B', ex: [{ id: '0085', sets: 3, reps: 8 }] }
  ],
  schedule: [{ day: 1, routine: 0 }, { day: 4, routine: 1 }]
};
const FULL = {
  unit: 'lb',
  bodyweight: { date: TODAY, kg: 80 },
  coachProfile: { goal: 'muscle', experience: 'new', daysPerWeek: 2, preferredDays: [4, 1] },
  plan: PLAN,
  checkIn: false
};
const seed = body => {
  const r = parseSeed(body, NOW);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.seed;
};

describe('parseSeed', () => {
  it('takes every field, and an empty body', () => {
    assert.deepEqual(seed({}), {});
    const s = seed(FULL);
    assert.deepEqual(s.coachProfile.preferredDays, [1, 4], 'weekdays sorted');
    assert.equal(s.plan.routines[1].emoji, undefined);
  });

  it('refuses what it does not know, and every malformed field by its own code', () => {
    const code = body => parseSeed(body, NOW).code;
    assert.equal(code(null), 'bad-body');
    assert.equal(code([]), 'bad-body');
    assert.equal(code({ units: 'kg' }), 'bad-field');
    assert.equal(code({ unit: 'st' }), 'bad-unit');
    assert.equal(code({ bodyweight: { date: '2026-02-30', kg: 80 } }), 'bad-date');
    assert.equal(code({ bodyweight: { date: '2026-10-20', kg: 80 } }), 'bad-date', 'after tomorrow');
    assert.equal(code({ bodyweight: { date: TODAY, kg: 8000 } }), 'bad-weight');
    assert.equal(code({ bodyweight: { date: TODAY, kg: '80' } }), 'bad-weight');
    assert.equal(code({ coachProfile: { goal: 'lose' } }), 'bad-coach-profile');
    assert.equal(code({ coachProfile: { daysPerWeek: 0 } }), 'bad-coach-profile', '0 days sends no days at all');
    assert.equal(code({ coachProfile: { preferredDays: [1, 1] } }), 'bad-coach-profile');
    assert.equal(code({ coachProfile: { notes: 'x' } }), 'bad-coach-profile');
    assert.equal(code({ coachProfile: {} }), 'bad-coach-profile');
    assert.equal(code({ checkIn: 'no' }), 'bad-check-in');
  });

  it('holds a plan to the shape of a starter plan', () => {
    const code = plan => parseSeed({ plan }, NOW).code;
    assert.equal(code({ routines: [], schedule: [] }), 'bad-plan');
    assert.equal(code({ routines: Array(8).fill(PLAN.routines[0]), schedule: [] }), 'bad-plan');
    assert.equal(code({ routines: [{ name: '', ex: PLAN.routines[0].ex }], schedule: [] }), 'bad-plan');
    assert.equal(code({ routines: [{ name: 'A', ex: [] }], schedule: [] }), 'bad-plan');
    assert.equal(code({ routines: [{ name: 'A', ex: [{ id: '../x', sets: 3, reps: 8 }] }], schedule: [] }), 'bad-plan');
    assert.equal(code({ routines: [{ name: 'A', ex: [{ id: '0043', sets: 0, reps: 8 }] }], schedule: [] }), 'bad-plan');
    assert.equal(code({ routines: PLAN.routines, schedule: [{ day: 7, routine: 0 }] }), 'bad-plan');
    assert.equal(code({ routines: PLAN.routines, schedule: [{ day: 1, routine: 2 }] }), 'bad-plan');
    assert.equal(code({ routines: PLAN.routines, schedule: [{ day: 1, routine: 0 }, { day: 1, routine: 1 }] }), 'bad-plan');
  });
});

describe('seedState on a new profile', () => {
  it('makes a first document from nothing, every change stamped later than the clock', () => {
    const { next, applied, skipped } = seedState(null, seed(FULL), { now: NOW, newId, newProfile: true });
    assert.deepEqual(applied, ['unit', 'bodyweight', 'coachProfile', 'plan', 'checkIn']);
    assert.deepEqual(skipped, []);
    assert.equal(next.unit, 'lb');
    assert.deepEqual(next.unitSet, { at: NOW, convert: false });
    assert.deepEqual(next.bodyweight, [{ d: TODAY, w: 176.4, t: NOW }], 'in the profile’s unit, to 0.1');
    assert.deepEqual(next.coach.profile, { goal: 'muscle', experience: 'new', daysPerWeek: 2, preferredDays: [1, 4] });
    assert.equal(next.coach.consent, null, 'no consent is given by onboarding');
    const [a, b] = next.routines;
    assert.deepEqual(a.ex, [{ id: '0043', sets: 3, reps: 8, weight: 0 }, { id: '0025', sets: 3, reps: 8, weight: 0 }]);
    assert.equal(a.emoji, 'figureStrength');
    assert.equal(a._ts, NOW);
    assert.deepEqual(next.week, { 1: [a.id], 4: [b.id] });
    assert.equal(next.checkIn, false);
    assert.deepEqual(next.edited, { coach: NOW, 'week.1': NOW, 'week.4': NOW, checkIn: NOW });
    assert.equal(next._ts, NOW);
  });

  it('stamps past anything the profile already holds, so every device takes it as the newest change', () => {
    const cur = { unit: 'kg', _ts: NOW + 5000, edited: { restSec: NOW + 9000 } };
    const { next } = seedState(cur, seed({ checkIn: false }), { now: NOW, newId, newProfile: true });
    assert.equal(next.edited.checkIn, NOW + 9001);
    assert.equal(next.edited.restSec, NOW + 9000, 'other stamps kept');
    assert.ok(next._ts > highestStamp(cur));
  });

  it('changes nothing when it is sent again', () => {
    const first = seedState(null, seed(FULL), { now: NOW, newId, newProfile: true }).next;
    const again = seedState(first, seed(FULL), { now: NOW + 60000, newId, newProfile: true });
    assert.equal(again.next, null);
    assert.deepEqual(again.applied, []);
    assert.deepEqual(again.skipped, [
      { field: 'unit', reason: 'same' },
      { field: 'bodyweight', reason: 'has-entry' },
      { field: 'coachProfile', reason: 'answered' },
      { field: 'plan', reason: 'has-plan' },
      { field: 'checkIn', reason: 'same' }
    ]);
  });

  it('does not write over a choice a device made after the first write', () => {
    const first = seedState(null, seed(FULL), { now: NOW, newId, newProfile: true }).next;
    // The person turns check-in on in Settings; the hub's retry of the same write then arrives.
    const changed = { ...first, checkIn: true, edited: { ...first.edited, checkIn: NOW + 1000 } };
    const retry = seedState(changed, seed(FULL), { now: NOW + 2000, newId, newProfile: true });
    assert.equal(retry.next, null);
    assert.deepEqual(retry.skipped.find(s => s.field === 'checkIn'), { field: 'checkIn', reason: 'chosen' });
  });

  it('reads an absent check-in as on, the way every client does', () => {
    assert.equal(seedState({}, seed({ checkIn: true }), { now: NOW, newProfile: true }).next, null);
    assert.equal(seedState({}, seed({ checkIn: false }), { now: NOW, newProfile: true }).next.checkIn, false);
  });

  it('turns check-in off only for a profile made for this onboarding', () => {
    // An older account that never touched the switch reads it as on, and keeps it on.
    assert.deepEqual(seedState({ unit: 'kg' }, seed({ checkIn: false }), { now: NOW }).skipped, [{ field: 'checkIn', reason: 'existing-profile' }]);
    assert.equal(seedState(null, seed({ checkIn: false }), { now: NOW }).next, null);
    // A new account that already trained is someone's existing profile too.
    const trained = { workouts: [{ id: 'w1', d: TODAY, entries: [] }] };
    assert.deepEqual(seedState(trained, seed({ checkIn: false }), { now: NOW, newProfile: true }).skipped, [{ field: 'checkIn', reason: 'existing-profile' }]);
  });
});

describe('seedState on a profile with data (the owner, a returning user)', () => {
  const owner = () => ({
    unit: 'kg', unitSet: { at: NOW - 1e9, convert: true },
    bodyweight: [{ d: '2026-10-01', w: 82, t: NOW - 1e8 }],
    workouts: [{ id: 'w1', d: '2026-10-01', entries: [] }],
    routines: [{ id: 'mine', name: 'My Push', ex: [{ id: '0025', sets: 5, reps: 5, weight: 100 }] }],
    week: { 2: ['mine'] },
    coach: { consent: { agreedAt: 'x', version: 1 }, profile: { goal: 'strength', experience: 'regular' }, log: [] },
    gymCards: [{ id: 'g1', label: 'Gym', value: '123', fmt: 'qrcode' }],
    _ts: NOW - 1000, _rev: 40
  });

  it('fills in only what is missing, and says why it left the rest', () => {
    const cur = owner();
    const { next, applied, skipped } = seedState(cur, seed(FULL), { now: NOW, newId });
    assert.deepEqual(applied, ['bodyweight']);
    assert.deepEqual(skipped, [
      { field: 'unit', reason: 'chosen' },
      { field: 'coachProfile', reason: 'answered' },
      { field: 'plan', reason: 'has-plan' },
      { field: 'checkIn', reason: 'existing-profile' }
    ]);
    assert.deepEqual(next.routines, cur.routines);
    assert.deepEqual(next.week, cur.week);
    assert.deepEqual(next.coach, cur.coach);
    assert.equal(next.unit, 'kg');
    assert.deepEqual(next.bodyweight.map(e => [e.d, e.w]), [['2026-10-01', 82], [TODAY, 80]]);
    assert.deepEqual(next.workouts, cur.workouts);
  });

  it('never switches the unit of a profile with weights stored, even with no switch on record', () => {
    const cur = { unit: 'kg', workouts: [{ id: 'w1' }] };
    assert.deepEqual(seedState(cur, seed({ unit: 'lb' }), { now: NOW }).skipped, [{ field: 'unit', reason: 'has-data' }]);
    const withLoads = { routines: [{ id: 'r', ex: [{ id: '1', weight: 20 }] }] };
    assert.deepEqual(seedState(withLoads, seed({ unit: 'lb' }), { now: NOW }).skipped, [{ field: 'unit', reason: 'has-data' }]);
  });

  it('keeps a plan of weekdays alone even when no routine is left', () => {
    assert.deepEqual(seedState({ week: { 3: ['gone'] } }, seed({ plan: PLAN }), { now: NOW }).skipped, [{ field: 'plan', reason: 'has-plan' }]);
  });

  it('puts a weigh-in on a day whose earlier one was removed, stamped after the removal', () => {
    const cur = { deleted: { bodyweight: { [TODAY]: NOW + 50 } } };
    const { next } = seedState(cur, seed({ bodyweight: { date: TODAY, kg: 70 } }), { now: NOW });
    assert.ok(next.bodyweight[0].t > NOW + 50);
  });

  it('does not touch the input document', () => {
    const cur = owner();
    const before = JSON.stringify(cur);
    seedState(cur, seed(FULL), { now: NOW, newId });
    assert.equal(JSON.stringify(cur), before);
  });
});

describe('seedView', () => {
  it('says what a profile has answered, and nothing of it beyond that', () => {
    const S = {
      unit: 'lb', bodyweight: [{ d: '2026-10-01', w: 176.4, t: 1 }, { d: '2026-10-10', w: 180, t: 2 }],
      deleted: { bodyweight: { '2026-10-10': 3 } },
      routines: [{ id: 'a', name: 'Secret routine name' }], week: { 1: ['a'], 3: [], 5: 'a' },
      coach: { profile: { goal: 'fatloss', experience: 'weird', daysPerWeek: 4, preferredDays: [1, 9, 3], notes: 'knee' } },
      checkIn: false, gymCards: [{ value: 'card-number' }]
    };
    const v = seedView(S);
    assert.deepEqual(v, {
      unit: 'lb', unitChosen: true, latestWeight: { date: '2026-10-01', kg: 80.01 },
      routines: 1, plannedDays: 2,
      coachProfile: { goal: 'fatloss', experience: null, daysPerWeek: 4, preferredDays: [1, 3] },
      checkIn: false
    });
    const text = JSON.stringify(v);
    for (const secret of ['Secret', 'knee', 'card-number']) assert.ok(!text.includes(secret), secret);
  });

  it('answers for a profile with nothing', () => {
    assert.deepEqual(seedView({}), {
      unit: 'kg', unitChosen: false, latestWeight: null, routines: 0, plannedDays: 0, coachProfile: null, checkIn: true
    });
  });
});
