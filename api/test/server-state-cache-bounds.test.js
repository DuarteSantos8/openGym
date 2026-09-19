/* The stat cache behind GET /api/data/rev (and the reminder tick, and the two push routes) holds
   a whole parsed state per user — megabytes each on a long-used profile — and used to hold every
   one of them for the life of the process. Two bounds now: an entry nobody has hit for
   STATE_CACHE_TTL_MS is dropped, and the map never exceeds 64 users, oldest hit first.

   Neither is visible in a response on its own, so both are read here through the probe
   server-state-read-cost.test.js established: an out-of-band rewrite with a pinned mtime and an
   identical size is invisible to the cache key, so a cached read answers with the old revision
   and a read that had to go to disk answers with the new one. Nothing in this tree writes a state
   file that way — which is what makes it a probe rather than a bug. */
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
const PROBE = 'u_cache_probe';
// One more than the cap, so polling all of them pushes exactly one entry — the probe's — out.
const FILLERS = Array.from({ length: 64 }, (_, i) => `u_cache_${i}`);

const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const headers = uid => ({ Cookie: `gymsid=${mint(uid)}` });

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-cachebound-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const users = [PROBE, ...FILLERS].map(id => ({ id, name: id, created: new Date().toISOString() }));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }));
  // Every filler needs a file of its own: a uid with no state file is never cached at all.
  for (const uid of FILLERS) fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify({ _rev: 1, workouts: [], routines: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ...env }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  return { api: `http://127.0.0.1:${port}`, dataDir };
}

// utimesSync round-trips this value exactly, and the document is the same length at every
// revision below, so (mtimeMs, size) cannot tell two of these apart.
const PINNED = new Date(1700000000000);
const writePinned = (dir, uid, rev) => {
  const file = path.join(dir, `state-${uid}.json`);
  fs.writeFileSync(file, JSON.stringify({ _rev: rev, lang: 'en', workouts: [], routines: [] }));
  fs.utimesSync(file, PINNED, PINNED);
};

test('the cache holds at most 64 users, and the least recently polled is the one dropped', async t => {
  const h = await startServer(t);
  const rev = async uid => (await fetch(`${h.api}/api/data/rev`, { headers: headers(uid) }).then(r => r.json())).rev;

  writePinned(h.dataDir, PROBE, 7);
  assert.equal(await rev(PROBE), 7, 'the first poll reads the file');
  writePinned(h.dataDir, PROBE, 8);
  assert.equal(await rev(PROBE), 7, 'and the second is served from the cache, as it should be');

  // 64 other people poll once each. That is one more entry than the cap allows alongside the
  // probe's, and the probe's is the one nobody has touched since.
  for (const uid of FILLERS) await rev(uid);

  assert.equal(await rev(PROBE), 8, 'the probe was evicted, so its file was read again');
});

test('an entry nobody has polled for longer than the TTL is dropped', async t => {
  const h = await startServer(t, { STATE_CACHE_TTL_MS: '150' });
  const rev = async uid => (await fetch(`${h.api}/api/data/rev`, { headers: headers(uid) }).then(r => r.json())).rev;

  writePinned(h.dataDir, PROBE, 7);
  assert.equal(await rev(PROBE), 7);
  writePinned(h.dataDir, PROBE, 8);
  assert.equal(await rev(PROBE), 7, 'still inside the TTL — the cached copy answers');

  await new Promise(r => setTimeout(r, 400));
  assert.equal(await rev(PROBE), 8, 'past it, the entry is gone and the file is read again');
});
