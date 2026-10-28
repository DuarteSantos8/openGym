/* Import a routine from a YouTube follow-along video — the API's half.
 *
 * The work itself (download, frames, OCR) runs in the optional video-import worker container
 * (video-import/ in this repository), which this module only talks to. Here is what stays on
 * the API side, because it is about people rather than pixels:
 *
 *   - who may start an import (signed in, feature on) and whose job is whose;
 *   - the boxes a profile drew around a channel's captions, kept per profile per channel in
 *     DATA_DIR/video-import/<uid>.json, so the next video from the same creator needs no setup.
 *     The worker keeps nothing; it can be rebuilt or thrown away without anyone losing a box.
 *
 * Off unless VIDEO_IMPORT_URL is set (or with VIDEO_IMPORT=0): no routes answer anything but 404 and /api/config says
 * nothing, so an instance without the worker is the app it was before this file existed.
 *
 * Matching the names the worker read to exercises happens in the app, not here: the catalogue
 * and the profile's own exercises live there (frontend/src/lib/import-video.js).
 */
import fs from 'node:fs';
import path from 'node:path';

// On whenever the worker is configured, unless VIDEO_IMPORT says otherwise (0, false, no, off): an
// instance that has the worker running but does not want the feature switches it off here, with
// no routes and nothing in /api/config, exactly as if the worker were not there.
const ENABLED = !/^(0|false|no|off)$/i.test(process.env.VIDEO_IMPORT || '');
export const VIDEO_IMPORT_URL = ENABLED ? (process.env.VIDEO_IMPORT_URL || '').replace(/\/+$/, '') : '';
const TOKEN = process.env.VIDEO_IMPORT_TOKEN || '';
const WORKER_TIMEOUT_MS = 15000;
const MAX_CHANNELS = 200;

// The same rule as the worker's (video-import/src/url.js): only the 11-character id survives,
// so nothing the caller typed reaches the worker beyond it.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
export function canonicalYouTube(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;
  let id = null;
  if (host.endsWith('youtu.be')) id = u.pathname.split('/')[1];
  else if (u.pathname === '/watch') id = u.searchParams.get('v');
  else {
    const m = /^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(u.pathname);
    if (m) id = m[1];
  }
  if (!id || !ID_RE.test(id)) return null;
  return { id, url: 'https://www.youtube.com/watch?v=' + id };
}

/** A box as fractions of the frame, clamped; null when it is not one. */
export function cleanBox(b) {
  if (!b || typeof b !== 'object') return null;
  let [x, y, w, h] = ['x', 'y', 'w', 'h'].map(k => Number(b[k]));
  if (![x, y, w, h].every(Number.isFinite)) return null;
  x = Math.min(Math.max(x, 0), 1); y = Math.min(Math.max(y, 0), 1);
  w = Math.min(Math.max(w, 0), 1 - x); h = Math.min(Math.max(h, 0), 1 - y);
  if (w < 0.02 || h < 0.02) return null;
  const r = v => Math.round(v * 1000) / 1000;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

/** One name box or several (a video that shows its names in more than one place), up to three. */
export function cleanNames(v) {
  if (Array.isArray(v)) {
    const boxes = v.map(cleanBox).filter(Boolean).slice(0, 3);
    return boxes.length ? (boxes.length === 1 ? boxes[0] : boxes) : null;
  }
  return cleanBox(v);
}

/** One timer box or up to three (the work and the rest counted in different places). */
export function cleanTimers(v) {
  if (Array.isArray(v)) {
    const boxes = v.map(cleanBox).filter(Boolean).slice(0, 3);
    return boxes.length ? (boxes.length === 1 ? boxes[0] : boxes) : null;
  }
  return cleanBox(v);
}

const JOB_RE = /^[0-9a-f]{24}$/;
const CHANNEL_RE = /^[A-Za-z0-9_@.-]{1,80}$/;

// How many imports a profile may start in a day (VIDEO_IMPORT_PER_DAY, 0 = no cap). One import
// keeps a core busy for minutes and the queue is short, so on an instance with open signup one
// profile could otherwise keep everyone else waiting.
const RAW_PER_DAY = process.env.VIDEO_IMPORT_PER_DAY;
const PER_DAY = RAW_PER_DAY === undefined || RAW_PER_DAY === '' || !Number.isFinite(+RAW_PER_DAY) ? 12 : Math.max(0, Math.floor(+RAW_PER_DAY));
const DAY_MS = 24 * 60 * 60 * 1000;

export function videoImportRoutes({ json, readBody, readSession, dataDir, atomicWrite, fetchImpl = globalThis.fetch, workerUrl = VIDEO_IMPORT_URL, perDay = PER_DAY }) {
  // When each profile's accepted imports started, for the last day. Kept in memory: a restart
  // forgets it, which only ever errs towards letting someone start one more.
  const started = new Map();
  const startedToday = uid => {
    const since = Date.now() - DAY_MS;
    const list = (started.get(uid) || []).filter(t => t > since);
    if (list.length) started.set(uid, list); else started.delete(uid);
    return list;
  };
  const dir = path.join(dataDir, 'video-import');
  const safe = uid => String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
  const fileOf = uid => path.join(dir, safe(uid) + '.json');

  function readRois(uid) {
    try {
      const j = JSON.parse(fs.readFileSync(fileOf(uid), 'utf8'));
      return j && typeof j.rois === 'object' && j.rois ? j.rois : {};
    } catch { return {}; }
  }
  function saveRoi(uid, channelId, roi) {
    if (!CHANNEL_RE.test(channelId || '')) return;
    const rois = readRois(uid);
    rois[channelId] = { ...roi, updated: new Date().toISOString() };
    // A profile that imports from hundreds of channels keeps the most recent ones.
    const keep = Object.entries(rois).sort((a, b) => String(b[1].updated).localeCompare(String(a[1].updated))).slice(0, MAX_CHANNELS);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicWrite(fileOf(uid), JSON.stringify({ rois: Object.fromEntries(keep) }), 0o600);
  }

  async function worker(method, p, body) {
    let r;
    try {
      r = await fetchImpl(workerUrl + p, {
        method,
        headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS)
      });
    } catch {
      return { status: 503, body: { error: 'the video importer is not reachable', code: 'worker-down' } };
    }
    let data = null;
    try { data = await r.json(); } catch { /* not JSON */ }
    if (!data || typeof data !== 'object') return { status: 502, body: { error: 'the video importer answered with something unexpected', code: 'worker-bad' } };
    return { status: r.status, body: data };
  }

  /** The job, if it exists and is the caller's; otherwise answers and returns null. */
  async function ownJob(res, user, id) {
    if (!JOB_RE.test(String(id || ''))) { json(res, 400, { error: 'bad job id' }); return null; }
    const w = await worker('GET', '/jobs/' + id);
    // Someone else's job reads exactly like a job that does not exist.
    if (w.status === 404 || (w.status === 200 && w.body.owner !== user.id)) { json(res, 404, { error: 'no such import', code: 'not-found' }); return null; }
    if (w.status !== 200) { json(res, w.status, w.body); return null; }
    return w.body;
  }
  const publicJob = job => { const { owner, ...rest } = job; return rest; };

  const guard = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    return user;
  };

  if (!workerUrl) return {};
  return {
    // { url, redraw?: true } → 202 job. The video is always read (an old `mode` is ignored). `redraw` (mark the boxes myself) ignores the boxes saved
    // for this channel, for when they turned out wrong.
    'POST /api/video-import': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const b = await readBody(req);
      const yt = canonicalYouTube(b.url);
      if (!yt) return json(res, 400, { error: 'not a YouTube video link', code: 'bad-url' });
      if (perDay && startedToday(user.id).length >= perDay) {
        return json(res, 429, { error: 'the daily limit of video imports for this profile is used up', code: 'daily-limit' });
      }
      const w = await worker('POST', '/jobs', {
        url: yt.url, owner: user.id,
        rois: b.redraw === true ? {} : readRois(user.id),
        // "Mark them myself": the worker asks for the boxes even if it can find them.
        manual: b.redraw === true
      });
      if (w.status < 300) started.set(user.id, [...startedToday(user.id), Date.now()]);
      json(res, w.status, w.status < 300 ? publicJob(w.body) : w.body);
    },

    // ?id=<job> → the job: stage and progress while it runs, the stills to draw on when it waits
    // for boxes, the draft when it is done.
    'GET /api/video-import/job': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      const job = await ownJob(res, user, id); if (!job) return;
      json(res, 200, publicJob(job));
    },

    // { id, name: box | [box…], timer?: box, remember?: boolean } — the boxes for a job that is
    // waiting; several name boxes when the names appear in more than one place.
    // Remembered for the video's channel unless `remember` is false.
    'POST /api/video-import/roi': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const b = await readBody(req);
      const name = cleanNames(b.name);
      const timer = b.timer == null ? null : cleanTimers(b.timer);
      if (!name) return json(res, 400, { error: 'draw a box around the exercise name', code: 'bad-roi' });
      const job = await ownJob(res, user, b.id); if (!job) return;
      const w = await worker('POST', '/jobs/' + b.id + '/roi', { name, timer });
      if (w.status === 200 && b.remember !== false && job.source?.channelId) saveRoi(user.id, job.source.channelId, { name, timer });
      json(res, w.status, w.status === 200 ? publicJob(w.body) : w.body);
    },

    // { id } — stop a running import; its files go with it.
    'POST /api/video-import/cancel': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const b = await readBody(req);
      const job = await ownJob(res, user, b.id); if (!job) return;
      const w = await worker('DELETE', '/jobs/' + b.id);
      json(res, w.status, w.status === 200 ? publicJob(w.body) : w.body);
    }
  };
}
