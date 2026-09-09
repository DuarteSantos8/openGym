/* End-to-end through the real queue and a real child process — the only fake is the provider
   itself. Every outcome the user can be shown is reachable here without an AI account, which
   is the whole reason the fixture CLI exists.

   PR 1 stopped at transport and held its answer as `unvalidated`. This PR closes that seam, so
   the assertions below are about what now comes out the other end: a checked bundle, a checked
   change-set, and the two ways a job can fail the validator rather than the parser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const payload = await import('../coach/core/payload.js');
const { CHANGE_TYPES } = await import('../coach/core/validate.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');

cfg.save({ enabled: true, provider: 'fixture' });

/* The privilege drop fails closed on Linux unless the server is root *and* the image has a
   `coach` user — true in the container, false on a CI runner and false on most development
   boxes. Left to the host, every test below that enqueues a job would pass or fail depending
   on where it ran. So the verdict is pinned here, and the one test that cares about the
   refusal pins the opposite verdict for its own duration. */
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

/** Jobs are async by design; the tests wait the way the client does — by polling status. */
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



test('no consent, no job — the gate is on the server, not the screen', () => {
  const uid = 'u-noconsent';
  writeState(DIR, uid, sampleState({ coach: {} }));
  assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'consent');
});

test('one job per profile at a time', async () => {
  const uid = 'u-single';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'review' });
  assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'busy');
  await settle(uid);
});

test('the daily cap is enforced and reported as its own failure', async () => {
  const uid = 'u-cap';
  writeState(DIR, uid, sampleState());
  cfg.save({ caps: { perProfileDaily: 1, instanceDaily: 0 } });
  jobs.enqueue(uid, { kind: 'review' });
  await settle(uid);
  assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'cap');
  assert.equal(jobs.capState(uid).used, 1);
  cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0 } });
});


test('an answer that stays unusable fails cleanly and applies nothing', async () => {
  const uid = 'u-unusable';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'invalid';
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);
  delete process.env.FIXTURE_MODE;
  const last = lastOutcome(uid);
  assert.equal(last.outcome, 'failed');
  assert.equal(last.errorClass, 'unusable');
  assert.equal(s.pending, null, 'nothing partial is ever left behind');
});

test('a provider that crashes is reported, not retried behind the user\'s back', async () => {
  const uid = 'u-crash';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'crash';
  jobs.enqueue(uid, { kind: 'review' });
  await settle(uid);
  delete process.env.FIXTURE_MODE;
  assert.equal(lastOutcome(uid).outcome, 'failed');
  assert.equal(jobs.readUser(uid).history.filter(h => h.outcome === 'failed').length, 1, 'exactly one attempt');
});



test('an expired proposal disappears on read rather than lingering forever', async () => {
  const uid = 'u-expire';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'review' });
  await settle(uid);
  const rec = jobs.readUser(uid);
  rec.pending.expiresAt = Date.now() - 1;
  fs.writeFileSync(`${DIR}/coach/${uid}.json`, JSON.stringify(rec));
  assert.equal(jobs.status(uid).pending, null);
  assert.equal(lastOutcome(uid).outcome, 'expired');
});

test('forgetting a profile leaves no server-side residue', async () => {
  const uid = 'u-forget';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'review' });
  await settle(uid);
  jobs.clearUser(uid);
  const s = jobs.status(uid);
  assert.equal(s.pending, null);
  assert.deepEqual(jobs.readUser(uid).history, []);
});

test('a job interrupted by a restart is reported as failed, not left spinning', () => {
  const uid = 'u-restart';
  fs.mkdirSync(`${DIR}/coach`, { recursive: true });
  fs.writeFileSync(`${DIR}/coach/${uid}.json`, JSON.stringify({
    current: { id: 'j1', kind: 'review', state: 'running', startedAt: Date.now() - 60000 }, history: []
  }));
  jobs.recoverOnBoot();
  assert.equal(jobs.status(uid).job, null);
  assert.equal(lastOutcome(uid).errorClass, 'restart');
});

test('the plan fingerprint moves when the plan does, and only then', () => {
  const plan = payload.canonicalPlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }], week: { 1: 'r1' } });
  const same = payload.canonicalPlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10, weight: 0 }] }], week: { 1: 'r1' } });
  const moved = payload.canonicalPlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 4, reps: 10 }] }], week: { 1: 'r1' } });
  assert.equal(jobs.hashPlan(plan), jobs.hashPlan(same));
  assert.notEqual(jobs.hashPlan(plan), jobs.hashPlan(moved));
});

test('the fingerprint covers every field canonicalPlan reports, including the v1.2.4 three', () => {
  // canonicalPlan learned repsMax, bodyweight and side when the payload did; hashPlan kept
  // hashing the pre-1.2.4 list, so it computed all three and then threw them away. A rep
  // ceiling raised by hand read as "plan untouched" — on exactly the exercises where that
  // ceiling is how progression works.
  const of = ex => payload.canonicalPlan({ routines: [{ id: 'r1', name: 'A', ex: [ex] }], week: { 1: 'r1' } });
  const base = { id: '0001', sets: 3, reps: 10, repsMin: 8, repsMax: 20, bodyweight: true };
  const h = ex => jobs.hashPlan(of(ex));

  assert.equal(h(base), h({ ...base }), 'the same plan hashes the same');
  for (const [field, value] of Object.entries({ repsMax: 25, bodyweight: false, side: true })) {
    assert.notEqual(h(base), h({ ...base, [field]: value }), `${field} must move the fingerprint`);
  }
});


test('a review job produces a checked change-set, and nothing is left unvalidated', async () => {
  const uid = 'u-review';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);

  assert.equal(lastOutcome(uid).outcome, 'ready');
  assert.ok(s.pending, 'a proposal is held for the user');
  assert.equal(s.pending.unvalidated, undefined, 'the PR 1 seam is closed');
  assert.ok(Array.isArray(s.pending.changes) && s.pending.changes.length, 'real changes');
  assert.ok(s.pending.changes.every(c => CHANGE_TYPES.includes(c.type)), 'every change is on the closed list');
  assert.ok(s.pending.changes.every(c => c.why), 'every change cites its evidence');
  assert.equal(s.pending.planHash, jobs.hashPlan(payload.canonicalPlan(jobs.readState(uid))));
});

test('a create job produces a bundle the client can merge unchanged', async () => {
  const uid = 'u-create';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'create' });
  const s = await settle(uid);

  assert.equal(lastOutcome(uid).outcome, 'ready');
  assert.equal(s.pending.unvalidated, undefined);
  assert.equal(s.pending.bundle.opengym_plan, 1);
  assert.ok(s.pending.bundle.routines.length);
  // FR-16, end to end: every id in the bundle resolves against the real catalogue.
  const ids = s.pending.bundle.routines.flatMap(r => r.ex.map(e => e.id));
  assert.ok(ids.length && ids.every(id => payload.libraryHas(id)), 'no invented exercises reach the plan');
  assert.equal(s.pending.iteration, 1);
});

test('a well-formed answer naming an exercise nobody has is refused, twice, and applies nothing', async () => {
  const uid = 'u-ghostex';
  writeState(DIR, uid, sampleState());
  // Not garbage: it parses, and it claims the right contract. Only the validator objects —
  // which is the whole point of the validator being the boundary rather than the parser.
  process.env.FIXTURE_MODE = 'unknown-exercise';
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);
  delete process.env.FIXTURE_MODE;

  assert.equal(lastOutcome(uid).outcome, 'failed');
  assert.equal(lastOutcome(uid).errorClass, 'unusable');
  assert.equal(s.pending, null, 'nothing partial is ever left behind');
});

test('the one repair round rescues an answer the validator rejected', async () => {
  const uid = 'u-repair';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'invalid-then-valid';
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);
  delete process.env.FIXTURE_MODE;

  assert.equal(lastOutcome(uid).outcome, 'ready', 'the second attempt is accepted');
  assert.ok(s.pending.changes.length);
  assert.equal(jobs.readUser(uid).history.filter(h => h.outcome === 'failed').length, 0, 'the user never sees the first attempt');
});

test('"nothing to change" keeps the reason it gave, and proposes nothing', async () => {
  const uid = 'u-nochange';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'nochange';
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);
  delete process.env.FIXTURE_MODE;

  assert.equal(lastOutcome(uid).outcome, 'nochange');
  assert.equal(s.pending, null, 'an empty proposal screen is not an outcome');
  assert.match(lastOutcome(uid).reading, /keep logging/i, 'the reading survives the job that produced it');
});

test('a refine carries the plan it is refining, and counts as the next iteration', async () => {
  const uid = 'u-refine';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'create' });
  const first = await settle(uid);
  assert.equal(first.pending.iteration, 1);
  assert.match(first.pending.bundle.basedOn, /No training history/);

  jobs.enqueue(uid, { kind: 'create', refine: 'More upper body, fewer days.' });
  const second = await settle(uid);
  // `previous` reads pending.bundle. Until the validator landed, pending only ever carried
  // `unvalidated`, so it silently resolved to null on every refine — the model was asked to
  // refine a plan it was never shown.
  assert.match(second.pending.bundle.basedOn, /Refined from the plan/);
  assert.equal(second.pending.iteration, 2);
});

test('the admin test-run completes a round trip without a user to spend', async () => {
  // Every other path here starts from a profile; this one deliberately has none, which is
  // exactly how it came to reference a job that does not exist in its scope. Nothing else in
  // the suite touches the admin card's one button.
  const r = await jobs.testRun();
  assert.equal(r.ok, true, r.error || 'the round trip failed');
  assert.equal(r.version, 'fixture');
});

test('a job is refused outright when the privilege drop cannot be performed', () => {
  const uid = 'u-priv';
  writeState(DIR, uid, sampleState());
  // The refusal is the assertion, so it is pinned rather than hoped for: this used to skip
  // itself on any host where the drop happened to work, which is every host where the control
  // matters least.
  forcePrivilegeVerdict({ ok: false, dropped: false, why: 'no `coach` user exists in this image' });
  try {
    assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'unprivileged');
  } finally {
    forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });
  }
});

test('an HTTPS provider is not refused for lacking a privilege drop, and runs end to end through the queue', async () => {
  // A local server speaking OpenAI's Chat Completions shape, answering a valid "no change"
  // review. This is the whole reason the HTTP adapters exist: no runtime, no child process,
  // nothing to drop privileges on — so the gate that refuses everything on a host without a
  // `coach` user must let this one through, and the job must still run the real pipeline.
  const http = await import('node:http');
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"coach_contract":1,"nochange":true,"reading":"Steady as she goes."}' } }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const uid = 'u-https';
  writeState(DIR, uid, sampleState());
  cfg.save({ enabled: true, provider: 'compatible', providerOptions: { compatible: { baseUrl: base } }, models: { compatible: 'local-model' } });
  forcePrivilegeVerdict({ ok: false, dropped: false, why: 'no `coach` user exists in this image' });
  try {
    jobs.enqueue(uid, { kind: 'review' });
    const s = await settle(uid);
    assert.equal(s.job, null);
    assert.equal(lastOutcome(uid).outcome, 'nochange');
    assert.equal(lastOutcome(uid).reading, 'Steady as she goes.');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, '/v1/chat/completions');
    assert.equal(seen[0].auth, undefined, 'no key configured, so no Authorization header');
    assert.equal(seen[0].body.model, 'local-model');
    assert.ok(seen[0].body.messages[1].content.includes('"coach_contract":1'), 'the payload rode in the user turn');
    assert.ok(seen[0].body.messages[0].content.includes('openGym Coach'), 'the rules rode in the system turn');

    // And the same host refuses a runtime-backed provider, so the gate itself is intact.
    cfg.save({ provider: 'fixture' });
    writeState(DIR, 'u-https-2', sampleState());
    assert.throws(() => jobs.enqueue('u-https-2', { kind: 'review' }), e => e.code === 'unprivileged');
  } finally {
    forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });
    cfg.save({ provider: 'fixture' });
    server.close();
  }
});
