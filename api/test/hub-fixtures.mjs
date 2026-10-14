/* A stand-in for the sync hub: an ES256 key pair, its public half as the JWKS openGym is given
   (HUB_JWKS), and tokens signed the way the hub signs them, with any claim or header overridden
   to make one that is wrong in exactly one way. Shared by hub-token.test.js and
   server-sync.test.js. */
import crypto from 'node:crypto';

export const ISSUER = 'https://hub.example.test/hub';

export function hubKey(kid = 'hub-1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' } };
}

export const jwks = (...keys) => JSON.stringify({ keys: keys.map(k => k.jwk) });

const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');

// A token for `sub` that passes every check, unless `claims` / `header` say otherwise. `sign`
// replaces the signature step (an HMAC, a DER signature, another key).
export function mint(key, { sub = 'u1', claims = {}, header = {}, now = Date.now(), sign } = {}) {
  const iat = Math.floor(now / 1000);
  const h = enc({ alg: 'ES256', kid: key.kid, typ: 'JWT', ...header });
  const p = enc({
    iss: ISSUER, aud: 'opengym-sync', sub, name: 'Ana', scope: 'sync', act: 'bridge',
    iat, exp: iat + 60, jti: crypto.randomBytes(16).toString('base64url'), ...claims
  });
  const input = Buffer.from(h + '.' + p);
  const sig = sign ? sign(input) : crypto.sign('sha256', input, { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return h + '.' + p + '.' + Buffer.from(sig).toString('base64url');
}

// One token per way the contract says a token must be refused, keyed by the reason
// verifyHubToken gives for it.
export function badTokens(key, sub = 'u1') {
  const t = Math.floor(Date.now() / 1000);
  const other = hubKey(key.kid);
  const pem = crypto.createPublicKey({ key: key.jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
  const good = mint(key, { sub });
  const [gh, gp, gs] = good.split('.');
  const forged = JSON.parse(Buffer.from(gp, 'base64url').toString());
  return {
    expired: mint(key, { sub, claims: { iat: t - 120, exp: t - 60 } }),
    'wrong-aud': mint(key, { sub, claims: { aud: 'nutritrace' } }),
    'aud-array': mint(key, { sub, claims: { aud: ['opengym-sync'] } }),
    'wrong-iss': mint(key, { sub, claims: { iss: 'https://evil.example.test/hub' } }),
    // The classic: the public key, which anyone has, used as an HMAC secret.
    hs256: mint(key, { sub, header: { alg: 'HS256' }, sign: input => crypto.createHmac('sha256', pem).update(input).digest() }),
    'alg-none': `${enc({ alg: 'none', kid: key.kid, typ: 'JWT' })}.${gp}.`,
    'alg-none-signed': mint(key, { sub, header: { alg: 'none' } }),
    'unknown-kid': mint(key, { sub, header: { kid: 'not-a-hub-key' } }),
    'other-key': mint(other, { sub }),
    'tampered': `${gh}.${enc({ ...forged, sub: 'someone-else' })}.${gs}`,
    'der-signature': mint(key, { sub, sign: input => crypto.sign('sha256', input, key.privateKey) }),
    'lifetime-61s': mint(key, { sub, claims: { iat: t, exp: t + 61 } }),
    // Well past the 30 s of skew, so it is still refused when a slow run sends it seconds later.
    'iat-future': mint(key, { sub, claims: { iat: t + 45, exp: t + 90 } }),
    'scope-user': mint(key, { sub, claims: { scope: 'user' } }),
    'no-sub': mint(key, { sub: '' }),
    'crit-header': mint(key, { sub, header: { crit: ['exp'] } })
  };
}
