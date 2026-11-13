/* The calendar feed end to end (integrations/calendar.js, docs/CALENDAR.md), against the real
   server.js in a child: turned on with a session, its address shown again, an iCalendar text of
   the plan (and the workouts when asked), its token good for the feed only, a new address ending
   the old, Turn off and "sign out everywhere" ending it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}:c`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const USERS = [
  { id: 'u_t_1', name: 'One', created: new Date().toISOString() },
  { id: 'u_t_2', name: 'Two', created: new Date().toISOString() }
];
const STATE = uid => ({
  _rev: 3, unit: 'kg', weekStart: 1,
  workouts: [{ id: 'w1', d: '2026-11-01', name: uid, start: 1, end: 2, entries: [] }],
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }] }], week: { 1: ['r1'] },
  bodyweight: [{ d: '2026-11-01', w: 80 }], measurements: [{ d: '2026-11-01', waist: 80 }],
  dayPhotos: { ['a'.repeat(64)]: { d: '2026-11-01', m: { hash: 'a'.repeat(64), mime: 'image/jpeg' } } },
  coach: { chat: [{ role: 'user', text: 'private' }] }, customEx: []
});

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-cal-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  for (const u of USERS) fs.writeFileSync(path.join(dataDir, `state-${u.id}.json`), JSON.stringify(STATE(u.id)));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_UIDS: 'u_t_1', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.call = async (method, p, { headers = {}, body } = {}) => {
    const r = await fetch(h.api + p, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
  h.text = async p => { const r = await fetch(h.api + p); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') }; };
  return h;
}
const page = (uid, sv) => ({ Cookie: `gymsid=${mintSession(uid, sv)}`, 'Sec-Fetch-Site': 'same-origin' });
const bearer = tok => ({ Authorization: 'Bearer ' + tok });


const feedPath = url => new URL(url).pathname;

test('a feed: on with a session, the plan as iCalendar, the address shown again, workouts on request', async t => {
  const h = await startServer(t);
  assert.equal((await h.call('POST', '/api/calendar', { body: {} })).status, 401);
  assert.deepEqual((await h.call('GET', '/api/calendar', { headers: page('u_t_1') })).body, { on: false });
  const on = await h.call('POST', '/api/calendar', { headers: page('u_t_1'), body: { done: false } });
  assert.equal(on.status, 200);
  assert.equal(on.body.on, true);
  assert.match(on.body.url, /^http:\/\/localhost:8080\/api\/calendar\/ogt_[A-Za-z0-9_-]{43}\.ics$/);
  // shown again later, sealed in db.json, never in the clear
  assert.equal((await h.call('GET', '/api/calendar', { headers: page('u_t_1') })).body.url, on.body.url);
  const tok = feedPath(on.body.url).slice('/api/calendar/'.length, -4);
  assert.ok(!fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8').includes(tok.slice(4)));
  const feed = await h.text(feedPath(on.body.url));
  assert.equal(feed.status, 200);
  assert.match(feed.type, /^text\/calendar/);
  assert.match(feed.text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(feed.text, /SUMMARY:Push\r\n/);
  assert.match(feed.text, /DTSTART;VALUE=DATE:\d{8}\r\n/);
  assert.ok(!feed.text.includes('SUMMARY:✓'), 'no finished workouts unless asked');
  // done: the same address, now with the workouts
  const done = await h.call('POST', '/api/calendar', { headers: page('u_t_1'), body: { done: true } });
  assert.equal(done.body.url, on.body.url);
  assert.equal(done.body.done, true);
  // the fixture's workout is from 1970 (start 1): outside the 90 days, so still none
  assert.ok(!(await h.text(feedPath(on.body.url))).text.includes('SUMMARY:✓'));
  // its token takes no other route, and the token routes do not take it
  assert.equal((await h.call('GET', '/api/token/data', { headers: bearer(tok) })).status, 401);
  assert.equal((await h.call('GET', '/api/data', { headers: bearer(tok) })).status, 401);
});

test('a new address ends the old one; Turn off and sign out everywhere end it', async t => {
  const h = await startServer(t);
  const a = await h.call('POST', '/api/calendar', { headers: page('u_t_1'), body: {} });
  const b = await h.call('POST', '/api/calendar', { headers: page('u_t_1'), body: { renew: true } });
  assert.notEqual(a.body.url, b.body.url);
  assert.equal((await h.text(feedPath(a.body.url))).status, 404);
  assert.equal((await h.text(feedPath(b.body.url))).status, 200);
  // another profile's feed is its own
  const other = await h.call('POST', '/api/calendar', { headers: page('u_t_2'), body: {} });
  assert.notEqual(other.body.url, b.body.url);
  // an API token of the profile survives a new calendar address
  const api = await h.call('POST', '/api/tokens', { headers: page('u_t_1'), body: { scopes: { plans: 'view' } } });
  await h.call('POST', '/api/calendar', { headers: page('u_t_1'), body: { renew: true } });
  assert.equal((await h.call('GET', '/api/token/me', { headers: bearer(api.body.token) })).status, 200);
  const cur = (await h.call('GET', '/api/calendar', { headers: page('u_t_1') })).body.url;
  assert.equal((await h.call('POST', '/api/calendar/revoke', { headers: page('u_t_1') })).body.on, false);
  assert.equal((await h.text(feedPath(cur))).status, 404);
  const two = (await h.call('GET', '/api/calendar', { headers: page('u_t_2') })).body.url;
  assert.equal((await h.text(feedPath(two))).status, 200)
  assert.equal((await h.call('POST', '/api/logout/all', { headers: page('u_t_2') })).status, 200);
  assert.equal((await h.text(feedPath(two))).status, 404);
  assert.deepEqual((await h.call('GET', '/api/calendar', { headers: page('u_t_2', 1) })).body, { on: false });
  // a made-up token is a plain 404
  assert.equal((await h.text('/api/calendar/ogt_' + 'A'.repeat(43) + '.ics')).status, 404);
});
