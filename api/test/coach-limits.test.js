/* What bounds the Coach's spend, pinned against the real queue and the fixture provider.
 *
 * Forget keeps today's per-profile count. The instance count is reserved at enqueue and is
 * not read off the capped job log. A scheduled review covers a batch of workouts once, on the
 * workout's own clock rather than the phone's local date, and an answer the model was paid
 * for counts as that review even when it was unusable. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const cadence = await import('../coach/cadence.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');

cfg.save({ enabled: true, provider: 'fixture' });
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

const today = new Date().toISOString().slice(0, 10);
const userFile = uid => `${DIR}/coach/${uid}.json`;

async function settle(uid, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = jobs.status(uid);
    if (!s.job) return s;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('job never finished');
}
const lastOutcome = uid => jobs.readUser(uid).history.at(-1);

/* ---------- the per-profile cap survives forget ---------- */

test('forgetting a profile does not hand it a fresh daily cap', async () => {
  const uid = 'u-forget-cap';
  writeState(DIR, uid, sampleState());
  cfg.save({ caps: { perProfileDaily: 1, instanceDaily: 0 } });
  try {
    jobs.enqueue(uid, { kind: 'review' });
    await settle(uid);
    assert.equal(jobs.capState(uid).used, 1);

    jobs.clearUser(uid);
    const s = jobs.status(uid);
    assert.equal(s.pending, null, 'the proposal is gone');
    assert.deepEqual(jobs.readUser(uid).history, [], 'the history is gone');
    assert.equal(s.cap.used, 1, 'the day\'s count is a spending record, not the profile\'s data');
    assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'cap');
  } finally {
    cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0 } });
  }
});

test('with nothing spent today, forget leaves no file at all', () => {
  const uid = 'u-forget-empty';
  jobs.setShare(uid, true);
  assert.ok(fs.existsSync(userFile(uid)));
  jobs.clearUser(uid);
  assert.equal(fs.existsSync(userFile(uid)), false);

  // Yesterday's count is already worth nothing to the cap, so it does not keep the file either.
  fs.writeFileSync(userFile(uid), JSON.stringify({ daily: { date: '2000-01-01', count: 5 }, history: [] }));
  jobs.clearUser(uid);
  assert.equal(fs.existsSync(userFile(uid)), false);
});

/* ---------- the instance cap ---------- */

test('the instance cap is reserved at enqueue, so a job still running already counts', async () => {
  cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 1 }, daily: null, log: [] });
  try {
    writeState(DIR, 'u-inst-1', sampleState());
    writeState(DIR, 'u-inst-2', sampleState());
    jobs.enqueue('u-inst-1', { kind: 'review' });
    assert.ok(jobs.status('u-inst-1').job, 'the first job is on its way');
    assert.throws(() => jobs.enqueue('u-inst-2', { kind: 'review' }), e => e.code === 'cap',
      'the second profile is refused before the first job has finished');
    await settle('u-inst-1');
    assert.equal(lastOutcome('u-inst-1').outcome, 'ready');
    assert.deepEqual(cfg.load().daily, { date: today, count: 1 });
  } finally {
    cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0 } });
  }
});

test('the instance count is not bounded by the length of the job log', () => {
  const uid = 'u-inst-150';
  writeState(DIR, uid, sampleState());
  cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 150 }, daily: { date: today, count: 150 }, log: [] });
  try {
    assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'cap',
      'a hundred and fifty jobs today trip a cap of a hundred and fifty, empty log or not');
    // Yesterday's count is nobody's business today.
    cfg.save({ daily: { date: '2000-01-01', count: 150 } });
    assert.doesNotThrow(() => jobs.enqueue(uid, { kind: 'review' }));
    assert.deepEqual(cfg.load().daily, { date: today, count: 1 });
  } finally {
    cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0 } });
  }
  return settle(uid);
});

/* ---------- scheduled reviews ---------- */

/** startCadence arms a setInterval; take the callback so the tests can tick it by hand. */
function captureTick(deps) {
  const real = globalThis.setInterval;
  let fn = null;
  globalThis.setInterval = f => { fn = f; return { unref() {} }; };
  try { cadence.startCadence(deps); } finally { globalThis.setInterval = real; }
  return fn;
}
// `end` lands a second past now, so the workout is after any review that has just finished.
const newWorkout = id => ({ ...sampleState().workouts[0], id, d: today, start: Date.now() - 60000, end: Date.now() + 1000 });

test('a scheduled review reads a batch of workouts once, not once per tick', async () => {
  const uid = 'u-cadence';
  const S = sampleState({ coach: { ...sampleState().coach, cadence: { everyWorkouts: 1 } } });
  writeState(DIR, uid, S);
  const tick = captureTick({ users: () => [{ id: uid }], userNow: () => ({ date: today, hhmm: '18:00', weekday: 4 }) });
  process.env.FIXTURE_MODE = 'nochange';
  try {
    tick();
    assert.ok(jobs.status(uid).job, 'the first tick queues a review');
    tick();
    await settle(uid);
    assert.equal(lastOutcome(uid).outcome, 'nochange');
    assert.equal(lastOutcome(uid).trigger, 'scheduled');

    // The phone never opened, so lastReview in the synced state is still unset — and the same
    // workout must not be reviewed again on every tick until the daily cap is gone.
    tick(); tick(); tick();
    assert.equal(jobs.status(uid).job, null);
    assert.equal(jobs.readUser(uid).history.length, 1);
    assert.equal(jobs.capState(uid).used, 1);

    // A new workout is new news.
    S.workouts.push(newWorkout('w2'));
    writeState(DIR, uid, S);
    tick();
    assert.ok(jobs.status(uid).job, 'a fresh workout is due');
    await settle(uid);
    assert.equal(jobs.readUser(uid).history.length, 2);
  } finally {
    delete process.env.FIXTURE_MODE;
  }
});

test('a workout the phone dated tomorrow is not re-read once the review has covered it', async () => {
  const uid = 'u-cadence-tz';
  // The phone stamps `d` in its own timezone: a morning session in Tokyo already carries
  // tomorrow's date by the server's UTC clock. Its `end` is on the clock the review is timed on.
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const S = sampleState({ coach: { ...sampleState().coach, cadence: { everyWorkouts: 1 } } });
  S.workouts.push({ ...newWorkout('w-ahead'), d: tomorrow, start: Date.now() - 45 * 60000, end: Date.now() - 60000 });
  writeState(DIR, uid, S);
  const tick = captureTick({ users: () => [{ id: uid }], userNow: () => ({ date: today, hhmm: '18:00', weekday: 4 }) });
  process.env.FIXTURE_MODE = 'nochange';
  try {
    tick();
    await settle(uid);
    assert.equal(lastOutcome(uid).outcome, 'nochange');
    tick();
    assert.equal(jobs.status(uid).job, null, 'the review already read that workout, whatever date the phone gave it');
    assert.equal(jobs.readUser(uid).history.length, 1);
  } finally {
    delete process.env.FIXTURE_MODE;
  }
});

test('an answer the model was paid for counts as the review, even when it was unusable', async () => {
  const uid = 'u-cadence-unusable';
  const S = sampleState({ coach: { ...sampleState().coach, cadence: { everyWorkouts: 1 } } });
  writeState(DIR, uid, S);
  const tick = captureTick({ users: () => [{ id: uid }], userNow: () => ({ date: today, hhmm: '18:00', weekday: 4 }) });
  process.env.FIXTURE_MODE = 'invalid';
  try {
    tick();
    await settle(uid);
    assert.equal(lastOutcome(uid).outcome, 'failed');
    assert.equal(lastOutcome(uid).errorClass, 'unusable');
    tick();
    assert.equal(jobs.status(uid).job, null, 'the model read those workouts; sending them again pays twice for the same data');
    assert.equal(jobs.capState(uid).used, 1);

    // A call that never reached the model read nothing, so the same workouts are asked about again.
    process.env.FIXTURE_MODE = 'crash';
    S.workouts.push(newWorkout('w2'));
    writeState(DIR, uid, S);
    tick();
    await settle(uid);
    assert.equal(lastOutcome(uid).errorClass, 'provider');
    tick();
    assert.ok(jobs.status(uid).job, 'a provider that fell over is retried on the next tick');
    await settle(uid);
  } finally {
    delete process.env.FIXTURE_MODE;
  }
});

test('a proposal nobody has answered is not replaced by the next scheduled review', async () => {
  const uid = 'u-cadence-pending';
  const S = sampleState({ coach: { ...sampleState().coach, cadence: { everyWorkouts: 1 } } });
  writeState(DIR, uid, S);
  const tick = captureTick({ users: () => [{ id: uid }], userNow: () => ({ date: today, hhmm: '18:00', weekday: 4 }) });

  tick();
  const first = await settle(uid);
  assert.equal(lastOutcome(uid).outcome, 'ready');
  assert.ok(first.pending, 'a proposal is waiting');

  S.workouts.push(newWorkout('w2'));
  writeState(DIR, uid, S);
  tick();
  assert.equal(jobs.status(uid).job, null, 'not while the proposal is unread');
  assert.equal(jobs.status(uid).pending.id, first.pending.id, 'the unread proposal is still the same one');

  // Once it is answered, the workout logged since is due.
  jobs.resolvePending(uid, { dismissed: true });
  tick();
  assert.ok(jobs.status(uid).job, 'the workout since the last review is due');
  await settle(uid);
  assert.equal(jobs.readUser(uid).history.filter(h => h.outcome === 'ready').length, 2);
});
