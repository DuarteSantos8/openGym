// openGym on Cloudflare: the static app from assets, the unchanged api inside one Durable Object.
// The api keeps its data as files; the object loads them from D1 into its in-memory /tmp at start
// and writes back whatever changed after every request. One object means one process, as the api
// expects (its caches, sign-in throttles and sync revisions all assume a single server).
import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import fs from 'node:fs';
import path from 'node:path';
import timers from 'node:timers';

const DATA = '/tmp/data';
const PORT = 8080;

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
    this.saved = new Map();
    ctx.blockConcurrencyWhile(async () => {
      fs.mkdirSync(DATA, { recursive: true });
      const { results } = await env.DB.prepare('SELECT path, body FROM files').all();
      for (const r of results) {
        const file = path.join(DATA, r.path);
        const body = Buffer.from(r.body);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
        this.saved.set(r.path, body);
      }
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
    await this.flush();
    return res;
  }

  // ponytail: rewrites only what changed, compared in memory; per-file rows cap at D1's 2 MB,
  // which is why media uploads stay off (R2 when they are wanted).
  async flush() {
    const now = new Map();
    for (const f of walk(DATA)) now.set(path.relative(DATA, f), fs.readFileSync(f));
    const ops = [];
    for (const [k, v] of now) {
      const old = this.saved.get(k);
      if (!old || !old.equals(v)) ops.push(this.env.DB.prepare('INSERT OR REPLACE INTO files (path, body) VALUES (?, ?)').bind(k, v));
    }
    for (const k of this.saved.keys()) if (!now.has(k)) ops.push(this.env.DB.prepare('DELETE FROM files WHERE path = ?').bind(k));
    if (ops.length) await this.env.DB.batch(ops);
    this.saved = now;
  }
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return env.API.get(env.API.idFromName('main')).fetch(request);
    return env.ASSETS.fetch(request);
  }
};
