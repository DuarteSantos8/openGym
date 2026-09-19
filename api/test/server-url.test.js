/* A request target that does not parse as a URL (`//`, `//api%2Fhealth`) must get a 400 from the
   listener and leave the process running — the parse sits before the per-route try/catch, so a
   throw there is an unhandled rejection and a dead api container. Raw sockets, because
   fetch() refuses to send such targets in the first place. Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-url-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: '', port: 0, child, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  // The boot line carries the port the listener bound, so it is both the address and the
  // readiness signal — see boundPort in helpers.mjs for why the test does not pick one.
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  return h;
}

// One request over a bare TCP socket, target written verbatim; resolves with the raw response.
function rawGet(port, target) {
  return new Promise((resolve, reject) => {
    let out = '';
    const s = net.connect(port, '127.0.0.1', () => s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    s.on('data', d => out += d);
    s.on('end', () => resolve(out));
    s.on('error', reject);
  });
}

test('an unparseable request target is a 400, and the server keeps answering afterwards', async t => {
  const h = await startServer(t);
  for (const target of ['//', '//api%2Fhealth', '//api%2F/health']) {
    const res = await rawGet(h.port, target);
    assert.match(res, /^HTTP\/1\.1 400 /, `${target} ->\n${res || '(no response)'}\n${h.log}`);
  }
  // a normal target still parses and still routes
  assert.match(await rawGet(h.port, '/api/health'), /^HTTP\/1\.1 200 /);
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200);
  assert.equal(h.child.exitCode, null, `server exited:\n${h.log}`);
});
