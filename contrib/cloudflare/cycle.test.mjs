// node --test contrib/cloudflare/cycle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeCycle, cleanPrefs } from './cycle.js';

const NOW = Date.parse('2026-09-15T09:30:00Z');
function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-'));
  fs.writeFileSync(path.join(dir, 'secret'), 'x'.repeat(40));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'v', name: 'Valeria' }, { id: 'p', name: 'Peter' }, { id: 'f', name: 'Friend' }], subs: [] }));
  const svc = makeCycle({ dataDir: dir, now: () => NOW, ...extra });
  const call = (uid, method, url, body) => svc.handle(new Request('https://x' + url, { method, body: body && JSON.stringify(body) }), uid).then(async r => ({ status: r.status, body: await r.json() }));
  return { dir, svc, call };
}
const flow = async (call, uid, start) => { for (let i = 0; i < 5; i++) await call(uid, 'PUT', '/api/cycle/day', { date: new Date(Date.parse(start) + i * 864e5).toISOString().slice(0, 10), flow: 2 }); };

test('keeps days sealed, validates, and deletes empty days', async () => {
  const { dir, call } = setup();
  assert.equal((await call('v', 'PUT', '/api/cycle/day', { date: 'nope', flow: 1 })).status, 400);
  await call('v', 'PUT', '/api/cycle/day', { date: '2026-09-01', flow: 2, sym: ['tender', 'bogus'], note: 'secret note' });
  const got = (await call('v', 'GET', '/api/cycle')).body;
  assert.deepEqual(got.days['2026-09-01'], { flow: 2, sym: ['tender'], note: 'secret note' });
  const raw = fs.readFileSync(path.join(dir, 'cycle', 'v.json'), 'utf8');
  assert.ok(!raw.includes('secret note') && !raw.includes('tender'));
  await call('v', 'PUT', '/api/cycle/day', { date: '2026-09-01' });
  assert.deepEqual((await call('v', 'GET', '/api/cycle')).body.days, {});
});

test('nobody sees an account unless it picks them, and then only the phase', async () => {
  const { call } = setup();
  await flow(call, 'v', '2026-08-19');   // day 28 of 28: a period starts 09-16 at the earliest
  await call('v', 'PUT', '/api/cycle/day', { date: '2026-09-10', sym: ['cramps'], note: 'private' });
  assert.deepEqual((await call('p', 'GET', '/api/cycle')).body.partners, []);
  await call('v', 'PUT', '/api/cycle/prefs', { share: { p: 'phase', f: 'everything' } });
  const p = (await call('p', 'GET', '/api/cycle')).body.partners;
  assert.equal(p.length, 1);
  assert.deepEqual(Object.keys(p[0]).sort(), ['day', 'level', 'name', 'phase', 'uid']);
  assert.deepEqual((await call('f', 'GET', '/api/cycle')).body.partners, []);   // an unknown level shares nothing
  assert.equal((await call('p', 'GET', '/api/cycle')).body.days['2026-09-10'], undefined);
  await call('v', 'PUT', '/api/cycle/prefs', { share: { p: 'period' } });
  assert.ok((await call('p', 'GET', '/api/cycle')).body.partners[0].next);
  await call('v', 'PUT', '/api/cycle/prefs', { share: {} });
  assert.deepEqual((await call('p', 'GET', '/api/cycle')).body.partners, []);
});

test('delete wipes the account, prefs are cleaned', async () => {
  const { call } = setup();
  await call('v', 'PUT', '/api/cycle/day', { date: '2026-09-01', flow: 1 });
  assert.deepEqual((await call('v', 'DELETE', '/api/cycle')).body, { days: {}, prefs: {} });
  assert.deepEqual((await call('v', 'GET', '/api/cycle')).body.days, {});
  assert.deepEqual(cleanPrefs({ share: { 'a b': 'phase', ok: 'period', x: 'full' }, push: { period: 1 }, tz: 'Mars/Base' }), { share: { ok: 'period' }, push: { period: true } });
});

test('the reminder goes out once, the morning before an expected period', async () => {
  const { dir, svc, call } = setup();
  await flow(call, 'v', '2026-08-19');   // next expected 2026-09-16, "tomorrow" on the 15th
  await call('v', 'PUT', '/api/cycle/prefs', { push: { period: true }, tz: 'UTC' });
  fs.writeFileSync(path.join(dir, 'vapid.json'), JSON.stringify({ publicKey: 'x', privateKey: 'x' }));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [], subs: [{ userId: 'v', endpoint: 'https://push.example/1', keys: { p256dh: 'x', auth: 'x' } }] }));
  const file = path.join(dir, 'cycle', 'v.json'), before = fs.readFileSync(file, 'utf8');
  await svc.tick();
  const after = fs.readFileSync(file, 'utf8');
  assert.notEqual(after, before);              // marked as sent
  await svc.tick();
  assert.equal(fs.readFileSync(file, 'utf8'), after);   // and not again
});
