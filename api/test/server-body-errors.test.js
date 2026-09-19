/* A browser hanging up mid-body — which is what pagehide does to an in-flight sync — is not a
   server error, and it used to print a four-line stack per request. It is one warning line now.

   The other two ways a body fails to arrive, unparseable JSON and a body over the cap, are
   covered by server-bad-input.test.js. Raw sockets here, because an abort has to be a real
   hang-up: a client that stops writing is not the same as one that goes away. Real server.js
   in a child. */
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
const SECRET = crypto.randomBytes(32).toString('hex');

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-bodyerr-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_body_1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: '', port: 0, dataDir, log: '', exited: null };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  child.on('exit', (code, signal) => { h.exited = { code, signal }; });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  // The boot line carries the port the listener bound, so it is both the address and the
  // readiness signal — see boundPort in helpers.mjs for why the test does not pick one.
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.cookie = `gymsid=${mintSession('u_body_1')}`;
  return h;
}

/* One request over a socket we drive ourselves. `write` is called with the socket once the
   headers are out, so a test can trickle, flood or hang up as it likes; the promise settles with
   whatever came back (or 'reset' / 'closed' if nothing did). No Origin header: no browser sent
   this, which is what csrfOk already allows. */
function raw(h, requestLine, headers, write) {
  return new Promise(resolve => {
    let got = '';
    const s = net.connect(h.port, '127.0.0.1', () => {
      s.write(`${requestLine} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n${headers}\r\n`);
      write(s, () => resolve(got || 'closed'));
    });
    s.on('data', d => {
      got += d;
      if (got.includes('\r\n\r\n')) { s.destroy(); resolve(got); }
    });
    s.on('error', e => resolve(got || 'reset:' + e.code));
    s.on('close', () => resolve(got || 'closed'));
  });
}
const stackLines = log => log.split('\n').filter(l => /^\s+at /.test(l));

test('a client that hangs up mid-body costs one log line and no stack', async t => {
  const h = await startServer(t);
  const aborts = 5;
  for (let i = 0; i < aborts; i++) {
    await raw(h, 'PUT /api/data',
      `Cookie: ${h.cookie}\r\nContent-Type: application/json\r\nContent-Length: 5000\r\n`,
      (s, done) => { s.write('{"state":{'); setTimeout(() => { s.destroy(); done(); }, 60); });
  }
  await new Promise(r => setTimeout(r, 300));

  assert.equal(h.exited, null);
  assert.deepEqual(stackLines(h.log), [], `nothing to trace:\n${h.log}`);
  assert.equal((h.log.match(/client went away mid-body/g) || []).length, aborts, `one line each:\n${h.log}`);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'state-u_body_1.json')), false, 'and nothing was written');
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200);
});
