/* The media routes on a real server.js in a child process: sessions, CSRF, CORS, the throttle,
   the headers a stored file is served with, the config block, the PUT /api/data hook, admin
   delete, and what is left on disk after each refusal. Caps are lowered through the MEDIA_*
   variables where a test needs to cross one. media-receive.test.js and media-gc.test.js cover
   the store itself in-process. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import * as M from './media-samples.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:8080';
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const U1 = 'u_media_1', U2 = 'u_media_2', ADMIN = 'u_media_adm';
const cookie = uid => ({ Cookie: `gymsid=${mint(uid)}`, Origin: ORIGIN });
const bearer = uid => ({ Authorization: `Bearer ${mint(uid)}` });
const refState = (...hashes) => ({
  unit: 'kg', routines: [], workouts: [],
  customEx: hashes.map((h, i) => ({ id: 'cx' + i, n: 'Sandbag ' + i, bp: 'back', custom: true, media: { kind: 'image', hash: h, mime: 'image/jpeg', size: 1, width: 1, height: 1, at: 1 } }))
});

async function start(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-media-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: U1, name: 'Ana', created: new Date().toISOString() },
      { id: U2, name: 'Bo', created: new Date().toISOString() },
      { id: ADMIN, name: 'Admin', created: new Date().toISOString(), admin: true }
    ],
    creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', MEDIA_MIN_FREE_MB: '1', ...env }
  });
  const h = { log: '', dataDir, uploads: path.join(dataDir, 'uploads') };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.put = (bytes, { uid = U1, declare = 'image/jpeg', hash = M.sha(bytes), headers } = {}) =>
    fetch(`${h.api}/api/media/${hash}`, { method: 'PUT', headers: { ...(headers || cookie(uid)), 'Content-Type': declare }, body: bytes });
  h.get = (hash, uid = U1, headers) => fetch(`${h.api}/api/media/${hash}`, { headers: headers || cookie(uid) });
  h.post = (route, body, uid = U1) => fetch(`${h.api}${route}`, { method: 'POST', headers: { ...cookie(uid), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  h.pushState = (state, uid = U1) => fetch(`${h.api}/api/data`, { method: 'PUT', headers: { ...cookie(uid), 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) });
  h.files = uid => { try { return fs.readdirSync(path.join(h.uploads, uid)).filter(n => !n.startsWith('.')).sort(); } catch { return []; } };
  h.tmp = uid => { try { return fs.readdirSync(path.join(h.uploads, uid, '.tmp')); } catch { return []; } };
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  return h;
}

/* A request written by hand, for what fetch cannot do: stop halfway, stream without a length,
   or claim a length it never sends. Resolves `response` with {status, headers, body}. */
function rawPut(h, hash, { headers = {}, declare = 'image/jpeg', length } = {}) {
  const hd = { ...cookie(U1), 'Content-Type': declare, ...headers };
  if (length != null) hd['Content-Length'] = String(length);
  const req = http.request(`${h.api}/api/media/${hash}`, { method: 'PUT', headers: hd });
  const response = new Promise((resolve, reject) => {
    req.on('response', res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => body += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(body); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, body: j }); });
    });
    req.on('error', reject);
  });
  return { req, response };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('every media route wants a session', async t => {
  const h = await start(t);
  const hash = 'a'.repeat(64);
  const noAuth = { Origin: ORIGIN };
  assert.equal((await fetch(`${h.api}/api/media/${hash}`, { method: 'PUT', headers: { ...noAuth, 'Content-Type': 'image/jpeg' }, body: M.jpeg() })).status, 401);
  assert.equal((await fetch(`${h.api}/api/media/${hash}`)).status, 401);
  assert.equal((await fetch(`${h.api}/api/media/missing`, { method: 'POST', headers: noAuth, body: '{"hashes":[]}' })).status, 401);
  assert.equal((await fetch(`${h.api}/api/media/sweep`, { method: 'POST', headers: noAuth, body: '{}' })).status, 401);
  assert.equal(fs.existsSync(h.uploads), false);
});

test('an upload is served back whole, with the headers that keep it from ever being a page', async t => {
  const h = await start(t);
  const bytes = M.webp(5000);
  const up = await h.put(bytes, { declare: 'image/webp' });
  assert.equal(up.status, 201);
  assert.deepEqual(await up.json(), { ok: true, hash: M.sha(bytes), mime: 'image/webp', size: 5000, existed: false });

  const r = await h.get(M.sha(bytes));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/webp');
  assert.equal(r.headers.get('content-length'), '5000');
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(r.headers.get('content-disposition'), `inline; filename="${M.sha(bytes)}.webp"`);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.equal(r.headers.get('etag'), null);
  assert.equal(r.headers.get('accept-ranges'), null);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(bytes));

  // Again: already there, counted once.
  const again = await h.put(bytes, { declare: 'image/webp' });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).existed, true);
  const miss = await (await h.post('/api/media/missing', { hashes: [M.sha(bytes)] })).json();
  assert.deepEqual(miss, { missing: [], usage: { bytes: 5000, count: 1, quotaBytes: 200 * 1048576 } });
  assert.equal(h.stackFrames(), 0, h.log);
});

test("another profile's file is exactly as missing as one that was never uploaded", async t => {
  const h = await start(t);
  const bytes = M.jpeg();
  assert.equal((await h.put(bytes)).status, 201);
  const r = await h.get(M.sha(bytes), U2);
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'no such file', code: 'media-missing' });
  const never = await h.get('0'.repeat(64), U2);
  assert.equal(never.status, 404);
  assert.deepEqual((await (await h.post('/api/media/missing', { hashes: [M.sha(bytes)] }, U2)).json()).missing, [M.sha(bytes)]);
  // A path that is not a hash is no media route at all.
  assert.equal((await h.get('A'.repeat(64))).status, 404);
  assert.equal((await fetch(`${h.api}/api/media/..%2Fstate-${U1}.json`, { headers: cookie(U1) })).status, 404);
});

test('refusals: a wrong hash, SVG, a video posing as an image — each leaves nothing on disk', async t => {
  const h = await start(t);
  const bytes = M.jpeg();
  let r = await h.put(bytes, { hash: 'f'.repeat(64) });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'the file does not match its name', code: 'hash-mismatch' });

  r = await h.put(M.svg(), { declare: 'image/svg+xml' });
  assert.deepEqual([r.status, (await r.json()).code], [415, 'media-type']);
  r = await h.put(M.svg(), { declare: 'image/png' });
  assert.deepEqual([r.status, (await r.json()).code], [415, 'media-type']);
  r = await h.put(M.html(), { declare: 'image/jpeg' });
  assert.deepEqual([r.status, (await r.json()).code], [415, 'media-type']);
  r = await h.put(M.mp4(), { declare: 'image/jpeg' });
  assert.deepEqual([r.status, (await r.json()).code], [415, 'media-type']);

  assert.deepEqual(h.files(U1), []);
  assert.deepEqual(h.tmp(U1), []);
  assert.equal(h.stackFrames(), 0, `a refusal is not a server error:\n${h.log}`);
});

test('a declared length over the cap is answered before the body is sent', async t => {
  const h = await start(t);
  const hash = 'c'.repeat(64);
  const { req, response } = rawPut(h, hash, { length: 100 * 1024 * 1024 });
  req.write(M.jpeg(1024));                        // and never the other 99.99 MB
  const r = await response;
  req.destroy();
  assert.equal(r.status, 413);
  assert.deepEqual(r.body, { error: 'that file is too large', code: 'media-too-large', maxMB: 2 });
  assert.deepEqual(h.tmp(U1), []);
});

test('a body more than twice its kind\'s cap still gets its 413, not a reset', async t => {
  // A 2000-byte image cap and a 5000-byte photo: a phone whose own limits were bigger than this
  // server's. Draining only twice the image cap reset the connection before the answer.
  const h = await start(t, { MEDIA_IMAGE_MAX_MB: String(2000 / 1048576) });
  const r = await h.put(M.jpeg(5000));
  assert.equal(r.status, 413);
  assert.equal((await r.json()).code, 'media-too-large');
  assert.deepEqual(h.tmp(U1), []);
});

test('the cap of what the bytes are applies, and the quota says how full it is', async t => {
  // 10 KB images, 1 MB GIFs, a 25 KB quota.
  const h = await start(t, { MEDIA_IMAGE_MAX_MB: '0.009765625', MEDIA_GIF_MAX_MB: '1', MEDIA_QUOTA_MB: '0.0244140625' });
  const jpegAsGif = M.jpeg(20000);
  let r = await h.put(jpegAsGif, { declare: 'image/gif' });
  assert.equal(r.status, 413);
  assert.deepEqual(await r.json(), { error: 'that file is too large', code: 'media-too-large', maxMB: 0.009765625 });

  assert.equal((await h.put(M.jpeg(9000), { uid: U2 })).status, 201);
  assert.equal((await h.put(M.jpeg(9000), { uid: U2 })).status, 201);
  r = await h.put(M.jpeg(9000), { uid: U2 });
  assert.equal(r.status, 413);
  assert.deepEqual(await r.json(), { error: 'your space for photos and videos is full', code: 'media-quota', usedMB: 0, quotaMB: 0.0244140625 });
  assert.equal(h.files(U2).length, 2);
});

test('a video longer than MEDIA_VIDEO_MAX_SEC is refused, and a broken one too', async t => {
  const h = await start(t);
  let r = await h.put(M.mp4({ seconds: 90 }), { declare: 'video/mp4' });
  assert.deepEqual([r.status, await r.json()], [413, { error: 'that video is too long', code: 'media-too-long', maxSec: 60 }]);
  r = await h.put(Buffer.concat([M.ftyp(), M.box('mdat', Buffer.alloc(64))]), { declare: 'video/mp4' });
  assert.deepEqual([r.status, (await r.json()).code], [415, 'media-invalid']);
  r = await h.put(M.mp4({ brand: 'qt  ', seconds: 30, moovAtEnd: true }), { declare: 'video/quicktime' });
  assert.deepEqual([r.status, (await r.json()).mime], [201, 'video/quicktime']);
});

test('an upload without Content-Length works, and is cut off at the cap while it streams', async t => {
  const h = await start(t, { MEDIA_IMAGE_MAX_MB: '0.1' });
  const small = M.jpeg(50000);
  let { req, response } = rawPut(h, M.sha(small));
  req.write(small.subarray(0, 20000));
  await sleep(20);
  req.end(small.subarray(20000));
  let r = await response;
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const big = M.jpeg(1024 * 1024);
  ({ req, response } = rawPut(h, M.sha(big)));
  let answered = false;
  response.then(() => { answered = true; }, () => { answered = true; });
  let sent = 0;
  while (!answered && sent < big.length) {
    req.write(big.subarray(sent, sent + 16384));
    sent += 16384;
    await sleep(2);
  }
  r = await response;
  req.destroy();
  assert.equal(r.status, 413, 'the client gets the answer, not a reset');
  assert.equal(r.body.code, 'media-too-large');
  assert.ok(sent < big.length, `the answer came while the upload was still going (${sent} bytes sent)`);
  assert.deepEqual(h.files(U1), [`${M.sha(small)}.jpg`]);
  assert.deepEqual(h.tmp(U1), []);
});

test('the same file from two devices at once: one file, counted once', async t => {
  const h = await start(t);
  const bytes = M.jpeg(1024 * 1024);
  const rs = await Promise.all([h.put(bytes), h.put(bytes, { headers: bearer(U1) })]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 201]);
  assert.deepEqual(h.files(U1), [`${M.sha(bytes)}.jpg`]);
  const miss = await (await h.post('/api/media/missing', { hashes: [M.sha(bytes)] })).json();
  assert.deepEqual(miss.usage, { bytes: 1024 * 1024, count: 1, quotaBytes: 200 * 1048576 });
});

test('a cross-site browser upload is refused; a paired phone with its bearer token is not', async t => {
  const h = await start(t);
  const bytes = M.jpeg();
  let r = await h.put(bytes, { headers: { ...cookie(U1), 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(r.status, 403);
  r = await h.put(bytes, { headers: { Cookie: `gymsid=${mint(U1)}`, Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  assert.deepEqual(h.files(U1), []);

  // The Android WebView's origin; the token is what authenticates, the origin is reflected.
  const phone = { ...bearer(U1), Origin: 'https://localhost' };
  r = await h.put(bytes, { headers: phone });
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.equal(r.headers.get('access-control-allow-credentials'), null);
  const g = await h.get(M.sha(bytes), U1, phone);
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.ok(Buffer.from(await g.arrayBuffer()).equals(bytes));

  // The preflight a WebView sends before that PUT.
  const pre = await fetch(`${h.api}/api/media/${M.sha(bytes)}`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,authorization' }
  });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /\bPUT\b/);
  assert.match(pre.headers.get('access-control-allow-headers'), /Content-Type/);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://localhost');
});

test('the hourly budget answers 429 with Retry-After, and is recorded once', async t => {
  const h = await start(t, { MEDIA_UPLOADS_PER_HOUR: '2' });
  assert.equal((await h.put(M.jpeg())).status, 201);
  assert.equal((await h.put(M.jpeg())).status, 201);
  for (let i = 0; i < 3; i++) {
    const r = await h.put(M.jpeg());
    assert.equal(r.status, 429);
    const retry = +r.headers.get('retry-after');
    assert.ok(retry > 3000 && retry <= 3600, `retry-after ${retry}`);
    assert.deepEqual(await r.json(), { error: 'too many uploads, try again later', code: 'locked', retryAfter: retry });
  }
  assert.equal((await h.put(M.jpeg(), { uid: U2 })).status, 201, 'per profile, not per instance');
  const audit = fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(audit.filter(e => e.ev === 'media.throttled').length, 1);
});

test('a third upload while two are in flight is refused as busy', async t => {
  const h = await start(t);
  const a = rawPut(h, 'a'.repeat(64), { length: 1000000 });
  const b = rawPut(h, 'b'.repeat(64), { length: 1000000 });
  a.req.write(M.jpeg(100));
  b.req.write(M.jpeg(100));
  a.response.catch(() => {}); b.response.catch(() => {});
  await sleep(150);
  const r = await h.put(M.jpeg());
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '5');
  assert.deepEqual(await r.json(), { error: 'too many uploads at once, try again in a moment', code: 'busy', retryAfter: 5 });
  a.req.destroy(); b.req.destroy();
  await sleep(150);
  assert.equal((await h.put(M.jpeg())).status, 201, 'the slots come back when the two go away');
  assert.deepEqual(h.tmp(U1), []);
});

test('507 when the disk has less free than MEDIA_MIN_FREE_MB', async t => {
  const h = await start(t, { MEDIA_MIN_FREE_MB: String(1024 * 1024 * 1024) });
  const r = await h.put(M.jpeg());
  assert.equal(r.status, 507);
  assert.deepEqual(await r.json(), { error: 'the server is running out of disk space', code: 'storage-full' });
});

test('/missing answers from the caller\'s own folder and refuses what is not a list of hashes', async t => {
  const h = await start(t);
  const a = M.jpeg(), b = M.png();
  await h.put(a);
  const r = await (await h.post('/api/media/missing', { hashes: [M.sha(b), M.sha(a), M.sha(b)] })).json();
  assert.deepEqual(r, { missing: [M.sha(b)], usage: { bytes: 1000, count: 1, quotaBytes: 200 * 1048576 } });
  for (const body of [{}, { hashes: 'x' }, { hashes: ['A'.repeat(64)] }, { hashes: [1] }, { hashes: Array(1001).fill('a'.repeat(64)) }]) {
    const res = await h.post('/api/media/missing', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal((await res.json()).code, 'bad-request');
  }
});

test('a state push starts the grace of a dropped file, and /sweep removes it at once', async t => {
  const h = await start(t);
  const a = M.jpeg(), b = M.jpeg(2000);
  await h.put(a);
  await h.put(b);
  assert.equal((await h.pushState(refState(M.sha(a), M.sha(b)))).status, 200);
  const gc = () => JSON.parse(fs.readFileSync(path.join(h.uploads, U1, '.gc.json'), 'utf8'));
  assert.deepEqual(gc(), {}, 'both referenced: no marks');
  assert.equal((await h.pushState(refState(M.sha(a)))).status, 200);
  assert.deepEqual(Object.keys(gc()), [M.sha(b)]);

  const r = await h.post('/api/media/sweep', {});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { removed: 1, freedBytes: 2000, usage: { bytes: 1000, count: 1, quotaBytes: 200 * 1048576 } });
  assert.equal((await h.get(M.sha(b))).status, 404);
  assert.equal((await h.get(M.sha(a))).status, 200);
  const audit = fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8');
  assert.match(audit, /"ev":"media\.sweep"/);
});

test('/sweep with a state that does not parse removes nothing', async t => {
  const h = await start(t);
  const a = M.jpeg();
  await h.put(a, { uid: U2 });
  fs.writeFileSync(path.join(h.dataDir, `state-${U2}.json`), '{"customEx": [tor');
  const r = await h.post('/api/media/sweep', {}, U2);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).removed, 0);
  assert.deepEqual(h.files(U2), [`${M.sha(a)}.jpg`]);
  // And with no state file at all.
  fs.unlinkSync(path.join(h.dataDir, `state-${U2}.json`));
  assert.equal((await (await h.post('/api/media/sweep', {}, U2)).json()).removed, 0);
  assert.deepEqual(h.files(U2), [`${M.sha(a)}.jpg`]);
});

test('the sweep route has its own budget of 10 an hour', async t => {
  const h = await start(t);
  for (let i = 0; i < 10; i++) assert.equal((await h.post('/api/media/sweep', {})).status, 200);
  const r = await h.post('/api/media/sweep', {});
  assert.equal(r.status, 429);
  assert.equal((await r.json()).code, 'locked');
});

test('PUT /api/data still answers 200 when the media bookkeeping fails', async t => {
  const h = await start(t);
  const a = M.jpeg();
  await h.put(a);
  const gcPath = path.join(h.uploads, U1, '.gc.json');
  fs.rmSync(gcPath, { force: true });
  fs.mkdirSync(gcPath);                          // a write to it now throws
  const r = await h.pushState(refState());
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  // The line goes to stderr before the reply, but the test hears the two on separate pipes: on a
  // busy machine the reply can be read first.
  for (let i = 0; i < 100 && !/media noteState/.test(h.log); i++) await new Promise(res => setTimeout(res, 20));
  assert.match(h.log, /media noteState/);
  const saved = JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${U1}.json`), 'utf8'));
  assert.equal(saved._rev, 1, 'the state itself was saved');
});

test('folders are 0700 and files 0600, and an admin deleting the profile removes its folder', async t => {
  const h = await start(t);
  const a = M.jpeg();
  await h.put(a);
  await h.put(M.jpeg(), { uid: U2 });
  const mode = p => fs.statSync(p).mode & 0o777;
  assert.equal(mode(h.uploads), 0o700);
  assert.equal(mode(path.join(h.uploads, U1)), 0o700);
  assert.equal(mode(path.join(h.uploads, U1, '.tmp')), 0o700);
  assert.equal(mode(path.join(h.uploads, U1, `${M.sha(a)}.jpg`)), 0o600);
  assert.equal(mode(path.join(h.uploads, U1, '.gc.json')), 0o600);

  const del = await fetch(`${h.api}/api/admin/user/delete`, { method: 'POST', headers: { ...cookie(ADMIN), 'Content-Type': 'application/json' }, body: JSON.stringify({ id: U1 }) });
  assert.equal(del.status, 200);
  assert.equal(fs.existsSync(path.join(h.uploads, U1)), false);
  assert.equal(fs.existsSync(path.join(h.uploads, U2)), true, 'nobody else is touched');
});

test('/api/config carries the caps; MEDIA_UPLOADS=0 takes the block and every route away', async t => {
  const on = await start(t, { MEDIA_QUOTA_MB: '100', MEDIA_VIDEO_MAX_SEC: '30' });
  const cfg = await (await fetch(`${on.api}/api/config`)).json();
  assert.deepEqual(cfg.media, { imageMB: 2, gifMB: 8, videoMB: 40, videoSec: 30, quotaMB: 100, workouts: true });   // `workouts`: a logged workout may carry them too

  const off = await start(t, { MEDIA_UPLOADS: '0' });
  const cfgOff = await (await fetch(`${off.api}/api/config`)).json();
  assert.equal('media' in cfgOff, false);
  const bytes = M.jpeg();
  assert.equal((await off.put(bytes)).status, 404);
  assert.equal((await off.get(M.sha(bytes))).status, 404);
  assert.equal((await off.post('/api/media/missing', { hashes: [] })).status, 404);
  assert.equal((await off.post('/api/media/sweep', {})).status, 404);
  assert.equal(fs.existsSync(off.uploads), false);
});

test('boot removes the temp files of uploads the previous process was receiving', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-media-boot-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const tmp = path.join(dataDir, 'uploads', U1, '.tmp');
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'half-an-upload'), 'x');
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', DATA_DIR: dataDir } });
  t.after(() => child.kill('SIGKILL'));
  await boundPort(child);
  assert.deepEqual(fs.readdirSync(tmp), []);
});

test('a trickled body is cut after the body deadline on every route but a signed-in upload', async t => {
  const h = await start(t, { BODY_TIMEOUT_MS: '400' });
  // Headers and a tenth of the promised body, then nothing: resolves with how the socket ended.
  const trickle = (line, headers) => new Promise(resolve => {
    const s = net.connect(h.port, '127.0.0.1', () => {
      s.write(`${line} HTTP/1.1\r\nHost: 127.0.0.1\r\n${headers}Content-Length: 100\r\n\r\n` + '{"hashes":');
    });
    const timer = setTimeout(() => { s.destroy(); resolve('still open'); }, 3000);
    s.on('error', () => {});
    s.resume();   // read the early answer, or a paused socket never sees the server's FIN
    s.on('close', () => { clearTimeout(timer); resolve('closed'); });
  });
  const c = `Cookie: gymsid=${mint(U1)}\r\nOrigin: ${ORIGIN}\r\nContent-Type: application/json\r\n`;
  assert.equal(await trickle('POST /api/media/missing', c), 'closed', 'a JSON route reading its body');
  assert.equal(await trickle('POST /api/logout', 'Content-Type: application/json\r\n'), 'closed', 'a route reachable without a session');
  assert.equal(await trickle('PUT /api/media/' + 'd'.repeat(64), `Origin: ${ORIGIN}\r\nContent-Type: image/jpeg\r\n`), 'closed', 'an upload without a session');

  // Signed in and within its budget, an upload may take longer than that.
  const bytes = M.jpeg(20000);
  const { req, response } = rawPut(h, M.sha(bytes), { length: bytes.length });
  req.write(bytes.subarray(0, 5000));
  await sleep(900);
  req.end(bytes.subarray(5000));
  const r = await response;
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

test('server.js gives a slow upload half an hour, not node\'s default five minutes', () => {
  const src = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
  const m = /^server\.requestTimeout\s*=\s*([\d_\s*]+);/m.exec(src);
  assert.ok(m, 'server.requestTimeout is set');
  const ms = m[1].split('*').reduce((a, x) => a * Number(x.replace(/[_\s]/g, '')), 1);
  assert.ok(ms >= 30 * 60000, `requestTimeout is ${ms} ms`);
  const hm = /^server\.headersTimeout\s*=\s*([\d_\s*]+);/m.exec(src);
  assert.ok(!hm || hm[1].split('*').reduce((a, x) => a * Number(x.replace(/[_\s]/g, '')), 1) <= 60000, 'headers still have to arrive within a minute');
});
