/* NutriTrace (github.com/TraceApps/nutritrace, AGPL-3.0): reads the user's own food library so the
 * Extension Lab's food diary can log from it. Read only: nothing is sent to NutriTrace but the
 * search text, and nothing is written there.
 *
 * Federation API v1 (traceapps.github.io/docs/nutritrace/federation-api/, checked 2026-11-13):
 *   Authorization: Bearer nt_pat_…   (made in NutriTrace → Settings → API Tokens)
 *   GET /api/v1/me      { user, instance, scopes }            no scope needed
 *   GET /api/v1/foods   { items, total, limit, offset }       scope read:foods; ?q= &limit=
 * A food's `nutrition` is NutriTrace's stored blob of nutrient ids, "values are numbers per
 * `portion`" of `unit` (its source: server/routes/api/v1/foods.js `_toWire`, docs/federation.md,
 * @888c966). The ids are `calories` (kcal), `proteins`, `carbohydrates`, `fat` (g). The published
 * docs page names them kcal, protein_g, carbs_g, fat_g, which the server never uses; those are
 * read only when the real ids are absent. `portion` defaults to 100 and `unit` to g, as there.
 *
 * The token and the address are sealed per profile by the hub (store.js), like a webhook's secret.
 * Requests go through net-guard (https only, no private addresses unless INTEGRATIONS_ALLOW_LAN),
 * do not follow redirects, give up after TIMEOUT_MS and read at most READ_MAX bytes. */
import http from 'node:http';
import https from 'node:https';
import { outboundLookup, outboundUrlError } from '../../net-guard.js';

export const TIMEOUT_MS = 8000;
export const READ_MAX = 512 * 1024;
export const SEARCH_LIMIT = 25;
export const QUERY_MAX = 80;
// The documented form is nt_pat_ plus 43 characters; a little room either side in case it changes.
// Failures that can clear up without the user doing anything (judgeRead codes).
export const TRANSIENT = new Set(['timeout', 'dns', 'refused', 'network', 'busy', 'rate']);
export const TOKEN_RE = /^nt_pat_[A-Za-z0-9_-]{32,64}$/;

/** The instance's base address: origin and path, without a pasted /api/v1, query or fragment. */
export function baseUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  const p = u.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '').replace(/\/+$/, '');
  return u.origin + p;
}

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));
// Text from another server: control characters (terminal escapes, NULs, line breaks) become spaces.
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max) : '');
// No food has more energy than pure fat, or more than 100 g of a macro, in 100 g or ml.
const LIMIT = { kcal: 900, proteinG: 100, carbohydrateG: 100, fatG: 100 };
const plainId = v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '');
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
const UNITS = { g: 'g', gram: 'g', grams: 'g', gr: 'g', ml: 'ml', milliliter: 'ml', millilitre: 'ml', milliliters: 'ml', millilitres: 'ml' };

/** One NutriTrace food as the diary reads it, or null for one without an id or a name. Its image and
 * notes are left out: an image may be relative to the instance, and notes are the user's own. */
export function foodFromNutriTrace(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || !plainId(item.id) || !text(item.name, 80)) return null;
  const n = item.nutrition && typeof item.nutrition === 'object' && !Array.isArray(item.nutrition) ? item.nutrition : {};
  const pick = (real, published) => num(n[real]) ?? num(n[published]);
  const perPortion = { kcal: pick('calories', 'kcal'), proteinG: pick('proteins', 'protein_g'), carbohydrateG: pick('carbohydrates', 'carbs_g'), fatG: pick('fat', 'fat_g') };
  const portion = item.portion == null ? 100 : num(item.portion);
  const unit = text(item.unit, 20) || 'g';
  const base = UNITS[unit.toLowerCase()] || null;
  let per100 = null, problem;
  if (base && portion > 0) {
    const f = 100 / portion;
    per100 = {
      kcal: perPortion.kcal == null ? null : Math.round(perPortion.kcal * f),
      proteinG: perPortion.proteinG == null ? null : r1(perPortion.proteinG * f),
      carbohydrateG: perPortion.carbohydrateG == null ? null : r1(perPortion.carbohydrateG * f),
      fatG: perPortion.fatG == null ? null : r1(perPortion.fatG * f),
    };
    // A value no food can have (a typo, grams entered as kg) is refused as a whole, not clipped:
    // the diary would otherwise log a wrong number that looks precise.
    if (Object.entries(per100).some(([k, v]) => v != null && (!Number.isFinite(v) || v > LIMIT[k]))) { per100 = null; problem = 'implausible'; }
  }
  return {
    id: String(item.id).slice(0, 64), name: text(item.name, 80), brand: text(item.brand, 60),
    barcode: /^\d{8,14}$/.test(String(item.barcode || '')) ? String(item.barcode) : null,
    portion, unit, basis: per100 ? (base === 'ml' ? '100ml' : '100g') : null, per100, perPortion,
    ...(problem ? { problem } : {}),
  };
}

/** A transport answer (or error) in words the app can show. */
export function judgeRead(r, err) {
  if (err) {
    if (err.code === 'EBLOCKED') return { ok: false, code: 'blocked', msg: 'That address is not one openGym calls.' };
    if (err.code === 'ETIMEDOUT') return { ok: false, code: 'timeout', msg: 'NutriTrace did not answer within 8 seconds.' };
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return { ok: false, code: 'dns', msg: 'The NutriTrace address could not be found.' };
    if (err.code === 'ECONNREFUSED') return { ok: false, code: 'refused', msg: 'NutriTrace refused the connection.' };
    if (err.code === 'ETOOBIG') return { ok: false, code: 'too-big', msg: 'NutriTrace answered with more than openGym reads.' };
    if (/certificate|SSL|TLS|self.signed/i.test(err.code + ' ' + err.message)) return { ok: false, code: 'tls', msg: 'NutriTrace\'s HTTPS certificate is not valid.' };
    return { ok: false, code: 'network', msg: 'Could not reach NutriTrace.' };
  }
  const s = r?.status;
  if (s >= 200 && s < 300) return { ok: true, status: s };
  if (s === 401) return { ok: false, status: s, code: 'auth', msg: 'NutriTrace refused the token. Make a new one in NutriTrace and connect again.' };
  if (s === 403) return { ok: false, status: s, code: 'scope', msg: 'The token needs the read:foods scope.' };
  if (s === 429) {
    const after = Number.parseInt(r.headers?.['retry-after'], 10);
    return { ok: false, status: s, code: 'rate', msg: 'NutriTrace asks to slow down.', retryAfter: Number.isFinite(after) && after > 0 ? Math.min(after, 600) : 30 };
  }
  if (s >= 300 && s < 400) return { ok: false, status: s, code: 'redirect', msg: `NutriTrace answered ${s}: use the instance's final address.` };
  if (s >= 500) return { ok: false, status: s, code: 'busy', msg: `NutriTrace answered ${s}.` };
  return { ok: false, status: s, code: 'refused', msg: `NutriTrace answered ${s}.` };
}

/** One GET by node's own http(s) with the guarded lookup: { status, headers, body } or throws. */
export function makeJsonGet({ allowLan }) {
  const agents = {
    'https:': new https.Agent({ lookup: outboundLookup({ allowLan }), keepAlive: false }),
    'http:': new http.Agent({ lookup: outboundLookup({ allowLan, plain: true }), keepAlive: false }),
  };
  return (url, { headers }) => new Promise((resolve, reject) => {
    // One way out: the first of answer, overflow, timeout or error settles it; the rest are ignored.
    let done = false;
    const settle = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const fail = (code, msg) => Object.assign(new Error(msg), { code });
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method: 'GET', agent: agents[u.protocol], headers, timeout: TIMEOUT_MS }, res => {
      const parts = []; let n = 0;
      res.on('data', d => {
        if (done) return;
        n += d.length;
        if (n > READ_MAX) { settle(reject, fail('ETOOBIG', 'too big')); res.destroy(); req.destroy(); return; }
        parts.push(d);
      });
      res.on('end', () => settle(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }));
      res.on('error', e => settle(reject, e));
      res.on('close', () => settle(reject, fail('ECONNRESET', 'connection closed before the answer ended')));
    });
    const timer = setTimeout(() => { settle(reject, fail('ETIMEDOUT', 'timed out')); req.destroy(); }, TIMEOUT_MS);
    timer.unref?.();
    req.on('timeout', () => { settle(reject, fail('ETIMEDOUT', 'timed out')); req.destroy(); });
    req.on('error', e => settle(reject, e));
    req.end();
  });
}

export function nutritraceProvider({ allowLan = false, get = null, version = 'dev' } = {}) {
  const send = get || makeJsonGet({ allowLan });

  async function call(reveal, pathAndQuery) {
    const base = reveal('base'), token = reveal('token');
    if (!base || !token) return { res: { ok: false, code: 'sealed', msg: 'Its settings cannot be read any more. Connect again.' } };
    const url = base + pathAndQuery;
    const bad = outboundUrlError(url, { allowLan });
    if (bad) return { res: { ok: false, code: 'blocked', msg: bad } };
    let r = null, err = null;
    const started = Date.now();
    try {
      r = await send(url, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, 'User-Agent': `openGym/${version}` } });
    } catch (e) { err = e; }
    const res = { ...judgeRead(r, err), ms: Date.now() - started };
    if (!res.ok) return { res };
    try { return { res, json: JSON.parse(r.body) }; }
    catch { return { res: { ok: false, status: r.status, code: 'parse', msg: 'NutriTrace answered with something openGym cannot read.', ms: res.ms } }; }
  }

  return {
    id: 'nutritrace',
    kind: 'apikey',
    category: 'nutrition',
    events: [],          // a reader: the outbox never queues anything for it
    env: [],
    configured: () => true,
    max: 1,              // one food library per profile
    rate: { capacity: 120, refillMs: 500 },
    connRate: null,
    allowLan,

    connect(input) {
      const raw = String(input?.url || '').trim();
      const base = baseUrl(raw);
      // The address as typed is judged first: cutting it back to the instance would otherwise drop
      // a user:password@ part silently instead of refusing it.
      const bad = outboundUrlError(raw, { allowLan }) || (base ? outboundUrlError(base, { allowLan }) : null);
      if (bad || !base) throw Object.assign(new Error(bad || 'url is not valid'), { status: 400, code: 'url' });
      const token = String(input?.token || '').trim();
      if (!TOKEN_RE.test(token)) throw Object.assign(new Error('Paste a NutriTrace API token (it starts with nt_pat_).'), { status: 400, code: 'token' });
      const host = new URL(base).host;
      const label = String(input?.label || '').trim().slice(0, 60) || host;
      return { label, events: [], info: { host }, secrets: { base, token } };
    },
    update(input) {
      const patch = {};
      if (input?.label != null) patch.label = String(input.label).trim().slice(0, 60);
      if (input?.paused != null) patch.paused = input.paused === true;
      return patch;
    },
    /** "Check connection" (the hub's test): the token works and carries read:foods. */
    async deliver(job, reveal) {
      const { res, json } = await call(reveal, '/api/v1/me');
      // A failure that may pass by itself (unreachable, slow, busy) is not final: the hub keeps the
      // connection as it is. Only what the user has to fix (token, scope, address) marks it.
      if (!res.ok) return { ...res, retry: TRANSIENT.has(res.code) };
      const scopes = Array.isArray(json?.scopes) ? json.scopes : [];
      if (!scopes.includes('read:foods')) return { ok: false, retry: false, status: res.status, ms: res.ms, code: 'scope', msg: 'The token needs the read:foods scope.' };
      return { ok: true, status: res.status, ms: res.ms };
    },
    /** Reads for the app. `foods`: the user's library matching `q`. */
    async query(op, params, reveal) {
      if (op !== 'foods') throw Object.assign(new Error('unknown query'), { status: 400, code: 'query' });
      const q = String(params?.q || '').trim().slice(0, QUERY_MAX);
      const { res, json } = await call(reveal, `/api/v1/foods?q=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`);
      if (!res.ok) return { error: res };
      const items = Array.isArray(json?.items) ? json.items.slice(0, SEARCH_LIMIT) : [];
      const foods = items.map(foodFromNutriTrace).filter(Boolean);
      return { foods, total: Number.isFinite(json?.total) ? json.total : foods.length };
    },
  };
}
