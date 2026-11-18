/* A RENPHO sync against what can happen while it runs or before it starts
   (api/providers/renpho/service.js): the profile disconnects or connects another account
   meanwhile, the file of kept readings cannot be read, a second account's weigh-in falls on a day
   the account's own readings already have; and the client's windows of a friend's values meeting
   at a day (client.js trend). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenphoService } from '../providers/renpho/service.js';
import { createRenphoClient, encrypt } from '../providers/renpho/client.js';

const T0 = Date.parse('2026-10-20T12:00:00Z');
const row = (id, ts, weight) => ({ id, bUserId: '1', timeStamp: ts, localCreatedAt: new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' '), weightUnit: 1, weight });

// A RENPHO stand-in whose readings answer when `release()` is called, so a test can act meanwhile.
function slowClient(rows) {
  let release;
  const gate = new Promise(r => { release = r; });
  return {
    release: () => release(),
    client: {
      login: async () => ({ token: 't', userId: '1', weightUnit: 1 }),
      tables: async () => [{ tableName: 'm', count: rows.length, userIds: ['1'] }],
      readings: async () => { await gate; return { rows, complete: true }; },
      friends: async () => [],
      trend: async () => [],
    },
  };
}

function service(client, { readRaw = () => null } = {}) {
  const writes = [], removed = [];
  const svc = createRenphoService({
    seal: x => x, unseal: x => x, save() {}, readRaw, writeRaw: (uid, obj) => writes.push([uid, obj]),
    removeRaw: uid => removed.push(uid), client, now: () => T0, log() {},
  });
  return { svc, writes, removed };
}
const connected = (extra = {}) => ({ creds: { email: 'a@example.com', password: 'p' }, session: { token: 't', userId: '1' }, mode: 'account', devId: 'D', zone: 'UTC', ...extra });

test('disconnected while the sync runs: nothing is written, and the readings stay gone', async () => {
  const slow = slowClient([row('101', T0 / 1000 - 3600, 80)]);
  const { svc, writes, removed } = service(slow.client);
  const user = { id: 'u', renpho: connected() };
  const p = svc.sync(user);
  svc.disconnect(user);
  slow.release();
  assert.deepEqual(await p, { stale: true });
  assert.deepEqual(writes, []);
  assert.deepEqual(removed, ['u']);
  assert.equal(user.renpho, undefined);
});

test('connected again while an older sync runs: the older one writes nothing, the new one syncs after it', async () => {
  const slow = slowClient([row('101', T0 / 1000 - 3600, 80)]);
  const { svc, writes } = service(slow.client);
  const user = { id: 'u', renpho: connected() };
  const first = svc.sync(user);
  user.renpho = connected({ email: 'b@example.com' });   // what connect() does: a new object
  const second = svc.sync(user);
  assert.notEqual(second, first);
  slow.release();
  assert.deepEqual(await first, { stale: true });
  const res = await second;
  assert.equal(res.measurements, 1);
  assert.equal(writes.length, 1, 'only the current connection wrote');
  assert.equal(user.renpho.lastResult.added, 1);
  assert.equal(user.renpho.error, null);
});

test('a kept file that cannot be read stops the sync instead of being written over', async () => {
  const slow = slowClient([row('101', T0 / 1000 - 3600, 80)]);
  slow.release();
  const { svc, writes } = service(slow.client, { readRaw: () => { throw new SyntaxError('Unexpected end of JSON input'); } });
  const user = { id: 'u', renpho: connected() };
  await assert.rejects(svc.sync(user));
  assert.deepEqual(writes, []);
  assert.ok(user.renpho.error, 'the failure is kept on the row, as any other');
  // and Body measurements shows nothing rather than failing
  assert.deepEqual(svc.summary(user), { items: [], t: null });
});

test('a second account: a day the own readings have is skipped up to their latest, a later weigh-in comes in', async () => {
  const own = row('101', Date.parse('2026-10-19T08:00:00Z') / 1000, 80);
  const store = { provider: 'renpho', measurements: { 101: { provider: 'renpho', external_id: '101', external_timestamp: own.timeStamp * 1000, raw_provider_data: own } } };
  const at = iso => Date.parse(iso) / 1000;
  const points = {
    weight: [{ day: '2026-10-19', ts: at('2026-10-19T20:00:00Z'), value: 79.5 }, { day: '2026-10-18', ts: at('2026-10-18T07:00:00Z'), value: 81 }],
  };
  const client = {
    login: async () => ({ token: 't', userId: '9', weightUnit: 1 }),
    trend: async (dev, s, fid, param) => points[param] || [],
  };
  const { svc, writes } = service(client, { readRaw: () => JSON.parse(JSON.stringify(store)) });
  const user = { id: 'u', renpho: connected({ mode: 'friend', friend: { id: '1' }, lastSync: null }) };
  const res = await svc.sync(user);
  assert.equal(res.measurements, 2, 'the evening weigh-in of the 19th and the 18th');
  const kept = Object.keys(writes[0][1].measurements).sort();
  assert.deepEqual(kept, ['101', 'day:1:2026-10-18', 'day:1:2026-10-19']);

  // the friend's value of the 19th from before the own reading is the same weigh-in: skipped
  points.weight[0].ts = at('2026-10-19T07:00:00Z');
  writes.length = 0;
  const again = await svc.sync({ id: 'u', renpho: connected({ mode: 'friend', friend: { id: '1' }, lastSync: null }) });
  assert.equal(again.measurements, 1);
});

test('a friend\'s windows meeting at a day: one point a day, its latest, whatever page it came on', async () => {
  const pages = [
    [{ groupDay: '2026-10-20', timeStamp: 2000, value: 80 }, { groupDay: '2026-10-19', timeStamp: 1500, value: 81 }],
    // the next window ends just before 1500, and has an earlier point of the 19th
    [{ groupDay: '2026-10-19', timeStamp: 1400, value: 82 }, { groupDay: '2026-10-18', timeStamp: 1000, value: 83 }],
  ];
  let call = 0;
  const fetchFn = async () => new Response(JSON.stringify({ code: 101, msg: 'success', data: encrypt(JSON.stringify({ list: pages[call++] || [] })) }), { status: 200 });
  const client = createRenphoClient({ fetchFn, baseUrl: 'http://renpho.test', now: () => 3000 * 1000 });
  const pts = await client.trend({ devId: 'D', zone: 'UTC' }, { token: 't', userId: '9' }, '1', 'weight');
  const byDay = Object.fromEntries(pts.map(p => [p.day, p.value]));
  assert.deepEqual(byDay, { '2026-10-20': 80, '2026-10-19': 81, '2026-10-18': 83 });
  assert.equal(pts.length, 3);
});
