/* Three handlers want one field out of the state document and used to parse the whole of it on
   the event loop: GET /api/data/rev (polled every 30 s and on every return to the foreground),
   and the two that only want `lang` (POST /api/push/test, POST /api/push/rest-timer — once per
   set). Measured on a 2.4 MB state that was 31 ms per rev poll, and 30 concurrent polls blocked
   the loop for 850 ms. readStateCached — the stat cache the reminder tick has always used — reads
   the file only when its mtime or size moved.

   The key is (mtimeMs, size), and neither field is as sharp as it looks: mtime granularity is
   4 ms on ext4 on this kernel (3901 of 3999 back-to-back same-size writes shared one timestamp),
   and a `_rev` going from 7 to 8 keeps the file exactly as long. So a sync and the poll after it
   inside one 4 ms tick are the same key, and the poll serves the revision from before the write —
   measured at 7-8 of 14 rounds — and goes on serving it until some later write lands on a
   different tick. PUT /api/data, the only writer of a state file in the tree, therefore evicts
   the entry itself. The first test is that case.

   The second test is the same blind spot from the other side: an out-of-band rewrite with a
   pinned mtime and an identical size is invisible to the key, and no eviction covers it because
   nothing in this tree writes that way — which is what makes it a usable probe for whether the
   poll reads through the cache at all. */
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
const headers = { Cookie: `gymsid=${mintSession('u_cost_1')}`, 'Content-Type': 'application/json' };

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-statecost-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_cost_1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: '', port: 0, dataDir, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  // The boot line carries the port the listener bound, so it is both the address and the
  // readiness signal — see boundPort in helpers.mjs for why the test does not pick one.
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  return h;
}

/* One keep-alive socket, strictly one request at a time — the next is written only once the
   previous response has been read in full, which is the ordering a browser gives. `fetch` cannot
   be used here: undici's round trip is ~17 ms, four mtime ticks, so it can never land a sync and
   the poll after it inside one tick. This does, at well under a millisecond a request.
   Deliberately NOT pipelined: pipelining lets the server start the poll's handler before the
   PUT's has finished, which is a different effect and would prove nothing about the cache. */
async function keepAlive(t, port) {
  const sock = net.connect(port, '127.0.0.1');
  await new Promise(r => sock.once('connect', r));
  t.after(() => sock.destroy());
  let buf = Buffer.alloc(0), want = null;
  const parse = () => {
    if (!want) return;
    const i = buf.indexOf('\r\n\r\n');
    if (i < 0) return;
    const head = buf.slice(0, i).toString();
    const cl = /content-length: (\d+)/i.exec(head);
    let body;
    if (cl) {
      const n = +cl[1];
      if (buf.length < i + 4 + n) return;
      body = buf.slice(i + 4, i + 4 + n).toString();
      buf = buf.slice(i + 4 + n);
    } else {                                  // json() sets no length, so node chunks it
      let off = i + 4; body = '';
      for (;;) {
        const j = buf.indexOf('\r\n', off);
        if (j < 0) return;
        const n = parseInt(buf.slice(off, j).toString(), 16);
        if (n === 0) { if (buf.length < j + 4) return; off = j + 4; break; }
        if (buf.length < j + 2 + n + 2) return;
        body += buf.slice(j + 2, j + 2 + n).toString(); off = j + 2 + n + 2;
      }
      buf = buf.slice(off);
    }
    const w = want; want = null; w(JSON.parse(body));
  };
  sock.on('data', d => { buf = Buffer.concat([buf, d]); parse(); });
  const send = raw => new Promise(res => { want = res; sock.write(raw); parse(); });
  return {
    put: ts => {
      const b = JSON.stringify({ state: { _ts: ts, workouts: [], routines: [] } });
      return send(`PUT /api/data HTTP/1.1\r\nHost: x\r\nCookie: ${headers.Cookie}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(b)}\r\n\r\n${b}`);
    },
    rev: () => send(`GET /api/data/rev HTTP/1.1\r\nHost: x\r\nCookie: ${headers.Cookie}\r\n\r\n`)
  };
}

test('a poll right after a sync reports the revision that sync returned, not the one before it', async t => {
  const h = await startServer(t);
  const c = await keepAlive(t, h.port);
  const file = path.join(h.dataDir, 'state-u_cost_1.json');

  // The client's real loop: sync, poll, sync, poll. Every document here is the same length as the
  // last (only `_ts` and a one-digit `_rev` move), and each pair is inside one 4 ms tick, so
  // without an eviction on write 7-8 of these polls answer with the revision from before the PUT
  // and the client concludes it is already up to date.
  const stale = [];
  for (let i = 0; i < 20; i++) {
    const wrote = await c.put(100 + i);
    const polled = await c.rev();
    if (polled.rev !== wrote.rev) stale.push(`round ${i}: PUT returned rev ${wrote.rev}, the poll said ${polled.rev}`);
  }
  assert.deepEqual(stale, [], 'every poll saw the write that preceded it');

  // and what the polls were reporting is what is actually on disk
  assert.equal((await c.rev()).rev, JSON.parse(fs.readFileSync(file, 'utf8'))._rev);
});

test('the poll really is reading through the stat cache', async t => {
  const h = await startServer(t);
  const file = path.join(h.dataDir, 'state-u_cost_1.json');
  const rev = async () => (await fetch(`${h.api}/api/data/rev`, { headers }).then(r => r.json())).rev;
  // An out-of-band rewrite, same length and the same pinned mtime, so the key cannot tell the two
  // apart. utimesSync round-trips this value exactly. Nothing in this tree writes a state file
  // this way — which is what makes it a probe for the cache rather than a bug report.
  const PINNED = new Date(1700000000000);
  const writePinned = n => {
    fs.writeFileSync(file, JSON.stringify({ _rev: n, lang: 'en', workouts: [], routines: [] }));
    fs.utimesSync(file, PINNED, PINNED);
    return fs.statSync(file);
  };

  const a = writePinned(7);
  assert.equal(await rev(), 7, 'the first poll reads the file');

  const b = writePinned(8);
  assert.equal(a.mtimeMs, b.mtimeMs, 'the rewrite really did keep its mtime');
  assert.equal(a.size, b.size, 'and its size');
  assert.equal(await rev(), 7, 'nothing the key can see changed, so the file was not parsed again');

  // And a PUT evicts, so the poll is back in step with the file immediately.
  const put = await fetch(`${h.api}/api/data`, {
    method: 'PUT', headers, body: JSON.stringify({ state: { _ts: 1, workouts: [], routines: [] } })
  }).then(r => r.json());
  assert.equal(await rev(), put.rev, 'a write through the app is on the very next poll');
});

// The other two sites want `lang` for a push payload, which nothing outside the push service can
// observe — so they are pinned here, at the only place that can see them: the source.
test('the three hot-path state reads all go through readStateCached', () => {
  const src = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
  // Every route is one `'METHOD /path': async (req, res) => {` entry in the routes object, so a
  // handler runs from its key to the start of the next one.
  const handler = key => {
    const at = src.indexOf(`'${key}':`);
    assert.notEqual(at, -1, `route ${key} is gone — this test needs rewriting`);
    const end = src.indexOf("\n  '", at + 1);
    return src.slice(at, end === -1 ? undefined : end);
  };
  for (const key of ['GET /api/data/rev', 'POST /api/push/test', 'POST /api/push/rest-timer']) {
    const body = handler(key);
    assert.match(body, /readStateCached\(user\.id\)/, `${key} should read through the cache`);
    assert.doesNotMatch(body, /readState\(user\.id\)/, `${key} parses the whole document again`);
  }
  // GET /api/data hands out the document itself and PUT compares against it — both want the real
  // thing, uncached.
  assert.match(handler('GET /api/data'), /readState\(user\.id\)/);
  assert.match(handler('PUT /api/data'), /readState\(user\.id\)/);
});
