/* Planner tokens (PLANNER_TOKENS, `<token>=<uid>` comma-separated): machine bearers that each act
   as their OWN mapped user on exactly GET and PUT /api/data. End to end against the real server.js
   in spawned children, plus spawnSync checks that a bad configuration refuses to boot. No network
   beyond 127.0.0.1, throwaway data dirs throughout.

   The isolation tests are the point of the file: one server, several people, and a token that
   could read or write someone else's profile is the failure this must never ship. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = crypto.randomBytes(32).toString('hex');    // 64 hex characters, the documented shape
const TOKEN2 = crypto.randomBytes(32).toString('hex');   // the second user's planner
const WRONG = crypto.randomBytes(32).toString('hex');
const SECRET = crypto.randomBytes(32).toString('hex');   // pre-seeded so tests can mint sessions

// Same construction as server.js makeSession(): payload `uid:exp:sv`, HMAC-SHA256 over SECRET.
function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const bearer = tok => ({ headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
const readAudit = dir => { try { return fs.readFileSync(path.join(dir, 'audit.log'), 'utf8'); } catch { return ''; } };
const lines = (dir, ev) => readAudit(dir).split('\n').filter(l => l.includes(ev));

const USERS = [
  { id: 'u_test_1', name: 'First User', created: new Date().toISOString() },
  { id: 'u_test_2', name: 'Second User', created: new Date().toISOString() },
  { id: 'u_dis', name: 'Disabled', created: new Date().toISOString(), disabled: true }
];

// Boots server.js on a free port over a throwaway data dir seeded with USERS, the session secret
// and a state file per enabled user (u_test_1 at _ts 111, u_test_2 at _ts 555: distinct, so a
// mix-up between the two shows as a wrong number, not an empty read).
async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-planner-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dataDir, 'state-u_test_1.json'), JSON.stringify({ _ts: 111, routines: [], week: {}, workouts: [] }));
  fs.writeFileSync(path.join(dataDir, 'state-u_test_2.json'), JSON.stringify({ _ts: 555, routines: [], week: {}, workouts: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir,
      ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_UIDS: 'u_test_1',
      PLANNER_TOKENS: '', ...env
    }
  });
  const h = { api: '', dataDir, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  return h;
}

const stateOnDisk = (h, uid) => JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${uid}.json`), 'utf8'));
const tsOf = async (h, tok) => {
  const r = await fetch(`${h.api}/api/data`, bearer(tok));
  assert.equal(r.status, 200);
  return (await r.json()).state._ts;
};
const putState = (h, tok, ts) => fetch(`${h.api}/api/data`, {
  method: 'PUT', ...bearer(tok),
  body: JSON.stringify({ state: { _ts: ts, routines: [], week: {}, workouts: [] } })
});

// A boot that is expected to refuse. server.js listens forever when healthy, so these run under
// spawnSync with a timeout: a configuration that stopped refusing comes back status null, not 1.
const run = env => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-planner-boot-'));
  try {
    return spawnSync(process.execPath, ['server.js'], {
      cwd: API, timeout: 15000,
      env: { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN: 'http://localhost:8080', PLANNER_TOKENS: '', ...env }
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('a planner token reads and writes /api/data as its user, and nothing else', async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1` });
  assert.match(h.log, /planner tokens: on, uids=u_test_1 routes=GET,PUT \/api\/data/);

  assert.equal((await fetch(`${h.api}/api/data`)).status, 401);
  assert.equal((await fetch(`${h.api}/api/data`, bearer(WRONG))).status, 401);

  const r = await fetch(`${h.api}/api/data`, bearer(TOKEN));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).state._ts, 111);

  // a write lands on the mapped user's file, with the same answer and the same clean-up as any PUT
  const put = await fetch(`${h.api}/api/data`, {
    method: 'PUT', ...bearer(TOKEN),
    body: JSON.stringify({ state: { _ts: 222, routines: [], week: {}, workouts: [], active: { id: 'x' } } })
  });
  assert.equal(put.status, 200);
  const answer = await put.json();
  assert.deepEqual(answer, { ok: true, ts: 222, rev: 1, wid: answer.wid });
  const onDisk = stateOnDisk(h, 'u_test_1');
  assert.equal(onDisk._ts, 222);
  assert.equal(onDisk._wid, answer.wid);
  assert.equal('active' in onDisk, false);

  // the token buys nothing on any other route, although its user is an admin
  assert.equal((await fetch(`${h.api}/api/admin/users`, bearer(TOKEN))).status, 401);
  assert.equal((await fetch(`${h.api}/api/me`, bearer(TOKEN))).status, 401);
  assert.equal((await fetch(`${h.api}/api/data/rev`, bearer(TOKEN))).status, 401);

  // the session cookie and the paired app's session bearer work as before
  const cookie = { Cookie: `gymsid=${mintSession('u_test_1')}` };
  const rc = await fetch(`${h.api}/api/data`, { headers: cookie });
  assert.equal(rc.status, 200);
  assert.equal((await rc.json()).state._ts, 222);
  const rs = await fetch(`${h.api}/api/data`, bearer(mintSession('u_test_1')));
  assert.equal(rs.status, 200);

  // one failure (the wrong token) and one success (the write); the other requests add nothing
  assert.equal(lines(h.dataDir, 'auth.planner.fail').length, 1);
  assert.match(lines(h.dataDir, 'auth.planner.fail')[0], /"msg":"bad-token"/);
  assert.equal(lines(h.dataDir, 'auth.planner.ok').length, 1);
});

// A planner reads before every write. The audit log is capped and pruned oldest-first, so each read
// as a line would push the sign-ins and failed attempts off the end of it.
test('a planner read is not an audit event; writes and failures are', async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1` });
  for (let i = 0; i < 10; i++) assert.equal((await fetch(`${h.api}/api/data`, bearer(TOKEN))).status, 200);
  assert.equal(lines(h.dataDir, 'auth.planner.ok').length, 0);
  assert.equal((await putState(h, TOKEN, 444)).status, 200);
  assert.equal(lines(h.dataDir, 'auth.planner.ok').length, 1);
  assert.equal((await fetch(`${h.api}/api/data`, bearer(WRONG))).status, 401);
  assert.equal(lines(h.dataDir, 'auth.planner.fail').length, 1);
});

// Anyone can send a junk bearer; unthrottled, each would be a row and push the rest of the capped
// log out. A paired phone with a lapsed session is the same kind of row.
test('refused tokens are throttled in the activity log', async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1`, AUDIT_MAX: '100' });
  assert.equal((await putState(h, TOKEN, 222)).status, 200);
  for (let i = 0; i < 40; i++) assert.equal((await fetch(`${h.api}/api/data`, bearer(WRONG))).status, 401);
  assert.ok(lines(h.dataDir, 'auth.planner.fail').length <= 10, 'a few a minute from one address, not one per request');
  assert.equal(lines(h.dataDir, 'auth.planner.ok').length, 1, 'the write is still in the log');
});

test('a write is audited once it has landed: a 409 or a refused document is not a write', async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1` });
  const stale = await fetch(`${h.api}/api/data`, {
    method: 'PUT', ...bearer(TOKEN), body: JSON.stringify({ baseRev: 5, state: { _ts: 9, routines: [], week: {}, workouts: [] } })
  });
  assert.equal(stale.status, 409);
  assert.equal((await fetch(`${h.api}/api/data`, { method: 'PUT', ...bearer(TOKEN), body: JSON.stringify({ state: {} }) })).status, 400);
  assert.equal(lines(h.dataDir, 'auth.planner.ok').length, 0);
});

test('with planner tokens configured, a paired phone still pulls and pushes with its session bearer', async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1` });
  const phone = bearer(mintSession('u_test_2'));
  assert.equal((await (await fetch(`${h.api}/api/data`, phone)).json()).state._ts, 555);
  assert.equal((await fetch(`${h.api}/api/data`, {
    method: 'PUT', ...phone, body: JSON.stringify({ state: { _ts: 556, routines: [], week: {}, workouts: [] } })
  })).status, 200);
  assert.equal(stateOnDisk(h, 'u_test_2')._ts, 556);
  assert.equal(stateOnDisk(h, 'u_test_1')._ts, 111);
  assert.equal(readAudit(h.dataDir).includes('auth.planner'), false);
});

test('a base64 token with = padding maps to its uid, and no token text reaches the log', async t => {
  const b64 = crypto.randomBytes(32).toString('base64').replace(/=*$/, '=');   // 44 characters, one '='
  const h = await startServer(t, { PLANNER_TOKENS: `${b64}=u_test_1,${TOKEN2}=u_test_2` });
  assert.match(h.log, /planner tokens: on, uids=u_test_1,u_test_2 /);
  assert.equal(await tsOf(h, b64), 111);
  assert.equal((await putState(h, b64, 222)).status, 200);
  assert.equal((await fetch(`${h.api}/api/data`, bearer(WRONG))).status, 401);
  for (const text of [h.log, readAudit(h.dataDir)]) {
    for (const tok of [b64, TOKEN2, WRONG]) assert.equal(text.includes(tok), false);
  }
});

test('a planner PUT honours baseRev like any client', async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1` });
  const put = (baseRev, ts) => fetch(`${h.api}/api/data`, {
    method: 'PUT', ...bearer(TOKEN),
    body: JSON.stringify({ baseRev, state: { _ts: ts, routines: [], week: {}, workouts: [] } })
  });
  assert.equal((await (await fetch(`${h.api}/api/data`, bearer(TOKEN))).json()).rev, 0);

  const stale = await put(5, 999);
  assert.equal(stale.status, 409);
  const body = await stale.json();
  assert.equal(body.rev, 0);
  assert.equal(body.state._ts, 111);
  assert.equal(stateOnDisk(h, 'u_test_1')._ts, 111);

  const ok = await put(0, 222);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).rev, 1);
  assert.equal(stateOnDisk(h, 'u_test_1')._ts, 222);
});

test('PLANNER_TOKENS unset: no boot line, any bearer that is not a session is a 401, the cookie path is unchanged', async t => {
  const h = await startServer(t);
  assert.doesNotMatch(h.log, /planner tokens/);
  assert.equal((await fetch(`${h.api}/api/data`, bearer(TOKEN))).status, 401);
  assert.equal((await fetch(`${h.api}/api/data`, { headers: { Authorization: 'Bearer ' } })).status, 401);
  assert.equal((await fetch(`${h.api}/api/data`, { headers: { Cookie: `gymsid=${mintSession('u_test_1')}` } })).status, 200);
  assert.doesNotMatch(readAudit(h.dataDir), /auth\.planner/);
});

test("a planner read does not count as the user's last sync", async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1` });
  const lastPull = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8')).users.find(u => u.id === 'u_test_1').lastPull;
  assert.equal((await fetch(`${h.api}/api/data`, bearer(TOKEN))).status, 200);
  assert.equal(lastPull(), undefined);
  assert.equal((await fetch(`${h.api}/api/data`, { headers: { Cookie: `gymsid=${mintSession('u_test_1')}` } })).status, 200);
  assert.equal(typeof lastPull(), 'number');
});

/* ---------- refusing to boot ---------- */
// Each of these is a configuration typed by hand, and each one, if it booted, would either 401
// every request with nothing saying why or let one user's planner reach another's profile.

test('boot refusal: a short token, or an entry without a uid', () => {
  const short = run({ PLANNER_TOKENS: `short=u_test_1,${TOKEN2}=u_test_2` });
  assert.equal(short.status, 1);
  assert.match(String(short.stderr), /every token must be at least 32 characters and name a uid/);
  assert.equal(run({ PLANNER_TOKENS: `${TOKEN}=u_test_1,short=u_test_2` }).status, 1);
  assert.equal(run({ PLANNER_TOKENS: TOKEN }).status, 1, 'no = at all');
  assert.equal(run({ PLANNER_TOKENS: `${TOKEN}=` }).status, 1, 'an empty uid');
  assert.equal(run({ PLANNER_TOKENS: `${TOKEN}=u_test_1,${TOKEN2}` }).status, 1, 'one bad entry out of two');
});

test('boot refusal: two tokens for the same uid', () => {
  const r = run({ PLANNER_TOKENS: `${TOKEN}=u_test_1,${TOKEN2}=u_test_1` });
  assert.equal(r.status, 1);
  assert.match(String(r.stderr), /two tokens map to the same uid/);
});

test('boot refusal: the same token listed twice, whatever the uids', () => {
  // A Map keeps only the last uid for a repeated key and says nothing, so this is checked first.
  const two = run({ PLANNER_TOKENS: `${TOKEN}=u_test_1,${TOKEN}=u_test_2` });
  assert.equal(two.status, 1);
  assert.match(String(two.stderr), /PLANNER_TOKENS lists the same token twice/);
  // the same uid twice too: a copied entry whose uid has not been edited yet
  assert.equal(run({ PLANNER_TOKENS: `${TOKEN}=u_test_1,${TOKEN}=u_test_1` }).status, 1);
  assert.equal(run({ PLANNER_TOKENS: `${TOKEN}=u_test_1,${TOKEN2}=u_test_2,${TOKEN2}=u_dis` }).status, 1);
});

/* ---------- several users ---------- */

test('two tokens, two users: each reads and writes only its own state file', async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1,${TOKEN2}=u_test_2` });
  assert.match(h.log, /planner tokens: on, uids=u_test_1,u_test_2 routes=GET,PUT \/api\/data/);
  assert.equal(await tsOf(h, TOKEN), 111);
  assert.equal(await tsOf(h, TOKEN2), 555);

  const before2 = fs.readFileSync(path.join(h.dataDir, 'state-u_test_2.json'), 'utf8');
  assert.equal((await putState(h, TOKEN, 222)).status, 200);
  assert.equal(stateOnDisk(h, 'u_test_1')._ts, 222);
  assert.equal(fs.readFileSync(path.join(h.dataDir, 'state-u_test_2.json'), 'utf8'), before2);
  assert.equal(await tsOf(h, TOKEN2), 555);

  const before1 = fs.readFileSync(path.join(h.dataDir, 'state-u_test_1.json'), 'utf8');
  const p2 = await putState(h, TOKEN2, 666);
  assert.equal(p2.status, 200);
  assert.equal((await p2.json()).rev, 1, "the second user's own revision counter");
  assert.equal(stateOnDisk(h, 'u_test_2')._ts, 666);
  assert.equal(fs.readFileSync(path.join(h.dataDir, 'state-u_test_1.json'), 'utf8'), before1);
});

test('token A cannot act as user B by any means', async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1,${TOKEN2}=u_test_2` });
  const bFile = () => fs.readFileSync(path.join(h.dataDir, 'state-u_test_2.json'), 'utf8');
  const bBefore = bFile();

  // the route has no uid knob: a query string, a header and a body field are all ignored
  const q = await fetch(`${h.api}/api/data?uid=u_test_2`, bearer(TOKEN));
  assert.equal((await q.json()).state._ts, 111);
  const hdr = await fetch(`${h.api}/api/data`, { headers: { Authorization: `Bearer ${TOKEN}`, 'X-User-Id': 'u_test_2' } });
  assert.equal((await hdr.json()).state._ts, 111);
  assert.equal((await fetch(`${h.api}/api/data?uid=u_test_2`, {
    method: 'PUT', ...bearer(TOKEN),
    body: JSON.stringify({ uid: 'u_test_2', user: 'u_test_2', state: { _ts: 777, routines: [], week: {}, workouts: [] } })
  })).status, 200);
  assert.equal(stateOnDisk(h, 'u_test_1')._ts, 777);
  assert.equal(bFile(), bBefore);

  // B's session cookie beside A's token: the token is resolved first and the request acts as A
  const cookieB = { Cookie: `gymsid=${mintSession('u_test_2')}` };
  const mix = await fetch(`${h.api}/api/data`, { headers: { ...cookieB, Authorization: `Bearer ${TOKEN}` } });
  assert.equal((await mix.json()).state._ts, 777);
  assert.equal(bFile(), bBefore);

  for (const bad of [`${TOKEN}=u_test_2`, `${TOKEN} u_test_2`, TOKEN + TOKEN2, TOKEN.slice(0, -1)]) {
    assert.equal((await fetch(`${h.api}/api/data`, bearer(bad))).status, 401, `mangled token accepted: ${bad.slice(0, 12)}…`);
  }
  assert.equal(bFile(), bBefore);
});

test('whitespace around an entry and around its = is not part of the token or the uid', async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `  ${TOKEN} = u_test_1 ,  ${TOKEN2}=u_test_2  ` });
  assert.match(h.log, /planner tokens: on, uids=u_test_1,u_test_2 routes=GET,PUT \/api\/data/);
  assert.equal(await tsOf(h, TOKEN), 111);
  assert.equal(await tsOf(h, TOKEN2), 555);
});

test('a bad token with several configured is one audit line that names nobody', async t => {
  const h = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1,${TOKEN2}=u_test_2` });
  assert.equal((await fetch(`${h.api}/api/data`, bearer(WRONG))).status, 401);
  const fails = lines(h.dataDir, 'auth.planner.fail');
  assert.equal(fails.length, 1, 'one request, one line, not one per configured token');
  assert.match(fails[0], /"msg":"bad-token"/);
  assert.doesNotMatch(fails[0], /u_test_[12]/);
});

test('a token mapped to a disabled or missing user is refused and audited; the other keeps working', async t => {
  const dis = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1,${TOKEN2}=u_dis` });
  assert.equal((await fetch(`${dis.api}/api/data`, bearer(TOKEN2))).status, 401);
  assert.match(readAudit(dis.dataDir), /"ev":"auth\.planner\.fail".*"uid":"u_dis".*"msg":"account-disabled"/);
  assert.equal(await tsOf(dis, TOKEN), 111);
  assert.equal((await putState(dis, TOKEN2, 999)).status, 401);
  assert.equal(fs.existsSync(path.join(dis.dataDir, 'state-u_dis.json')), false);

  const ghost = await startServer(t, { PLANNER_TOKENS: `${TOKEN}=u_test_1,${TOKEN2}=u_ghost` });
  assert.equal((await fetch(`${ghost.api}/api/data`, bearer(TOKEN2))).status, 401);
  assert.match(readAudit(ghost.dataDir), /"ev":"auth\.planner\.fail".*"uid":"u_ghost".*"msg":"token-user-missing"/);
  assert.equal(await tsOf(ghost, TOKEN), 111);
});
