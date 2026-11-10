// Web Push with WebCrypto only (RFC 8291 aes128gcm payload, RFC 8292 VAPID), for the Garmin pushes.
// The api's own sender (web-push over node:https) is untested on Workers; this one is plain fetch.
// It signs with the api's own keys (DATA_DIR/vapid.json), so the browsers' existing subscriptions
// (db.json subs, made against that public key) accept it. Read only: dead subscriptions are left
// for the api to prune on its next send.
const te = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => new Uint8Array(Buffer.from(String(s), 'base64url'));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

async function hmac(key, data) {
  const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, data));
}

/** The encrypted body for subscription keys { p256dh, auth } (both base64url). */
export async function encrypt(payload, keys, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const ua = unb64u(keys.p256dh), auth = unb64u(keys.auth);
  const eph = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const uaKey = await subtle().importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hmac(await hmac(auth, shared), cat(te.encode('WebPush: info\0'), ua, as, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const k = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(te.encode(payload), [2])));
  return cat(salt, [0, 0, 16, 0], [as.length], as, ct);   // record size 4096
}

/** The VAPID Authorization header for `endpoint`, signed with vapid.json's { publicKey, privateKey }. */
export async function vapidAuth(endpoint, vapid, subject, now = Date.now()) {
  const pub = unb64u(vapid.publicKey);
  const key = await subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = o => b64u(te.encode(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject });
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${vapid.publicKey}`;
}

/** Sends `payload` (object) to every subscription in `subs`; answers how many were accepted. */
export async function sendAll(subs, payload, vapid, subject, fetchFn = (...a) => fetch(...a)) {
  const body = JSON.stringify(payload);
  let ok = 0;
  for (const s of subs) {
    try {
      const res = await fetchFn(s.endpoint, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: await vapidAuth(s.endpoint, vapid, subject), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '43200', Urgency: 'normal' },
        body: await encrypt(body, s.keys),
      });
      if (res.ok) ok++; else console.error('garmin push:', res.status);
    } catch (e) { console.error('garmin push:', e?.message); }
  }
  return ok;
}
