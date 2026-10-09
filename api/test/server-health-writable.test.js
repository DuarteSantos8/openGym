/* GET /api/health used to answer `{"ok":true}` as long as the process was alive — including on a
   full disk or a bind mount that had come back read-only, where every write path in the server is
   broken and the container's healthcheck (`wget --spider`, api/Dockerfile) still reads healthy.
   It writes a probe file under DATA_DIR now, and answers 503 when it cannot. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');

function seedDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-health-'));
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_h_1', name: 'H', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  // Boot writes this one if it is missing, which a read-only directory would refuse before the
  // server ever listened — the point here is a server that is up and cannot write, not one that
  // cannot start. The keys have to be real: web-push validates them at setVapidDetails.
  fs.writeFileSync(path.join(dir, 'vapid.json'), JSON.stringify(webpush.generateVAPIDKeys()));
  return dir;
}

async function startServer(t, dataDir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  t.after(() => { child.kill('SIGKILL'); fs.chmodSync(dataDir, 0o700); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  // The boot line, not a health poll: the poll is what is under test here.
  const port = await new Promise((resolve, reject) => {
    const give = setTimeout(() => reject(new Error(`server never announced a port:\n${log}`)), 20000);
    child.stdout.on('data', d => { log += d; const m = /gym-api on :(\d+)/.exec(log); if (m) { clearTimeout(give); resolve(+m[1]); } });
    child.stderr.on('data', d => { log += d; });
    child.on('exit', c => { clearTimeout(give); reject(new Error(`server exited (${c}):\n${log}`)); });
  });
  return { api: `http://127.0.0.1:${port}`, log: () => log };
}

test('a writable data directory answers 200, and says so', async t => {
  const h = await startServer(t, seedDir());
  const r = await fetch(`${h.api}/api/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, users: 1, writable: true });
});

test('a data directory the server cannot write to is 503, not healthy', async t => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root: a mode that denies writes does not deny them to root');
    return;
  }
  const dir = seedDir();
  const h = await startServer(t, dir);

  // Denied before the first poll, so nothing has been probed — or cached — yet.
  fs.chmodSync(dir, 0o500);                       // r-x: the mount came back read-only
  const r = await fetch(`${h.api}/api/health`);
  assert.equal(r.status, 503, 'wget --spider reads this as unhealthy, which is the point');
  assert.deepEqual(await r.json(), { ok: false, writable: false });
  // The child's stderr is a pipe of its own, with no ordering guarantee against the socket the
  // answer came back on — the line can land after the fetch resolves, and did in 1 run of 130.
  for (let i = 0; i < 100 && !/health: cannot write to/.test(h.log()); i++) await new Promise(r => setTimeout(r, 20));
  assert.match(h.log(), /health: cannot write to/, 'and the operator is told which directory');

  // The probe is cached for five seconds, so the very next poll answers from it even though the
  // directory is writable again — two polls, one probe, which is what keeps an unauthenticated
  // route from being a disk write on demand.
  fs.chmodSync(dir, 0o700);
  assert.equal((await fetch(`${h.api}/api/health`)).status, 503, 'the second poll did not probe again');

  // A window, not a latch: past it, it recovers on its own with no restart.
  await new Promise(r => setTimeout(r, 5200));
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200);

  // Nothing is left behind by the probe itself.
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.startsWith('.health-')), []);
});
