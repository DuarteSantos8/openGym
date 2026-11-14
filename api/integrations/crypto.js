/* Secrets at rest for the integrations: a webhook's URL (Home Assistant puts its own secret in
 * the path) and signing secret now, OAuth tokens later. AES-256-GCM with a key derived from the
 * server's own secret (DATA_DIR/secret, the one that signs the session cookies), so there is no
 * second key file to lose or to forget in a backup. Each value gets a fresh 96-bit nonce, and the
 * user id and field name are bound in as associated data: a sealed value copied into another
 * profile's file, or into another field, does not open.
 *
 * Changing ./data/secret signs everyone out and also makes these unreadable; the connections
 * then show "Needs attention" and are set up again (docs/INTEGRATIONS.md). */
import crypto from 'node:crypto';

const VERSION = 'v1';

/** The 32-byte key, derived (HKDF-SHA256) so it is never the session key itself. */
export function deriveKey(secret) {
  if (!secret || String(secret).length < 16) throw new Error('integrations: server secret missing');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret)), Buffer.from('opengym-integrations'), Buffer.from('connections v1'), 32));
}

/** "v1.<nonce>.<tag>.<ciphertext>", all base64url. `aad` ties it to where it is stored. */
export function seal(key, plain, aad = '') {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [VERSION, iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** The plain text, or null when it cannot be opened (another key, another place, tampered). */
export function open(key, sealed, aad = '') {
  if (typeof sealed !== 'string') return null;
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== VERSION || !iv || !tag || ct === undefined) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(String(aad)));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}

/** A new signing secret, shown to its owner once. */
export const newSecret = () => 'ogwh_' + crypto.randomBytes(24).toString('base64url');

/** An id that says nothing about its owner. */
export const newId = (prefix = 'c') => prefix + '_' + crypto.randomBytes(9).toString('base64url');

/**
 * The webhook signature: HMAC-SHA256 over "<timestamp>.<body>" with the webhook's secret, sent
 * as `X-OpenGym-Signature: t=<unix seconds>,v1=<hex>`. The timestamp inside the signed text lets
 * a receiver refuse a replayed delivery (docs/INTEGRATIONS.md has a checker).
 */
export function signature(secret, body, ts = Math.floor(Date.now() / 1000)) {
  const mac = crypto.createHmac('sha256', String(secret)).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${mac}`;
}

/** The receiver's side of signature(), for the tests and the docs: constant-time, with a clock window. */
export function verifySignature(secret, body, header, { now = Date.now(), toleranceSec = 300 } = {}) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(header || ''));
  if (!m) return false;
  const ts = +m[1];
  if (Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const want = crypto.createHmac('sha256', String(secret)).update(`${ts}.${body}`).digest();
  const got = Buffer.from(m[2], 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
