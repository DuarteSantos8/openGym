/* The outbound webhook: one HTTPS POST per event to a URL of the user's choosing, signed with a
 * secret only they and openGym know. It is what makes Home Assistant, n8n, Node-RED, ntfy and
 * Zapier-style tools work without openGym knowing any of them.
 *
 * The URL is a request this server makes on the user's behalf, so it gets the push endpoint's
 * rules (net-guard.js): https only, no private addresses, judged in the connection's own lookup
 * and again right before every send for a literal address. INTEGRATIONS_ALLOW_LAN=1 opens the
 * home network, never loopback or link-local. Redirects are not followed (a 30x is a refusal),
 * the request gives up after TIMEOUT_MS, and the answer is read for at most READ_MAX bytes.
 *
 * Payload reference: docs/INTEGRATIONS.md. */
import http from 'node:http';
import https from 'node:https';
import { outboundLookup, outboundUrlError } from '../../net-guard.js';
import { signature, newSecret } from '../crypto.js';
import { EVENTS } from '../events.js';

export const TIMEOUT_MS = 10_000;
export const READ_MAX = 2048;
export const MAX_WEBHOOKS = 10;

/** "https://ha.example.com/api/webhook/…x7Qk": enough to recognise, not enough to call. */
export function maskUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return ''; }
  const p = u.pathname;
  const seg = p.split('/').filter(Boolean);
  let shown = p;
  if (p.length > 16) shown = '/' + (seg.length > 1 ? seg.slice(0, -1).join('/').slice(0, 24) + '/' : '') + '…' + p.slice(-4);
  return `${u.protocol}//${u.host}${shown === '/' ? '' : shown}${u.search ? '?…' : ''}`.slice(0, 200);
}

const retryAfterMs = (h, now = Date.now()) => {
  const v = String(h || '').trim();
  if (!v) return 0;
  if (/^\d+$/.test(v)) return +v * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : 0;
};

/** One POST, by node's own http(s) with the guarded lookup. Answers { status, headers } or throws. */
export function makeTransport({ allowLan }) {
  const agents = {
    'https:': new https.Agent({ lookup: outboundLookup({ allowLan }), keepAlive: false }),
    'http:': new http.Agent({ lookup: outboundLookup({ allowLan, plain: true }), keepAlive: false }),
  };
  return (url, { body, headers }) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method: 'POST', agent: agents[u.protocol], headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, timeout: TIMEOUT_MS }, res => {
      let n = 0;
      res.on('data', d => { n += d.length; if (n > READ_MAX) res.destroy(); });
      const finish = () => resolve({ status: res.statusCode, headers: res.headers });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', finish);
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })), TIMEOUT_MS);
    timer.unref?.();
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}

/** A transport result (or error) in the outbox's words. */
export function judge(r, err, now = Date.now()) {
  if (err) {
    if (err.code === 'EBLOCKED') return { ok: false, retry: false, code: 'blocked', msg: 'That address is not one openGym calls.' };
    if (err.code === 'ETIMEDOUT') return { ok: false, retry: true, code: 'timeout', msg: 'No answer within 10 seconds.' };
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return { ok: false, retry: true, code: 'dns', msg: 'The address could not be found.' };
    if (err.code === 'ECONNREFUSED') return { ok: false, retry: true, code: 'refused', msg: 'The receiver refused the connection.' };
    if (/certificate|SSL|TLS|self.signed/i.test(err.code + ' ' + err.message)) return { ok: false, retry: false, code: 'tls', msg: 'The receiver\'s HTTPS certificate is not valid.' };
    return { ok: false, retry: true, code: 'network', msg: String(err.message || 'Could not connect.').slice(0, 120) };
  }
  const s = r.status;
  if (s >= 200 && s < 300) return { ok: true, status: s };
  if (s === 410) return { ok: false, retry: false, gone: true, status: s, code: 'gone', msg: 'The receiver says this webhook is gone (410).' };
  if (s >= 300 && s < 400) return { ok: false, retry: false, status: s, code: 'redirect', msg: `Answered ${s}: redirects are not followed, use the final URL.` };
  if (s === 408 || s === 425 || s === 429 || s >= 500) return { ok: false, retry: true, status: s, code: 'busy', msg: `The receiver answered ${s}.`, retryAfterMs: retryAfterMs(r.headers?.['retry-after'], now) };
  return { ok: false, retry: false, status: s, code: 'refused', msg: `The receiver answered ${s}.` };
}

export function webhookProvider({ allowLan = false, transport = null, version = 'dev' } = {}) {
  const send = transport || makeTransport({ allowLan });

  async function post(url, secret, envelope) {
    const bad = outboundUrlError(url, { allowLan });
    if (bad) return { ok: false, retry: false, code: 'blocked', msg: bad };
    const body = JSON.stringify(envelope);
    const started = Date.now();
    let r = null, err = null;
    try {
      r = await send(url, {
        body,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `openGym-Webhook/${version}`,
          'X-OpenGym-Event': envelope.type,
          'X-OpenGym-Delivery': envelope.id,
          'X-OpenGym-Signature': signature(secret, body),
        },
      });
    } catch (e) { err = e; }
    return { ...judge(r, err), ms: Date.now() - started };
  }

  return {
    id: 'webhook',
    kind: 'webhook',
    category: 'automation',
    events: EVENTS,
    env: [],
    configured: () => true,
    max: MAX_WEBHOOKS,
    // A webhook is the user's own receiver, so the limits are about not flooding it: 30 a
    // minute per webhook, 600 a minute for the whole instance.
    rate: { capacity: 600, refillMs: 100 },
    connRate: { capacity: 30, refillMs: 2000 },
    allowLan,

    /** Checks the form and answers what to store, plus the secret to show once. */
    connect(input) {
      const url = String(input?.url || '').trim();
      const bad = outboundUrlError(url, { allowLan });
      if (bad) throw Object.assign(new Error(bad), { status: 400, code: 'url' });
      const events = pickEvents(input?.events);
      const secret = newSecret();
      let host = '';
      try { host = new URL(url).host; } catch { /* checked above */ }
      const label = String(input?.label || '').trim().slice(0, 60) || host;
      return { label, events, info: { url: maskUrl(url) }, secrets: { url, secret }, reveal: { secret } };
    },
    /** Label and events only: a new URL is a new webhook (and a new secret). */
    update(input) {
      const patch = {};
      if (input?.label != null) patch.label = String(input.label).trim().slice(0, 60);
      if (input?.events != null) patch.events = pickEvents(input.events);
      if (input?.paused != null) patch.paused = input.paused === true;
      return patch;
    },
    async deliver(job, reveal) {
      const url = reveal('url'), secret = reveal('secret');
      if (!url || !secret) return { ok: false, retry: false, code: 'sealed', msg: 'Its settings cannot be read any more. Add it again.' };
      return post(url, secret, job.payload);
    },
  };
}

function pickEvents(raw) {
  const want = Array.isArray(raw) ? raw.filter(e => EVENTS.includes(e)) : [];
  if (Array.isArray(raw) && !want.length) throw Object.assign(new Error('pick at least one event'), { status: 400, code: 'events' });
  return want.length ? [...new Set(want)] : ['workout.finished'];
}
