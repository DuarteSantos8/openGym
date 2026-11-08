// openGym on Cloudflare: the static app from assets, the unchanged api inside one Durable Object.
// The api keeps its data as files; the object loads them into its in-memory /tmp at start (D1 for
// the small JSON files, R2 for uploads/) and writes back whatever changed after every request. One object means one process, as the api
// expects (its caches, sign-in throttles and sync revisions all assume a single server).
import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import fs from 'node:fs';
import path from 'node:path';
import timers from 'node:timers';

const DATA = '/tmp/data';
const PORT = 8080;

const isUpload = rel => rel.startsWith('uploads/');
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
        const st = fs.statSync(file);
        this.seen.set(rel, `${st.size}:${st.mtimeMs}`);
      };
      const { results } = await env.DB.prepare('SELECT path, body FROM files').all();
      for (const r of results) put(r.path, Buffer.from(r.body));
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
      await import('../api/server.js');
      this.handler = httpServerHandler({ port: PORT });
    });
  }

  async fetch(request) {
    const res = await this.handler.fetch(request, this.env, this.ctx);
    this.queue = this.queue.then(() => this.flush());
    await this.queue;
    return res;
  }

  // Writes back what changed since the last flush, found by size and mtime so an unchanged
  // upload is not read again.
  async flush() {
    const now = new Map();
    const ops = [];
    for (const f of walk(DATA)) {
      const rel = path.relative(DATA, f);
      if (skip(rel)) continue;
      const st = fs.statSync(f);
      const stamp = `${st.size}:${st.mtimeMs}`;
      now.set(rel, stamp);
      if (this.seen.get(rel) === stamp) continue;
      const body = fs.readFileSync(f);
      ops.push(isUpload(rel)
        ? this.env.MEDIA.put(rel, body)
        : this.env.DB.prepare('INSERT OR REPLACE INTO files (path, body) VALUES (?, ?)').bind(rel, body).run());
    }
    for (const rel of this.seen.keys()) {
      if (now.has(rel)) continue;
      ops.push(isUpload(rel) ? this.env.MEDIA.delete(rel) : this.env.DB.prepare('DELETE FROM files WHERE path = ?').bind(rel).run());
    }
    await Promise.all(ops);
    this.seen = now;
  }
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return env.API.get(env.API.idFromName('main')).fetch(request);
    return env.ASSETS.fetch(request);
  }
};
