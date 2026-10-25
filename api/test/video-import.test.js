/* The API's half of the video import: who may start one, whose job is whose, and the boxes
   remembered per channel. The worker is faked — a fetch that answers like it — so these run
   without ffmpeg, Tesseract or a network. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { videoImportRoutes, canonicalYouTube, cleanBox } from '../video-import.js';
import { canonicalYouTube as workerCanonical } from '../../video-import/src/url.js';

const JOB = 'a'.repeat(24);
const OTHER = 'b'.repeat(24);

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function harness({ user = { id: 'u1' }, jobs = {}, perDay } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-vi-'));
  dirs.push(dataDir);
  const calls = [];
  const state = { user };
  const fetchImpl = async (url, init) => {
    const p = url.replace('http://worker:3100', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, p, body, auth: init.headers.Authorization });
    const reply = (status, data) => ({ status, json: async () => data });
    if (init.method === 'POST' && p === '/jobs') return reply(202, { id: JOB, owner: body.owner, status: 'queued', stage: 'queued', pct: 0 });
    const m = /^\/jobs\/([0-9a-f]{24})(\/roi)?$/.exec(p);
    if (m) {
      const job = jobs[m[1]];
      if (!job) return reply(404, { error: 'no such job', code: 'not-found' });
      if (m[2]) return reply(200, { ...job, status: 'running' });
      if (init.method === 'DELETE') return reply(200, { ...job, status: 'cancelled' });
      return reply(200, job);
    }
    return reply(404, { error: 'not found' });
  };
  const routes = videoImportRoutes({
    dataDir, fetchImpl, workerUrl: 'http://worker:3100', perDay,
    json: (res, code, obj) => { res.code = code; res.body = obj; },
    readBody: async req => req.body || {},
    readSession: () => state.user,
    atomicWrite: (file, content) => fs.writeFileSync(file, content)
  });
  const call = async (key, { body, url = '/api/x' } = {}) => {
    const res = {};
    await routes[key]({ body, url }, res);
    return res;
  };
  return { routes, call, calls, dataDir, state };
}

test('no worker configured: no routes at all', () => {
  const routes = videoImportRoutes({ dataDir: os.tmpdir(), json() {}, readBody() {}, readSession() {}, atomicWrite() {}, workerUrl: '' });
  assert.deepEqual(routes, {});
});

test('starting an import sends only the canonical URL, the owner and the saved boxes', async () => {
  const h = harness();
  const bad = await h.call('POST /api/video-import', { body: { url: 'https://example.com/v' } });
  assert.equal(bad.code, 400);
  assert.equal(h.calls.length, 0, 'a bad link never reaches the worker');
  const ok = await h.call('POST /api/video-import', { body: { url: 'https://youtu.be/dQw4w9WgXcQ?t=30&list=x', mode: 'video', owner: 'someone-else' } });
  assert.equal(ok.code, 202);
  assert.equal(ok.body.owner, undefined, 'the owner field stays between API and worker');
  assert.deepEqual(h.calls[0].body, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', owner: 'u1', rois: {}, manual: false }, 'the old mode is not passed on: a video is always read');
});

test('signed out is refused', async () => {
  const h = harness({ user: null });
  for (const key of Object.keys(h.routes)) assert.equal((await h.call(key, { body: {} })).code, 401, key);
});

test("another profile's job reads as no job", async () => {
  const h = harness({ jobs: { [JOB]: { id: JOB, owner: 'u1', status: 'running' }, [OTHER]: { id: OTHER, owner: 'u2', status: 'needs_roi', source: { channelId: 'UC2' } } } });
  const mine = await h.call('GET /api/video-import/job', { url: `/api/video-import/job?id=${JOB}` });
  assert.equal(mine.code, 200); assert.equal(mine.body.status, 'running'); assert.equal(mine.body.owner, undefined);
  const theirs = await h.call('GET /api/video-import/job', { url: `/api/video-import/job?id=${OTHER}` });
  assert.equal(theirs.code, 404);
  assert.equal((await h.call('POST /api/video-import/roi', { body: { id: OTHER, name: { x: 0, y: 0.8, w: 0.5, h: 0.1 } } })).code, 404);
  assert.equal((await h.call('POST /api/video-import/cancel', { body: { id: OTHER } })).code, 404);
  assert.ok(!h.calls.some(c => c.p === `/jobs/${OTHER}/roi` || c.method === 'DELETE'), 'nothing was forwarded for it');
  assert.equal((await h.call('GET /api/video-import/job', { url: '/api/video-import/job?id=../../x' })).code, 400);
});

test('boxes are cleaned, forwarded and remembered for the channel', async () => {
  const h = harness({ jobs: { [JOB]: { id: JOB, owner: 'u1', status: 'needs_roi', source: { channelId: 'UCfit_1' } } } });
  const none = await h.call('POST /api/video-import/roi', { body: { id: JOB, name: { x: 0, y: 0, w: 0, h: 0 } } });
  assert.equal(none.code, 400)
  const res = await h.call('POST /api/video-import/roi', { body: { id: JOB, name: { x: -1, y: 0.8, w: 0.5, h: 0.1 }, timer: { x: 0.8, y: 0, w: 0.15, h: 0.1 } } });
  assert.equal(res.code, 200);
  const sent = h.calls.find(c => c.p === `/jobs/${JOB}/roi`).body;
  assert.deepEqual(sent.name, { x: 0, y: 0.8, w: 0.5, h: 0.1 });
  const saved = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'video-import', 'u1.json'), 'utf8'));
  assert.deepEqual(saved.rois.UCfit_1.name, { x: 0, y: 0.8, w: 0.5, h: 0.1 });
  // …and the next import of that profile carries them, unless it asks to redraw.
  await h.call('POST /api/video-import', { body: { url: 'https://youtu.be/dQw4w9WgXcQ' } });
  assert.deepEqual(Object.keys(h.calls.at(-1).body.rois), ['UCfit_1']);
  await h.call('POST /api/video-import', { body: { url: 'https://youtu.be/dQw4w9WgXcQ', redraw: true } });
  assert.deepEqual(h.calls.at(-1).body.rois, {});
  assert.equal(h.calls.at(-1).body.manual, true, 'the worker is told to ask, not to look by itself');
  await h.call('POST /api/video-import', { body: { url: 'https://youtu.be/dQw4w9WgXcQ' } });
  assert.equal(h.calls.at(-1).body.manual, false);
});

test('remember: false forwards the boxes without saving them', async () => {
  const h = harness({ jobs: { [JOB]: { id: JOB, owner: 'u1', status: 'needs_roi', source: { channelId: 'UC3' } } } });
  await h.call('POST /api/video-import/roi', { body: { id: JOB, name: { x: 0, y: 0.8, w: 0.5, h: 0.1 }, remember: false } });
  assert.equal(fs.existsSync(path.join(h.dataDir, 'video-import', 'u1.json')), false);
});

test('a worker that is down is a 503 with a code, not a crash', async () => {
  const routes = videoImportRoutes({
    dataDir: os.tmpdir(), workerUrl: 'http://worker:3100',
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
    json: (res, code, obj) => { res.code = code; res.body = obj; },
    readBody: async req => req.body, readSession: () => ({ id: 'u1' }), atomicWrite() {}
  });
  const res = {};
  await routes['POST /api/video-import']({ body: { url: 'https://youtu.be/dQw4w9WgXcQ' } }, res);
  assert.equal(res.code, 503); assert.equal(res.body.code, 'worker-down');
});

test('the API and the worker accept and refuse the same links', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://vimeo.com/1', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=dQw4w9WgXc', '']) {
    assert.deepEqual(canonicalYouTube(u), workerCanonical(u), u);
  }
  assert.equal(cleanBox({ x: 0.5, y: 0.5, w: 0.01, h: 0.5 }), null);
});

test('several name boxes are kept, cleaned, up to three', async () => {
  const { cleanNames } = await import('../video-import.js');
  const b = { x: 0.1, y: 0.8, w: 0.5, h: 0.1 };
  assert.deepEqual(cleanNames([b, { x: 0.6, y: 0.9, w: 0.3, h: 0.05 }, { x: 0, y: 0, w: 0, h: 0 }]), [b, { x: 0.6, y: 0.9, w: 0.3, h: 0.05 }]);
  assert.deepEqual(cleanNames([b]), b);
  assert.equal(cleanNames([]), null);
  assert.equal(cleanNames([b, b, b, b, b]).length, 3);
});

test('a profile can start only so many imports a day, and only the ones the worker accepted count', async () => {
  const { routes, calls } = harness({ perDay: 3 });
  const post = async () => { const res = {}; await routes['POST /api/video-import']({ body: { url: 'https://youtu.be/dQw4w9WgXcQ' } }, res); return res; };
  for (let i = 0; i < 3; i++) assert.equal((await post()).code, 202, 'within the budget');
  const asked = calls.length;
  const over = await post();
  assert.equal(over.code, 429);
  assert.equal(over.body.code, 'daily-limit');
  assert.equal(calls.length, asked, 'the worker is not asked once the budget is spent');
});

test('a different profile has a budget of its own', async () => {
  const h = harness({ perDay: 1, user: { id: 'u1' } });
  const post = async () => { const res = {}; await h.routes['POST /api/video-import']({ body: { url: 'https://youtu.be/dQw4w9WgXcQ' } }, res); return res.code; };
  assert.equal(await post(), 202);
  assert.equal(await post(), 429);
  h.state.user = { id: 'u2' };
  assert.equal(await post(), 202, 'the second profile starts afresh');
});

test('a bad link or a start the worker refused does not spend the daily budget', async () => {
  const { routes } = harness({ perDay: 1 });
  for (let i = 0; i < 5; i++) {
    const res = {};
    await routes['POST /api/video-import']({ body: { url: 'https://example.com/x' } }, res);
    assert.equal(res.code, 400);
  }
  const ok = {};
  await routes['POST /api/video-import']({ body: { url: 'https://youtu.be/dQw4w9WgXcQ' } }, ok);
  assert.equal(ok.code, 202);
});

// The module reads its switches once, when it loads: each case loads a copy of its own.
async function loadWith(env) {
  const keep = { VIDEO_IMPORT: process.env.VIDEO_IMPORT, VIDEO_IMPORT_URL: process.env.VIDEO_IMPORT_URL };
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await import('../video-import.js?switch=' + Math.random()); }
  finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('VIDEO_IMPORT=0 turns the feature off even where the worker is configured', async () => {
  const url = 'http://worker:3100';
  assert.equal((await loadWith({ VIDEO_IMPORT_URL: url, VIDEO_IMPORT: undefined })).VIDEO_IMPORT_URL, url, 'on by default once the worker is set');
  assert.equal((await loadWith({ VIDEO_IMPORT_URL: url, VIDEO_IMPORT: '1' })).VIDEO_IMPORT_URL, url);
  for (const off of ['0', 'false', 'No', 'OFF']) assert.equal((await loadWith({ VIDEO_IMPORT_URL: url, VIDEO_IMPORT: off })).VIDEO_IMPORT_URL, '', off);
  // Off means no routes at all: nothing answers, /api/config says nothing (it hangs off the same URL).
  const off = await loadWith({ VIDEO_IMPORT_URL: url, VIDEO_IMPORT: '0' });
  assert.deepEqual(Object.keys(off.videoImportRoutes({ json() {}, readBody() {}, readSession() {}, dataDir: os.tmpdir(), atomicWrite() {} })), []);
  assert.equal((await loadWith({ VIDEO_IMPORT_URL: '', VIDEO_IMPORT: '1' })).VIDEO_IMPORT_URL, '', '1 does not make a worker appear');
});
