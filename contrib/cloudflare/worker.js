// openGym on Cloudflare: the static app from assets, the unchanged api inside one Durable Object.
// The api keeps its data as files; the object loads them into its in-memory /tmp at start (D1 for
// the small JSON files, R2 for uploads/) and writes back whatever changed after every request. One object means one process, as the api
// expects (its caches, sign-in throttles and sync revisions all assume a single server).
import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import fs from 'node:fs';
import path from 'node:path';
import timers from 'node:timers';
import crypto from 'node:crypto';
import { handleFood } from './food-proxy.js';
import { makeGarmin } from './garmin.js';
import { makeCycle } from './cycle.js';
import { backup } from './backup.js';

const DATA = '/tmp/data';
const PORT = 8080;

const isUpload = rel => rel.startsWith('uploads/');
// A D1 value holds at most 2 MB, so a file over PART is kept as rows "<path>#part0", "#part1", ...
// and put back together on load. A profile grows past that after a few years of food logging.
const PART = 1_000_000;
const SEP = '#part';
const sha = buf => crypto.createHash('sha1').update(buf).digest('hex');
// An upload still arriving (.tmp/) is not a file yet.
const skip = rel => rel.includes('/.tmp/') || rel.endsWith('.tmp');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}

export class Api extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.seen = new Map();   // path -> "size:mtime" as last written to D1 / R2
    this.queue = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => {
      fs.mkdirSync(DATA, { recursive: true });
      const put = (rel, body) => {
        const file = path.join(DATA, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
        this.seen.set(rel, this.stamp(rel, file, body));
      };
      const { results } = await env.DB.prepare('SELECT path, body FROM files ORDER BY path').all();
      const parts = new Map();
      for (const r of results) {
        const at = r.path.lastIndexOf(SEP);
        if (at < 0) { put(r.path, Buffer.from(r.body)); continue; }
        const rel = r.path.slice(0, at);
        if (!parts.has(rel)) parts.set(rel, []);
        parts.get(rel)[Number(r.path.slice(at + SEP.length))] = Buffer.from(r.body);
      }
      for (const [rel, list] of parts) put(rel, Buffer.concat(list));
      // ponytail: every upload is held in memory (128 MB per object), hence the MEDIA_* caps in
      // wrangler.toml; load on demand if a profile ever needs more.
      let cursor;
      do {
        const page = await env.MEDIA.list({ prefix: 'uploads/', cursor });
        await Promise.all(page.objects.map(async o => put(o.key, Buffer.from(await (await env.MEDIA.get(o.key)).arrayBuffer()))));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      for (const [k, v] of Object.entries(env)) if (typeof v === 'string') process.env[k] = v;
      Object.assign(process.env, { DATA_DIR: DATA, PORT: String(PORT), ADMIN_SOCKET_DIR: '/tmp/sock' });
      // The api calls .unref() on its timers; the Workers globals return plain numbers.
      Object.assign(globalThis, { setInterval: timers.setInterval, setTimeout: timers.setTimeout, clearInterval: timers.clearInterval, clearTimeout: timers.clearTimeout });
      // A failed outbound call says only "fetch failed" to the coach card; the cause goes to the log
      // (wrangler tail, or Workers Logs in the dashboard).
      const platformFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        try { return await platformFetch(input, init); }
        catch (e) {
          console.error('outbound fetch failed:', String(input?.url || input).slice(0, 120), e?.name, e?.message, e?.cause ? String(e.cause) : '');
          throw e;
        }
      };
      await import('../../api/server.js');
      this.handler = httpServerHandler({ port: PORT });
      this.garmin = makeGarmin({ dataDir: DATA });
      this.cycle = makeCycle({ dataDir: DATA });
    });
  }

  // What a file was when last written: a hash of the small JSON files (a sync that changes one
  // digit keeps the size, and the in-memory file system's mtime is not to be trusted with it),
  // size and mtime for uploads so an unchanged photo is not read again.
  stamp(rel, file, body) {
    if (!isUpload(rel)) return sha(body || fs.readFileSync(file));
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  }

  async fetch(request) {
    // The cron below wakes the object so the api's reminder tick (every 10 s) runs with every app
    // closed: stay up past one tick, then the flush writes what it sent (db.json) to D1.
    const { pathname } = new URL(request.url);
    const res = pathname === '/__wake'
      ? (await Promise.all([new Promise(r => setTimeout(() => r(new Response(null, { status: 204 })), 11000)), this.garmin.tick(), this.cycle.tick()]))[0]
      : pathname === '/api/garmin' || pathname.startsWith('/api/garmin/')
        ? await this.garminRoute(request, this.garmin)
        : pathname === '/api/cycle' || pathname.startsWith('/api/cycle/')
          ? await this.garminRoute(request, this.cycle)
        : await this.handler.fetch(request, this.env, this.ctx);
    // The answer goes out only once D1 has the change. A failed write is tried once more; if that
    // fails too a change is answered 503, so the app keeps it and sends it again (its 409 merge
    // makes the second try safe), instead of a 200 for data that lives only in memory.
    const run = () => (this.queue = this.queue.catch(() => {}).then(() => this.flush()));
    try { await run(); }
    catch (e) {
      console.error('flush failed:', e?.message);
      await new Promise(r => setTimeout(r, 300));
      try { await run(); }
      catch (e2) {
        console.error('flush failed again:', e2?.message);
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return new Response(JSON.stringify({ error: 'storage unavailable, try again' }), { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '2' } });
        }
      }
    }
    return res;
  }

  // /api/garmin* and /api/cycle* (garmin.js, cycle.js): the api says who is signed in, with the same cookie or bearer token.
  // OPTIONS goes to the api, which answers every preflight the same way.
  async garminRoute(request, svc) {
    if (request.method === 'OPTIONS') return this.handler.fetch(request, this.env, this.ctx);
    const h = request.headers;
    const pass = new Headers();
    for (const k of ['cookie', 'authorization', 'origin', 'cf-connecting-ip', 'x-forwarded-for']) if (h.get(k)) pass.set(k, h.get(k));
    const me = await this.handler.fetch(new Request(new URL('/api/me', request.url), { headers: pass }), this.env, this.ctx);
    if (me.status !== 200) return me;
    const { user } = await me.json();
    // The api's own CSRF rule (server.js csrfOk), short: a write needs a same-origin browser, a
    // bearer token without a cookie, or no browser at all.
    const site = h.get('sec-fetch-site'), origin = h.get('origin');
    const bearer = /^Bearer /.test(h.get('authorization') || '') && !h.get('cookie');
    if (request.method !== 'GET' && !bearer && (site ? site !== 'same-origin' && site !== 'none' : origin && origin !== this.env.ORIGIN)) {
      return new Response(JSON.stringify({ error: 'cross-origin request refused' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    const res = await svc.handle(request, user.id);
    if (origin) { res.headers.set('Access-Control-Allow-Origin', origin); res.headers.set('Vary', 'Origin'); }
    return res;
  }

  // Writes back what changed since the last flush. The D1 rows go in one batch (one transaction),
  // so db.json and a profile never land half written. `seen` only moves on once it all landed:
  // after a failure the next request writes the same files again.
  async flush() {
    const now = new Map();
    const sql = [], r2 = [];
    const db = this.env.DB;
    const clear = rel => db.prepare('DELETE FROM files WHERE path = ? OR substr(path, 1, ?) = ?').bind(rel, rel.length + SEP.length, rel + SEP);
    for (const f of walk(DATA)) {
      const rel = path.relative(DATA, f);
      if (skip(rel)) continue;
      const body = isUpload(rel) ? null : fs.readFileSync(f);
      const stamp = this.stamp(rel, f, body);
      now.set(rel, stamp);
      if (this.seen.get(rel) === stamp) continue;
      if (isUpload(rel)) { r2.push(() => this.env.MEDIA.put(rel, fs.readFileSync(f))); continue; }
      sql.push(clear(rel));
      if (body.length <= PART) sql.push(db.prepare('INSERT INTO files (path, body) VALUES (?, ?)').bind(rel, body));
      else for (let i = 0; i * PART < body.length; i++) {
        sql.push(db.prepare('INSERT INTO files (path, body) VALUES (?, ?)').bind(rel + SEP + i, body.subarray(i * PART, (i + 1) * PART)));
      }
    }
    for (const rel of this.seen.keys()) {
      if (now.has(rel)) continue;
      if (isUpload(rel)) r2.push(() => this.env.MEDIA.delete(rel)); else sql.push(clear(rel));
    }
    if (sql.length) await db.batch(sql);
    await Promise.all(r2.map(op => op()));
    this.seen = now;
  }
}

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // The food lookups need no profile, so they stay out of the object (food-proxy.js).
    if (pathname.startsWith('/api/food/')) return handleFood(request, ctx);
    if (pathname.startsWith('/api/')) return env.API.get(env.API.idFromName('main')).fetch(request);
    return env.ASSETS.fetch(request);
  },
  // wrangler.toml [triggers]: meal and workout reminders while no device is open. Not reachable
  // from outside: only /api/* goes to the object.
  scheduled(event, env, ctx) {
    ctx.waitUntil(env.API.get(env.API.idFromName('main')).fetch('https://wake/__wake'));
    // Once a day, the 03:00 UTC run: a copy of D1 in R2 (backup.js).
    const when = new Date(event.scheduledTime);
    if (when.getUTCHours() === 3 && when.getUTCMinutes() < 5) ctx.waitUntil(backup(env, when).catch(e => console.error('backup failed:', e?.message)));
  }
};
