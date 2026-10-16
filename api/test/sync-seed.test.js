/* The onboarding seed (sync-seed.js): what it checks, what it fills in, what it leaves alone, and
   that sending it again changes nothing. The route is in server-sync-onboarding.test.js. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeed, SEED_CAPABILITY, seedState, seedView } from '../sync-seed.js';
import { highestStamp } from '../sync-stamps.js';
import { STARTER_TEMPLATES } from '../starter-plans.js';

// What GET /api/sync/onboarding says the seed takes: both plan fields, and each ready-made plan
// with the weekday counts it runs at.
const CAPABILITY = {
  starter: true,
  coachBuild: true,
  starterTemplates: { 'full-body-2': [1, 2], 'full-body': [3], 'upper-lower': [4], 'upper-lower-ppl': [5], 'ppl-6': [6] }
};

const NOW = Date.UTC(2026, 9, 15, 9);
const TODAY = '2026-10-15';
let n = 0;
const newId = () => `r${++n}`;

// The two-day plan on Monday and Thursday: Full Body A, then B.
const STARTER_2 = { templateId: 'full-body-2', weekdays: [1, 4], equipment: 'gym' };
// A plan of built routines, as hubs sent before the starter choice: no longer taken.
const BUILT_PLAN = {
  routines: [{ name: 'Full Body A', ex: [{ id: '0043', sets: 3, reps: 8 }] }],
  schedule: [{ day: 1, routine: 0 }]
};
const FULL = {
  unit: 'lb',
  bodyweight: { date: TODAY, kg: 80 },
  coachProfile: { goal: 'muscle', experience: 'new', daysPerWeek: 2, preferredDays: [4, 1] },
  starter: STARTER_2,
  checkIn: false
};
// As the route parses it on a server with an AI coach.
const seed = body => {
  const r = parseSeed(body, NOW, { coachAvailable: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.seed;
};

describe('parseSeed', () => {
  it('takes every field, and an empty body', () => {
    assert.deepEqual(seed({}), {});
    const s = seed(FULL);
    assert.deepEqual(s.coachProfile.preferredDays, [1, 4], 'weekdays sorted');
    assert.deepEqual(s.plan.routines.map(r => r.name), ['2-Day Full Body A', '2-Day Full Body B']);
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

  it('takes a plan only as a choice: built routines are an unknown field', () => {
    assert.equal(parseSeed({ plan: BUILT_PLAN }, NOW).code, 'bad-field');
    assert.equal(parseSeed({ starter: STARTER_2, plan: BUILT_PLAN }, NOW).code, 'bad-field');
  });

  it('names the field it refused, so a hub can send the rest without a refused plan', () => {
    const field = (body, opts) => parseSeed(body, NOW, opts).field;
    assert.equal(field(null), null, 'the body as a whole');
    assert.equal(field({ units: 'kg' }), 'units', 'an unknown field by its own name');
    assert.equal(field({ unit: 'st' }), 'unit');
    assert.equal(field({ bodyweight: { date: TODAY, kg: 8000 } }), 'bodyweight');
    assert.equal(field({ coachProfile: {} }), 'coachProfile');
    assert.equal(field({ checkIn: 'no' }), 'checkIn');
    assert.equal(field({ starter: { ...STARTER_2, templateId: 'ppl' } }), 'starter');
    assert.equal(field({ starter: { ...STARTER_2, weekdays: [1, 2, 3] } }), 'starter');
    const build = { consentAt: '2026-10-15T08:30:00.000Z', consentVersion: 'ai-coach-build-v1', equipment: 'gym' };
    assert.equal(field({ coachBuild: build }), 'coachBuild', 'no AI coach here');
    assert.equal(field({ coachBuild: { ...build, consentAt: 'soon' } }, { coachAvailable: true }), 'coachBuild');
    assert.equal(field({ coachBuild: build, starter: STARTER_2 }, { coachAvailable: true }), 'coachBuild');
    // The weigh-in in the same body is not what was refused.
    assert.equal(field({ bodyweight: { date: TODAY, kg: 80 }, coachBuild: build }), 'coachBuild');
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
    assert.deepEqual(a.ex.slice(0, 2), [{ id: '0043', sets: 3, reps: 8, weight: 0 }, { id: '0025', sets: 3, reps: 8, weight: 0 }]);
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
    assert.deepEqual(seedState({ week: { 3: ['gone'] } }, seed({ starter: STARTER_2 }), { now: NOW }).skipped, [{ field: 'plan', reason: 'has-plan' }]);
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
      coachAvailable: false, seed: CAPABILITY, unit: 'lb', unitChosen: true, latestWeight: { date: '2026-10-01', kg: 80.01 },
      routines: 1, plannedDays: 2,
      coachProfile: { goal: 'fatloss', experience: null, daysPerWeek: 4, preferredDays: [1, 3] },
      checkIn: false
    });
    const text = JSON.stringify(v);
    for (const secret of ['Secret', 'knee', 'card-number']) assert.ok(!text.includes(secret), secret);
  });

  it('answers for a profile with nothing', () => {
    assert.deepEqual(seedView({}), {
      coachAvailable: false, seed: CAPABILITY, unit: 'kg', unitChosen: false, latestWeight: null, routines: 0, plannedDays: 0, coachProfile: null, checkIn: true
    });
  });

  it('says what the seed route takes, so a hub sends a plan only to an openGym that takes it', () => {
    assert.deepEqual(seedView({}).seed, SEED_CAPABILITY);
    // Each field it says it takes, parseSeed takes.
    assert.equal(parseSeed({ starter: STARTER_2 }, NOW).ok, SEED_CAPABILITY.starter);
    const build = { consentAt: '2026-10-15T08:30:00.000Z', consentVersion: 'ai-coach-build-v1', equipment: 'gym' };
    assert.equal(parseSeed({ coachBuild: build }, NOW, { coachAvailable: true }).ok, SEED_CAPABILITY.coachBuild);
  });

  it('says each ready-made plan and the weekday counts it runs at, exactly what parseSeed takes', () => {
    const { starterTemplates } = seedView({}).seed;
    assert.deepEqual(Object.keys(starterTemplates).sort(), Object.keys(STARTER_TEMPLATES).sort());
    for (const [templateId, counts] of Object.entries(starterTemplates)) {
      for (let n = 1; n <= 6; n++) {
        const weekdays = [0, 1, 2, 3, 4, 5].slice(0, n);
        const taken = parseSeed({ starter: { templateId, weekdays, equipment: 'gym' } }, NOW).ok;
        assert.equal(taken, counts.includes(n), `${templateId} on ${n} days`);
      }
    }
    // A view handed out is a copy: changing it changes nothing here.
    starterTemplates['full-body'].push(6);
    assert.deepEqual(seedView({}).seed.starterTemplates['full-body'], [3]);
  });

  it('carries the server’s word on the AI coach, true only when it is exactly true', () => {
    assert.equal(seedView({}, { coachAvailable: true }).coachAvailable, true);
    assert.equal(seedView({}, { coachAvailable: 'yes' }).coachAvailable, false);
    assert.equal(seedView({}, {}).coachAvailable, false);
  });
});

describe('a starter choice', () => {
  const STARTER = { templateId: 'upper-lower', weekdays: [6, 0, 2, 4], equipment: 'none' };

  it('is built into the plan the profile gets', () => {
    const s = seed({ starter: STARTER });
    assert.equal(s.starter, undefined, 'past parseSeed it is a plan');
    assert.deepEqual(s.plan.schedule, [{ day: 6, routine: 0 }, { day: 0, routine: 1 }, { day: 2, routine: 2 }, { day: 4, routine: 3 }]);
    const { next, applied } = seedState(null, s, { now: NOW, newId, newProfile: true });
    assert.deepEqual(applied, ['plan']);
    assert.deepEqual(next.routines.map(r => r.name), ['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    assert.deepEqual(Object.keys(next.week).sort(), ['0', '2', '4', '6']);
    assert.ok(next.routines.every(r => r.ex.every(e => e.weight === 0)));
  });

  it('is refused by its own code when it is not a choice the onboarding offers', () => {
    const code = starter => parseSeed({ starter }, NOW).code;
    assert.equal(code(null), 'bad-plan');
    assert.equal(code('full-body'), 'bad-plan');
    assert.equal(code({ ...STARTER, templateId: 'ppl' }), 'bad-plan', 'a catalogue plan the onboarding never offers');
    assert.equal(code({ ...STARTER, templateId: '__proto__' }), 'bad-plan');
    assert.equal(code({ ...STARTER, equipment: 'barbell' }), 'bad-plan');
    assert.equal(code({ ...STARTER, equipment: undefined }), 'bad-plan');
    assert.equal(code({ ...STARTER, weekdays: 'mon' }), 'bad-plan');
    assert.equal(code({ ...STARTER, weekdays: [1, 2, 3] }), 'bad-plan');
    assert.equal(code({ ...STARTER, weekdays: [1, 2, 3, 3] }), 'bad-plan');
    assert.equal(code({ ...STARTER, weekdays: [1, 2, 3, -1] }), 'bad-plan');
    assert.equal(code({ ...STARTER, weekdays: [1, 2, 3, 4.5] }), 'bad-plan');
    assert.equal(code({ ...STARTER, routines: [] }), 'bad-plan');
  });

  it('runs on one weekday for the two-day plan, and on no other count', () => {
    assert.equal(seed({ starter: { templateId: 'full-body-2', weekdays: [3], equipment: 'gym' } }).plan.routines.length, 1);
    assert.equal(parseSeed({ starter: { templateId: 'full-body-2', weekdays: [], equipment: 'gym' } }, NOW).code, 'bad-plan');
    assert.equal(parseSeed({ starter: { templateId: 'full-body-2', weekdays: [1, 2, 3], equipment: 'gym' } }, NOW).code, 'bad-plan');
  });
});

describe('an AI coach build', () => {
  // The hub's clock when it took the consent, and the id of the text the person was shown.
  const AT = '2026-10-15T08:30:00.000Z';
  const BUILD = { consentAt: AT, consentVersion: 'ai-coach-build-v1', equipment: 'gym' };

  it('is recorded as a pending marker in the Coach state, with the consent text’s id and no consent of the Coach’s own given', () => {
    const { next, applied } = seedState(null, seed({ coachProfile: { goal: 'general' }, coachBuild: BUILD }), { now: NOW, newId, newProfile: true });
    assert.deepEqual(applied, ['coachProfile', 'coachBuild']);
    assert.deepEqual(next.coach.build, { status: 'pending', source: 'onboarding', consentAt: AT, consentVersion: 'ai-coach-build-v1', equipment: 'gym', requestedAt: NOW });
    assert.equal(next.coach.consent, null);
    assert.deepEqual(next.coach.profile, { goal: 'general' });
    assert.equal(next.coach.log.length, 0);
    assert.equal(next.routines, undefined);
    assert.equal(next.edited.coach, NOW);
  });

  it('makes the Coach state when the profile has none, and keeps what a profile with some holds', () => {
    const cur = { coach: { consent: { agreedAt: 'x', version: 2 }, profile: null, log: [{ id: 1 }] } };
    const { next } = seedState(cur, seed({ coachBuild: BUILD }), { now: NOW });
    assert.deepEqual(next.coach.consent, { agreedAt: 'x', version: 2 });
    assert.deepEqual(next.coach.log, [{ id: 1 }]);
    assert.equal(next.coach.build.status, 'pending');
  });

  it('is recorded once, and not over a plan', () => {
    const first = seedState(null, seed({ coachBuild: BUILD }), { now: NOW, newProfile: true }).next;
    const again = seedState(first, seed({ coachBuild: { ...BUILD, consentAt: '2026-10-15T08:45:00Z' } }), { now: NOW + 5000 });
    assert.equal(again.next, null);
    assert.deepEqual(again.skipped, [{ field: 'coachBuild', reason: 'requested' }]);
    assert.deepEqual(seedState({ routines: [{ id: 'r', name: 'A', ex: [] }] }, seed({ coachBuild: BUILD }), { now: NOW }).skipped, [{ field: 'coachBuild', reason: 'has-plan' }]);
  });

  it('is refused where this server has no AI coach to run it', () => {
    assert.equal(parseSeed({ coachBuild: BUILD }, NOW).code, 'coach-unavailable');
    assert.equal(parseSeed({ coachBuild: BUILD }, NOW, { coachAvailable: false }).code, 'coach-unavailable');
    assert.equal(parseSeed({ coachBuild: BUILD }, NOW, { coachAvailable: 'yes' }).code, 'coach-unavailable');
    assert.equal(parseSeed({ coachBuild: BUILD }, NOW, { coachAvailable: true }).ok, true);
    // The rest of a seed without one is taken as ever.
    assert.equal(parseSeed({ checkIn: false }, NOW, { coachAvailable: false }).ok, true);
  });

  it('is refused unless it is a UTC timestamp that is not in the future, a consent text id, and nothing else', () => {
    const code = coachBuild => parseSeed({ coachBuild }, NOW, { coachAvailable: true }).code;
    assert.equal(code(null), 'bad-coach-build');
    assert.equal(code({ equipment: 'gym' }), 'bad-coach-build');
    assert.equal(code({ consentAt: AT }), 'bad-coach-build');
    assert.equal(code({ ...BUILD, consentVersion: undefined }), 'bad-coach-build');
    assert.equal(code({ ...BUILD, consentVersion: 'Version 1!' }), 'bad-coach-build');
    assert.equal(code({ ...BUILD, consentVersion: 'v'.repeat(41) }), 'bad-coach-build');
    assert.equal(code({ ...BUILD, consentAt: '2026-10-15' }), 'bad-coach-build');
    assert.equal(code({ ...BUILD, consentAt: '2026-10-15T08:30:00+02:00' }), 'bad-coach-build', 'UTC, as Date.toISOString writes it');
    assert.equal(code({ ...BUILD, consentAt: '2026-13-45T25:61:61Z' }), 'bad-coach-build');
    assert.equal(code({ ...BUILD, consentAt: 1760516000000 }), 'bad-coach-build');
    assert.equal(code({ ...BUILD, consentAt: '2019-12-31T23:59:59Z' }), 'bad-coach-build');
    assert.equal(code({ ...BUILD, consentAt: '2026-10-15T09:11:00Z' }), 'bad-coach-build', 'more than ten minutes ahead');
    assert.equal(code({ ...BUILD, equipment: 'cables' }), 'bad-coach-build');
    assert.equal(code({ ...BUILD, model: 'x' }), 'bad-coach-build');
    assert.equal(parseSeed({ coachBuild: BUILD, starter: { templateId: 'full-body', weekdays: [1, 3, 5], equipment: 'gym' } }, NOW, { coachAvailable: true }).code, 'bad-coach-build', 'a build or a starter, not both');
    assert.equal(code({ ...BUILD, consentAt: '2026-10-15T09:09:00Z' }), undefined, 'a little ahead is the servers’ skew');
  });
});
