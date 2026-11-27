/* Checks one openGym webhook delivery. Plain JavaScript with no imports, so the same text runs in
 * the tests (as a CommonJS module) and inside the Node-RED Function node, where build-flow.mjs
 * pastes it (everything above the export block) with `crypto` loaded through the node's Setup
 * tab ("libs").
 *
 * openGym's contract (api/integrations/crypto.js, providers/webhook.js, events.js):
 *   X-OpenGym-Signature: t=<unix seconds>,v1=<hex>
 *   hex = HMAC-SHA256(secret, "<t>." + raw request body)
 *   body = { version: 1, id, type, createdAt, test?, data }; `id` is the delivery's own and stays
 *   the same on every retry, while each retry is signed again with a fresh `t`.
 *   X-OpenGym-Delivery repeats the id but is NOT signed, so it is never used here.
 *
 * What a receiver answers decides what openGym does next (providers/webhook.js judge): 2xx is
 * delivered, 408/425/429/5xx is retried later, any other 4xx is a final failure, 410 pauses the
 * webhook. So a duplicate is a 200 (delivered, do nothing), not an error. */

var OPENGYM_EVENTS = ['workout.finished', 'workout.pr', 'weighin.logged'];
var SIGNATURE_RE = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/;

/** The id store for replay protection: a plain object (so a persistent Node-RED context store can
 *  save it), keys "k:<id>" (no integer-looking keys, so insertion order is kept), values the time
 *  in ms after which the id may be forgotten. Bounded: past `max` the oldest go first. */
function seenHas(store, id, nowMs) {
  var exp = store['k:' + id];
  return typeof exp === 'number' && exp > nowMs;
}
function seenAdd(store, id, expiresMs, nowMs, max) {
  var keys = Object.keys(store);
  for (var i = 0; i < keys.length; i++) if (!(store[keys[i]] > nowMs)) delete store[keys[i]];
  store['k:' + id] = expiresMs;
  keys = Object.keys(store);
  for (var j = 0; keys.length - j > max; j++) delete store[keys[j]];
  return store;
}

/**
 * opts: { rawBody: Buffer, headers: { lower-case names }, secret, crypto, seen: object,
 *         now: ms, toleranceSec: 300, maxBytes: 65536, maxSeen: 10000, defer: false }
 * Answers { ok: true, status: 200, envelope } for a new, authentic delivery (with `defer`, also
 *         `remember`, for rememberDelivery once it is handled),
 *         { ok: true, status: 200, duplicate: true, id } for one already seen,
 *         { ok: true, status: 200, ignored: true, id, type } for an authentic one of a type this
 *         flow does not handle, or
 *         { ok: false, status, reason } where `reason` is for your own log only.
 * Every refusal has one public body per status (publicBody), so nothing about the secret, the
 * expected signature or which check failed is sent back.
 */
function verifyOpenGymWebhook(opts) {
  var crypto = opts.crypto;
  var secret = opts.secret;
  var nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
  var tolerance = opts.toleranceSec > 0 ? opts.toleranceSec : 300;
  var maxBytes = opts.maxBytes > 0 ? opts.maxBytes : 65536;
  var maxSeen = opts.maxSeen > 0 ? opts.maxSeen : 10000;
  var headers = opts.headers || {};
  var raw = opts.rawBody;

  if (!crypto || typeof crypto.createHmac !== 'function') return { ok: false, status: 500, reason: 'crypto module not available (Setup tab, Modules: crypto)' };
  if (typeof secret !== 'string' || secret.length < 16) return { ok: false, status: 500, reason: 'OPENGYM_WEBHOOK_SECRET is not set' };
  // The http in node must hand over the bytes as they arrived ("Do not parse the body").
  if (!Buffer.isBuffer(raw)) return { ok: false, status: 500, reason: 'raw body not available: tick "Do not parse request body" on the http in node' };
  if (raw.length > maxBytes) return { ok: false, status: 413, reason: 'body larger than ' + maxBytes + ' bytes' };

  var header = headers['x-opengym-signature'];
  if (Array.isArray(header)) return { ok: false, status: 401, reason: 'more than one signature header' };
  var m = SIGNATURE_RE.exec(typeof header === 'string' ? header : '');
  if (!m) return { ok: false, status: 401, reason: header ? 'malformed signature header' : 'missing signature header' };
  var ts = Number(m[1]);
  if (Math.abs(nowMs / 1000 - ts) > tolerance) return { ok: false, status: 401, reason: 'timestamp outside the ' + tolerance + ' s window' };

  // Over the exact bytes received: "<t>." then the raw body, never a re-serialised object.
  var want = crypto.createHmac('sha256', secret).update(ts + '.').update(raw).digest();
  var got = Buffer.from(m[2], 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return { ok: false, status: 401, reason: 'signature does not match' };

  // Only now is the body read: nothing unauthenticated is parsed.
  var envelope;
  try { envelope = JSON.parse(raw.toString('utf8')); } catch (e) { return { ok: false, status: 400, reason: 'signed body is not JSON' }; }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return { ok: false, status: 400, reason: 'signed body is not an object' };
  if (envelope.version !== 1) return { ok: false, status: 400, reason: 'unsupported payload version' };
  if (typeof envelope.id !== 'string' || !envelope.id || envelope.id.length > 100) return { ok: false, status: 400, reason: 'missing or invalid delivery id' };
  if (typeof envelope.type !== 'string' || !envelope.type || envelope.type.length > 64) return { ok: false, status: 400, reason: 'missing or invalid event type' };

  // Replay: the signed id, remembered for twice the window (a copy older than the window already
  // fails the timestamp check above). openGym's own retries carry the same id and get the 200.
  var seen = opts.seen || {};
  if (seenHas(seen, envelope.id, nowMs)) return { ok: true, status: 200, duplicate: true, id: envelope.id };
  var until = nowMs + 2 * tolerance * 1000;
  // Authentic, but a type this flow does not handle (one openGym added later): acknowledge it with
  // a 200. A 4xx would be a final failure in openGym and mark the webhook for attention.
  if (OPENGYM_EVENTS.indexOf(envelope.type) === -1) {
    seenAdd(seen, envelope.id, until, nowMs, maxSeen);
    return { ok: true, status: 200, ignored: true, id: envelope.id, type: envelope.type };
  }
  // With `defer`, the id is recorded only once the handler is done (rememberDelivery): recorded
  // now, a handler that then failed would turn openGym's retry into a "duplicate" and lose it.
  if (opts.defer) return { ok: true, status: 200, envelope: envelope, remember: { id: envelope.id, until: until } };
  seenAdd(seen, envelope.id, until, nowMs, maxSeen);
  return { ok: true, status: 200, envelope: envelope };
}

/** Records a deferred delivery (the `remember` of a defer result) as handled. */
function rememberDelivery(store, remember, nowMs, max) {
  if (!remember || typeof remember.id !== 'string') return store;
  return seenAdd(store, remember.id, remember.until, typeof nowMs === 'number' ? nowMs : Date.now(), max > 0 ? max : 10000);
}

/** What the sender sees: one fixed body per status, nothing derived from the request. */
function publicBody(result) {
  if (result.duplicate) return { ok: true, duplicate: true };
  if (result.ignored) return { ok: true, ignored: true };
  if (result.ok) return { ok: true };
  if (result.status === 413) return { error: 'payload too large' };
  if (result.status === 401) return { error: 'unauthorized' };
  if (result.status === 400) return { error: 'bad request' };
  return { error: 'receiver not configured' };
}

/* --- export (not pasted into the flow) --- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { verifyOpenGymWebhook, publicBody, seenHas, seenAdd, rememberDelivery, OPENGYM_EVENTS };
}
