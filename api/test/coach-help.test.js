import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const dir = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const { coachRoutes } = await import('../coach/routes.js');
const { adapterFor } = await import('../coach/adapters/index.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
cfg.save({ enabled: true, provider: 'fixture', caps: { perProfileDaily: 3, instanceDaily: 0 } });
forcePrivilegeVerdict({ ok: true, dropped: false });

test('app help sends only the question and visible steps once; keeps training and pending proposals intact', async t => {
  const uid = 'private-profile';
  writeState(dir, uid, sampleState());
  const state = jobs.readState(uid);
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const pending = { kind: 'create', id: 'saved-proposal' };
  await fs.mkdir(path.join(dir, 'coach'), { recursive: true });
  await fs.writeFile(path.join(dir, 'coach', uid + '.json'), JSON.stringify({ pending }));
  const entries = [{ title: 'Workout', steps: ['Open Settings', 'Tap Rest timer'] }];
  const body = { question: 'Where is the rest timer?', entries };
  const adapter = adapterFor('fixture');

  const calls = [];
  let reply = '{"index":0}';
  t.mock.method(adapter, 'invoke', async args => { calls.push(args); return { code: 0, text: reply }; });
  const sessions = { id: uid };
  const routes = coachRoutes({
    readSession: req => req.user,
    readBody: async req => req.body,
    json: (res, status, body) => Object.assign(res, { status, body }),
  });
  const request = async (data = body, user = sessions) => {
    const res = {};
    await routes['POST /api/coach/help']({ user, body: data }, res);
    return res;
  };
  assert.equal((await request(body, null)).status, 401);
  writeState(dir, 'no-consent', sampleState({ coach: {} }));
  assert.equal((await request(body, { id: 'no-consent' })).status, 403);
  assert.equal((await request({ ...body, entries: [...entries, ...entries, ...entries, ...entries] })).status, 400);
  assert.equal(calls.length, 0);
  const reply1 = await request({ ...body, profile: 'private', entries: [{ ...entries[0], route: '/private', history: 'secret' }] });
  assert.deepEqual(reply1, { status: 200, body: { index: 0 } });
  assert.deepEqual(JSON.parse(calls[0].prompt.split('\n').at(-1)), body);
  assert.equal(calls[0].web, undefined);
  await assert.rejects(calls[0].fetch('data:text/plain,first').then(() => calls[0].fetch('data:text/plain,again')), /one provider request/);
  for (reply of ['{"index":0,"link":"https://untrusted.example"}', '{"index":9}']) {
    assert.deepEqual(await request(), { status: 200, body: { index: null } });
  }
  assert.equal((await request()).status, 429);
  assert.equal(calls.length, 3);
  assert.equal(jobs.capState(uid).used, 3);
  assert.deepEqual(jobs.readState(uid), state);
  assert.deepEqual(jobs.readUser(uid).pending, pending);
});
