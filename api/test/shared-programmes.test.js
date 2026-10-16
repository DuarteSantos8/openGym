import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { validateSharedProgramme } from '../shared-programmes.js';

const bundle = () => ({ opengym_programme: 1, exported: '2026-10-14', unit: 'kg',
  programme: { name: 'Shared strength', progression: 'linear', weeks: [{ mode: 'normal', days: [{ weekday: 1, sessions: [{ routineRef: 'programme-routine-1' }] }] }] },
  plan: { opengym_plan: 1, exported: '2026-10-14', unit: 'kg', week: {}, routines: [{ id: 'programme-routine-1', name: 'A', ex: [{ id: '0025', sets: 3, reps: 5 }] }], customEx: [] },
});
test('publication accepts prescriptions but rejects account fields, private media and malformed references', () => {
  assert.deepEqual(validateSharedProgramme(bundle()), bundle());
  for (const corrupt of [
    b => { b.workouts = []; }, b => { b.plan.routines[0].ex[0].media = { hash: 'private' }; },
    b => { b.programme.weeks[0].days[0].sessions[0].routineRef = 'missing'; },
    b => { b.programme.weeks[0].days.push(b.programme.weeks[0].days[0]); },
    b => { b.plan.routines[0].ex[0].sets = 0; }, b => { b.programme.weeks = []; },
    b => { b.plan.customEx = [{ id: 'unused', n: 'Private exercise' }]; },
    b => { b.plan.routines[0].name = 'x'.repeat(2 * 1024 * 1024); },
  ]) { const b = bundle(); corrupt(b); assert.throws(() => validateSharedProgramme(b)); }
});

test('shared library is admin-controlled, persists, and reaches accounts created after publication', async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-shared-'));
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(data, 'secret'), secret);
  fs.writeFileSync(path.join(data, 'db.json'), JSON.stringify({ users: [{ id: 'admin', name: 'Owner', admin: true }, { id: 'reader', name: 'Reader' }, { id: 'disabled', disabled: true }], creds: [], subs: [], invites: [] }));
  const personal = JSON.stringify({ routines: [], workouts: [{ id: 'history' }], programmes: { definitions: [], cycles: [] } });
  fs.writeFileSync(path.join(data, 'state-reader.json'), personal);
  let child;
  t.after(async () => { if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } fs.rmSync(data, { recursive: true, force: true }); });
  const start = async () => {
    child = spawn(process.execPath, ['server.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATA_DIR: data, PORT: '0', ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', PASSWORD_LOGIN: '1', COACH_ENABLED: '0' } });
    let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
    return `http://127.0.0.1:${await boundPort(child, () => log)}`;
  };
  let base = await start();
  const cookie = uid => { const p = `${uid}:${Date.now() + 3600000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', secret).update(p).digest('base64url')}`; };
  const request = async (url, uid, method = 'GET', body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: cookie(uid) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') };
  };
  const adminPath = '/api/admin/shared-programmes', publicPath = '/api/shared-programmes';
  assert.equal((await request(publicPath)).status, 401);
  assert.equal((await request(publicPath, 'disabled')).status, 401);
  assert.equal((await request(adminPath, 'reader')).status, 403);
  const publication = { revision: 0, sourceId: 'mine', bundle: bundle() };
  assert.equal((await request(adminPath, 'reader', 'POST', publication)).status, 403);
  const crossOrigin = await fetch(base + adminPath, { method: 'POST', headers: { Cookie: cookie('admin'), Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify(publication) });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await request(adminPath, 'admin', 'POST', publication)).status, 200);
  assert.equal((await request(adminPath, 'admin', 'POST', publication)).status, 409);
  let rows = (await request(publicPath, 'reader')).body.programmes;
  assert.equal(rows.length, 1); assert.equal('sourceId' in rows[0], false); assert.equal('ownerUid' in rows[0], false);
  const id = rows[0].id;
  assert.deepEqual((await request(publicPath + '?id=' + id, 'reader')).body.bundle, bundle());
  const registered = await request('/api/register/password', null, 'POST', { name: 'Future Person', password: 'Correct-Exercises-739!planet' });
  assert.equal(registered.status, 200, JSON.stringify(registered.body));
  const future = await fetch(base + publicPath, { headers: { Cookie: registered.cookie.split(';')[0] } });
  assert.deepEqual((await future.json()).programmes, rows);
  child.kill(); await new Promise(resolve => child.once('exit', resolve)); base = await start();
  assert.equal((await request(publicPath, 'reader')).body.programmes[0].id, id);
  const updated = bundle(); updated.programme.name = 'Updated';
  assert.equal((await request(adminPath, 'admin', 'POST', { ...publication, revision: 1, bundle: updated })).status, 200);
  assert.equal((await request(publicPath, 'reader')).body.programmes.length, 1);
  assert.equal((await request(adminPath, 'reader', 'DELETE', { revision: 2, id })).status, 403);
  assert.equal((await request(adminPath, 'admin', 'DELETE', { revision: 2, id })).status, 200);
  assert.equal((await request(publicPath + '?id=' + id, 'reader')).status, 404);
  assert.deepEqual((await request(publicPath, 'reader')).body.programmes, []);
  assert.equal(fs.readFileSync(path.join(data, 'state-reader.json'), 'utf8'), personal);
  fs.writeFileSync(path.join(data, 'shared-programmes.json'), 'broken');
  assert.equal((await request(adminPath, 'admin', 'POST', { ...publication, revision: 3 })).status, 500);
  assert.equal(fs.readFileSync(path.join(data, 'shared-programmes.json'), 'utf8'), 'broken');
});
