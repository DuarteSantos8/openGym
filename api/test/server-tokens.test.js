/* Scoped tokens end to end (tokens.js, docs/API_TOKENS.md), against the real server.js in a child:
   made and revoked with a session, shown once, reaching only /api/token/*, reading and writing
   only their scopes, over the exact revision, never another profile, and ending with revoke,
   "sign out everywhere", a disabled account and the account's delete. */
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-tokens-'));
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
  return h;
}
const page = (uid, sv) => ({ Cookie: `gymsid=${mintSession(uid, sv)}`, 'Sec-Fetch-Site': 'same-origin' });
const bearer = tok => ({ Authorization: 'Bearer ' + tok });

test('made with a session, shown once, listed without the secret, refused without one', async t => {
  const h = await startServer(t);
  assert.equal((await h.call('POST', '/api/tokens', { body: { scopes: { workouts: 'view' } } })).status, 401);
  assert.equal((await h.call('POST', '/api/tokens', { headers: { ...page('u_t_1'), 'Sec-Fetch-Site': 'cross-site' }, body: { scopes: { workouts: 'view' } } })).status, 403, 'another site cannot mint one');
  assert.equal((await h.call('POST', '/api/tokens', { headers: page('u_t_1'), body: { scopes: {} } })).body.code, 'nothing-granted');
  const made = await h.call('POST', '/api/tokens', { headers: page('u_t_1'), body: { name: 'Claude', scopes: { workouts: 'view', plans: 'apply' }, days: 30 } });
  assert.equal(made.status, 200);
  assert.match(made.body.token, /^ogt_/);
  const list = await h.call('GET', '/api/tokens', { headers: page('u_t_1') });
  assert.equal(list.body.tokens.length, 1);
  assert.equal(list.body.tokens[0].name, 'Claude');
  assert.ok(!JSON.stringify(list.body).includes(made.body.token.slice(4)), 'the list never carries the token');
  const db = fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8');
  assert.ok(!db.includes(made.body.token.slice(4)), 'db.json holds only its hash');
  assert.equal((await h.call('GET', '/api/tokens', { headers: page('u_t_2') })).body.tokens.length, 0, "another profile's list is its own");
  // A token cannot make or list tokens: those are session routes.
  assert.equal((await h.call('GET', '/api/tokens', { headers: bearer(made.body.token) })).status, 401);
  assert.equal((await h.call('POST', '/api/tokens', { headers: bearer(made.body.token), body: { scopes: { workouts: 'apply' } } })).status, 401);
  // The activity log says so, never with the token.
  assert.match(fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8'), /auth\.token\.create/);
  assert.ok(!fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8').includes(made.body.token.slice(4)));
  // And the sharing log of the profile.
  const share = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'share', 'u_t_1.json'), 'utf8'));
  assert.equal(share.log.at(-1).ev, 'token.create');
  assert.equal(share.log.at(-1).peer.name, 'Claude');
});

test('a token is no session: every other route refuses it', async t => {
  const h = await startServer(t);
  const { body: { token } } = await h.call('POST', '/api/tokens', { headers: page('u_t_1'), body: { scopes: { workouts: 'apply', plans: 'apply', bodyweight: 'apply', measurements: 'apply', notes: 'view' } } });
  for (const [m, p, body] of [['GET', '/api/me'], ['GET', '/api/data'], ['GET', '/api/data/rev'], ['PUT', '/api/data', { state: { unit: 'lb' } }],
    ['GET', '/api/admin/users'], ['POST', '/api/logout/all'], ['POST', '/api/pair/create'], ['GET', '/api/account/passkeys'],
    ['POST', '/api/watch/pair'], ['GET', '/api/sharing'], ['POST', '/api/account/delete', { name: 'One' }]]) {
    const r = await h.call(m, p, { headers: bearer(token), body });
    assert.ok([401, 404].includes(r.status), `${m} ${p} answered ${r.status}`);
  }
  const S = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'state-u_t_1.json'), 'utf8'));
  assert.equal(S.unit, 'kg', 'nothing was written');
});

test('reads only its categories, writes only its keys, over the exact revision, on its own profile', async t => {
  const h = await startServer(t);
  const mk = async (uid, scopes) => (await h.call('POST', '/api/tokens', { headers: page(uid), body: { scopes } })).body.token;
  const ro = await mk('u_t_1', { workouts: 'view' });
  const plans = await mk('u_t_1', { plans: 'apply', workouts: 'view' });
  const other = await mk('u_t_2', { workouts: 'apply' });

  const me = await h.call('GET', '/api/token/me', { headers: bearer(plans) });
  assert.equal(me.body.user.id, 'u_t_1');
  assert.deepEqual(me.body.token.scopes, { workouts: 'view', plans: 'apply', bodyweight: 'off', measurements: 'off', notes: 'off' });

  const r = await h.call('GET', '/api/token/data', { headers: bearer(ro) });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 3);
  assert.ok(r.body.state.workouts && r.body.state.unit);
  for (const k of ['routines', 'bodyweight', 'measurements', 'dayPhotos', 'coach']) assert.equal(k in r.body.state, false, k);
  assert.equal(r.body.state.workouts[0].name, 'u_t_1');
  // A uid anywhere in the request changes nothing: the token names the profile.
  const sneaky = await h.call('GET', '/api/token/data?uid=u_t_2', { headers: { ...bearer(ro), Cookie: `gymsid=${mintSession('u_t_2')}` } });
  assert.equal(sneaky.body.state.workouts[0].name, 'u_t_1');
  assert.equal((await h.call('GET', '/api/token/data', { headers: bearer(other) })).body.state.workouts[0].name, 'u_t_2');
  assert.equal((await h.call('GET', '/api/token/data/rev', { headers: bearer(ro) })).body.rev, 3);

  // A read-only token writes nothing.
  const w0 = await h.call('PUT', '/api/token/data', { headers: bearer(ro), body: { state: { workouts: [] }, baseRev: 3 } });
  assert.equal(w0.status, 403);
  assert.equal(w0.body.code, 'scope');
  // No blind writes.
  assert.equal((await h.call('PUT', '/api/token/data', { headers: bearer(plans), body: { state: { routines: [] } } })).body.code, 'base-rev');
  // A key outside the scope, changed: refused, nothing saved.
  const p0 = await h.call('GET', '/api/token/data', { headers: bearer(plans) });
  const sent = { ...p0.body.state, routines: [...p0.body.state.routines, { id: 'r2', name: 'Pull', ex: [] }], week: { 1: ['r1'], 3: ['r2'] } };
  const bad = await h.call('PUT', '/api/token/data', { headers: bearer(plans), body: { state: { ...sent, workouts: [] }, baseRev: p0.body.rev } });
  assert.equal(bad.status, 403);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'state-u_t_1.json'), 'utf8'))._rev, 3);
  // The same without it: saved, the rest of the profile untouched.
  const ok = await h.call('PUT', '/api/token/data', { headers: bearer(plans), body: { state: sent, baseRev: p0.body.rev, baseWid: p0.body.wid } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.rev, 4);
  const S = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'state-u_t_1.json'), 'utf8'));
  assert.deepEqual(S.routines.map(x => x.id), ['r1', 'r2']);
  assert.deepEqual(S.week[3], ['r2']);
  assert.equal(S.coach.chat[0].text, 'private');
  assert.ok(S.dayPhotos['a'.repeat(64)]);
  assert.equal(S.bodyweight.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'state-u_t_2.json'), 'utf8')).routines.length, 1, 'the other profile is untouched');
  // An old revision: 409 with the current scoped document, nothing written.
  const stale = await h.call('PUT', '/api/token/data', { headers: bearer(plans), body: { state: { ...sent, routines: [] }, baseRev: 3 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.rev, 4);
  assert.equal('coach' in stale.body.state, false);
  // The sharing log shows the write and the look.
  const log = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'share', 'u_t_1.json'), 'utf8')).log;
  assert.ok(log.some(e => e.ev === 'token.write' && e.cat === 'plans'));
  assert.ok(log.some(e => e.ev === 'access' && e.actor.kind === 'token' && e.cat === 'workouts'));
});

test('revoke, sign out everywhere, a disabled and a deleted account all end a token', async t => {
  const h = await startServer(t);
  const mk = async uid => (await h.call('POST', '/api/tokens', { headers: page(uid), body: { scopes: { workouts: 'view' } } })).body;
  const a = await mk('u_t_1');
  const b = await mk('u_t_1');
  const ok = tok => h.call('GET', '/api/token/me', { headers: bearer(tok) }).then(r => r.status);
  assert.equal(await ok(a.token), 200);
  // Revoke one: it stops at once; the other keeps working. Another profile cannot revoke it.
  assert.equal((await h.call('POST', '/api/tokens/revoke', { headers: page('u_t_2'), body: { id: b.id } })).body.revoked, 0);
  assert.equal((await h.call('POST', '/api/tokens/revoke', { headers: page('u_t_1'), body: { id: a.id } })).body.revoked, 1);
  const refused = await h.call('GET', '/api/token/me', { headers: bearer(a.token) });
  assert.equal(refused.status, 401);
  assert.match(refused.headers.get('www-authenticate'), /invalid_token/);
  assert.equal(await ok(b.token), 200);
  // Sign out everywhere ends the rest.
  assert.equal((await h.call('POST', '/api/logout/all', { headers: page('u_t_1') })).status, 200);
  assert.equal(await ok(b.token), 401);
  assert.equal((await h.call('GET', '/api/tokens', { headers: page('u_t_1', 1) })).body.tokens.length, 0);
  // Disabled by an admin: refused; enabled again: back.
  const c = await mk('u_t_2');
  assert.equal(await ok(c.token), 200);
  assert.equal((await h.call('POST', '/api/admin/user/disable', { headers: page('u_t_1', 1), body: { id: 'u_t_2', disabled: true } })).status, 200);
  assert.equal(await ok(c.token), 401);
  assert.equal((await h.call('POST', '/api/admin/user/disable', { headers: page('u_t_1', 1), body: { id: 'u_t_2', disabled: false } })).status, 200);
  assert.equal(await ok(c.token), 200);
  // Deleted: gone with the account.
  assert.equal((await h.call('POST', '/api/admin/user/delete', { headers: page('u_t_1', 1), body: { id: 'u_t_2' } })).status, 200);
  assert.equal(await ok(c.token), 401);
  assert.ok(!fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8').includes('u_t_2"'), 'no token row of the deleted account is left');
});

test('rate limited per token, and API_TOKENS=off takes the routes away', async t => {
  const h = await startServer(t, { TOKEN_READS_PER_MIN: '3', TOKEN_WRITES_PER_HOUR: '1' });
  const { body: { token } } = await h.call('POST', '/api/tokens', { headers: page('u_t_1'), body: { scopes: { bodyweight: 'apply' } } });
  for (let i = 0; i < 3; i++) assert.equal((await h.call('GET', '/api/token/data/rev', { headers: bearer(token) })).status, 200);
  const r = await h.call('GET', '/api/token/data', { headers: bearer(token) });
  assert.equal(r.status, 429);
  assert.ok(+r.headers.get('retry-after') > 0);
  // Writes have their own budget (a fresh token: every request spends the minute's too).
  const { body: { token: wtok } } = await h.call('POST', '/api/tokens', { headers: page('u_t_1'), body: { scopes: { bodyweight: 'apply' } } });
  const S = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'state-u_t_1.json'), 'utf8'));
  const w = n => h.call('PUT', '/api/token/data', { headers: bearer(wtok), body: { state: { bodyweight: [...S.bodyweight, { d: '2026-11-0' + n, w: 79 }] }, baseRev: S._rev + (n - 2) } });
  assert.equal((await w(2)).status, 200);
  assert.equal((await w(3)).status, 429);

  const off = await startServer(t, { API_TOKENS: 'off' });
  assert.equal((await off.call('GET', '/api/tokens', { headers: page('u_t_1') })).status, 404);
  assert.equal((await off.call('GET', '/api/token/me', { headers: bearer(token) })).status, 404);
  const cfg = await off.call('GET', '/api/config', { headers: page('u_t_1') });
  assert.equal(cfg.body.api_tokens, undefined);
  assert.equal((await h.call('GET', '/api/config', { headers: page('u_t_1') })).body.api_tokens, true);
  assert.equal((await h.call('GET', '/api/config')).body.api_tokens, undefined, 'not for a stranger');
});
