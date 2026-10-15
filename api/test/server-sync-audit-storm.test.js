/* A misconfigured hub fails every sync call it makes, from one address, for as long as nobody
   looks. Each refusal used to be audited ten times a minute, and the log keeps only the newest
   AUDIT_MAX rows: at 5,000 that was every sign-in, admin action and deletion gone in about eight
   hours. Repeats of a reason are now one counted row an hour (audit-aggregate.js).

   Real server.js in a child, its Date.now() driven by test/fake-clock.mjs, with a small
   AUDIT_MAX so the storm is short. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { ISSUER, hubKey, jwks, mint } from './hub-fixtures.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60000;
const AUDIT_MAX = 50;

test('a storm of refused sync tokens cannot push other rows out of the audit log', async t => {
  const T0 = Date.now();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-sync-storm-'));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'Ana', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  // What the log is for: sign-ins and admin actions written before the storm.
  const kept = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, ts: T0 - MIN, ev: i % 2 ? 'auth.login' : 'admin.user.delete', ok: true }));
  fs.writeFileSync(path.join(dataDir, 'audit.log'), kept.map(r => JSON.stringify(r)).join('\n') + '\n');

  const key = hubKey('hub-1');
  const child = spawn(process.execPath, ['--import', './test/fake-clock.mjs', 'server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_UIDS: '',
      AUDIT_LOG: '1', AUDIT_MAX: String(AUDIT_MAX), HUB_JWKS: jwks(key), HUB_ISSUER: ISSUER
    }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const at = now => new Promise(resolve => {
    const done = m => { if (m && m.now === now) { child.off('message', done); resolve(); } };
    child.on('message', done);
    child.send({ now });
  });
  const stranger = hubKey('not-ours');
  const refuse = async token => {
    const r = await fetch(`${api}/api/sync/ping`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 401, log);
  };

  // Ten hours of a hub failing every call: 30 refusals every ten minutes, two reasons.
  let sent = 0;
  for (let burst = 0; burst < 60; burst++) {
    await at(T0 + burst * 10 * MIN);
    for (let i = 0; i < 15; i++) { await refuse('not-a-token'); await refuse(mint(stranger, { sub: 'u1' })); sent += 2; }
  }

  const rows = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const r of kept) assert.ok(rows.some(x => x.id === r.id && x.ev === r.ev), `row ${r.id} (${r.ev}) is still there`);
  const storm = rows.filter(r => r.ev === 'sync.token.fail');
  // Two reasons, ten hourly windows: a first row and a counted row each, at most.
  assert.ok(storm.length <= 2 * 2 * 10, `${storm.length} rows for ${sent} refusals`);
  assert.deepEqual([...new Set(storm.map(r => r.msg))].sort(), ['kid', 'malformed']);
  // An hour of one reason is 6 bursts of 15: the first row, then one row for the other 89.
  assert.ok(storm.some(r => r.n === 89), 'a counted row says how many it stands for');
  // Every refusal is accounted for once (a first row is one, a counted row is its n), except
  // the repeats in the two windows still open.
  const accounted = storm.reduce((n, r) => n + (r.n || 1), 0);
  assert.ok(accounted <= sent && accounted >= sent - 2 * 6 * 15, `${accounted} of ${sent}`);
  assert.ok(!log.includes('not-a-token'));
});
