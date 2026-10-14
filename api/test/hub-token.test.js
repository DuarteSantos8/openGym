/* Hub tokens (hub-token.js): the key set read from HUB_JWKS, and every check the hub token
   contract asks of a verifier. The routes that use them are in server-sync.test.js. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hubKeysFromEnv, verifyHubToken, replayCache, HUB_AUDIENCE } from '../hub-token.js';
import { ISSUER, hubKey, jwks, mint, badTokens } from './hub-fixtures.mjs';

const key = hubKey('hub-1');
const hub = hubKeysFromEnv({ HUB_JWKS: jwks(key), HUB_ISSUER: ISSUER });
const verify = (token, opts = {}) => verifyHubToken(hub, token, { audience: HUB_AUDIENCE, scopes: ['sync'], ...opts });

describe('hubKeysFromEnv', () => {
  it('is off while HUB_JWKS is unset or blank', () => {
    assert.equal(hubKeysFromEnv({}), null);
    assert.equal(hubKeysFromEnv({ HUB_JWKS: '  ', HUB_ISSUER: ISSUER }), null);
  });

  it('reads every key of the set, by kid', () => {
    const next = hubKey('hub-2');
    const both = hubKeysFromEnv({ HUB_JWKS: jwks(key, next), HUB_ISSUER: ISSUER });
    assert.equal(both.issuer, ISSUER);
    assert.deepEqual([...both.keys.keys()], ['hub-1', 'hub-2']);
  });

  it('refuses a key set it cannot use rather than run without one', () => {
    const { d: _d, ...pub } = key.jwk;
    const bad = [
      [{ HUB_JWKS: jwks(key) }, /HUB_ISSUER/],
      [{ HUB_JWKS: '{nope', HUB_ISSUER: ISSUER }, /not valid JSON/],
      [{ HUB_JWKS: '{"keys":[]}', HUB_ISSUER: ISSUER }, /no keys/],
      [{ HUB_JWKS: JSON.stringify({ keys: [{ ...pub, kid: undefined }] }), HUB_ISSUER: ISSUER }, /with a kid/],
      [{ HUB_JWKS: JSON.stringify({ keys: [{ ...pub, crv: 'P-384' }] }), HUB_ISSUER: ISSUER }, /P-256/],
      [{ HUB_JWKS: JSON.stringify({ keys: [{ ...pub, alg: 'RS256' }] }), HUB_ISSUER: ISSUER }, /not for ES256/],
      [{ HUB_JWKS: JSON.stringify({ keys: [{ ...pub, use: 'enc' }] }), HUB_ISSUER: ISSUER }, /not a signing key/],
      [{ HUB_JWKS: JSON.stringify({ keys: [pub, pub] }), HUB_ISSUER: ISSUER }, /appears twice/],
      [{ HUB_JWKS: JSON.stringify({ keys: [{ ...pub, x: 'AAAA' }] }), HUB_ISSUER: ISSUER }, /not a valid P-256 public key/]
    ];
    for (const [env, msg] of bad) assert.throws(() => hubKeysFromEnv(env), msg);
  });

  it('refuses the hub’s private key', () => {
    const priv = { ...key.privateKey.export({ format: 'jwk' }), kid: 'hub-1' };
    assert.throws(() => hubKeysFromEnv({ HUB_JWKS: JSON.stringify({ keys: [priv] }), HUB_ISSUER: ISSUER }), /private key/);
  });
});

describe('verifyHubToken', () => {
  it('accepts a token made to the contract and hands back its claims', () => {
    const v = verify(mint(key, { sub: 'u1' }));
    assert.equal(v.ok, true);
    assert.equal(v.claims.sub, 'u1');
    assert.equal(v.claims.scope, 'sync');
  });

  it('accepts every key of the set, so the hub can rotate', () => {
    const next = hubKey('hub-2');
    const both = hubKeysFromEnv({ HUB_JWKS: jwks(key, next), HUB_ISSUER: ISSUER });
    for (const k of [key, next]) assert.equal(verifyHubToken(both, mint(k), { audience: HUB_AUDIENCE, scopes: ['sync'] }).ok, true);
  });

  it('allows 30 s of clock skew on iat and no more', () => {
    const now = 1_800_000_000_000, t = now / 1000;
    assert.equal(verify(mint(key, { now, claims: { iat: t + 30, exp: t + 60 } }), { now }).ok, true);
    assert.equal(verify(mint(key, { now, claims: { iat: t + 31, exp: t + 61 } }), { now }).reason, 'iat');
  });

  it('refuses every way a token can be wrong, each for its own reason', () => {
    const expect = {
      expired: 'expired', 'wrong-aud': 'aud', 'aud-array': 'aud', 'wrong-iss': 'iss', hs256: 'alg',
      'alg-none': 'malformed', 'alg-none-signed': 'alg', 'unknown-kid': 'kid', 'other-key': 'signature',
      tampered: 'signature', 'der-signature': 'signature', 'lifetime-61s': 'lifetime', 'iat-future': 'iat',
      'scope-user': 'scope', 'no-sub': 'sub', 'crit-header': 'crit',
      'non-canonical-signature': 'signature', 'no-jti': 'jti', 'short-jti': 'jti'
    };
    const tokens = badTokens(key);
    assert.deepEqual(Object.keys(tokens).sort(), Object.keys(expect).sort());
    for (const [name, token] of Object.entries(tokens)) {
      assert.deepEqual(verify(token), { ok: false, reason: expect[name] }, name);
    }
  });

  it('refuses what is not a token at all', () => {
    for (const t of [undefined, '', 'abc', 'a.b', 'a.b.c.d', 'x'.repeat(5000), '!!.??.##', 'e30.e30.e30']) {
      assert.equal(verify(t).ok, false, String(t).slice(0, 20));
    }
  });

  it('refuses claims of the wrong type', () => {
    const t = Math.floor(Date.now() / 1000);
    assert.equal(verify(mint(key, { claims: { exp: String(t + 60) } })).reason, 'time');
    assert.equal(verify(mint(key, { claims: { sub: 42 } })).reason, 'sub');
    assert.equal(verify(mint(key, { claims: { exp: t - 1, iat: t - 2 } })).reason, 'expired');
    assert.equal(verify(mint(key, { claims: { iat: t + 10, exp: t + 5 } })).reason, 'lifetime');
  });

  it('checks the audience and scopes it is asked for', () => {
    const user = mint(key, { claims: { aud: 'nutritrace', scope: 'user' } });
    assert.equal(verify(user, { audience: 'nutritrace', scopes: ['user'] }).ok, true);
    assert.equal(verify(user).reason, 'aud');
  });

  it('takes only the canonical spelling of a signature that is otherwise good', () => {
    const good = mint(key);
    const [h, p, s] = good.split('.');
    assert.equal(verify(good).ok, true);
    const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const i = B64U.indexOf(s.at(-1));
    // Every spelling of the last character that decodes to the same bytes, bar the original.
    const others = [...B64U].filter((c, j) => j !== i && (j & ~15) === (i & ~15));
    assert.equal(others.length, 15);
    for (const c of others) {
      const respelled = `${h}.${p}.${s.slice(0, -1)}${c}`;
      assert.deepEqual(Buffer.from(s.slice(0, -1) + c, 'base64url'), Buffer.from(s, 'base64url'), 'the same bytes');
      assert.deepEqual(verify(respelled), { ok: false, reason: 'signature' });
    }
  });
});

describe('replayCache', () => {
  const claims = (jti, exp) => ({ jti, exp });
  it('lets a jti through once while its token is in date', () => {
    const c = replayCache();
    const now = 1_800_000_000_000;
    assert.equal(c.seen(claims('a'.repeat(22), now / 1000 + 60), now), false);
    assert.equal(c.seen(claims('a'.repeat(22), now / 1000 + 60), now + 1000), true);
    assert.equal(c.seen(claims('a'.repeat(22), now / 1000 + 60), now + 59_999), true);
    assert.equal(c.seen(claims('b'.repeat(22), now / 1000 + 60), now + 1000), false);
  });

  it('forgets a jti once its token has expired, and holds no more than that', () => {
    const c = replayCache();
    const now = 1_800_000_000_000;
    for (let i = 0; i < 100; i++) c.seen(claims(`jti-${i}`.padEnd(22, 'x'), now / 1000 + 60), now);
    assert.equal(c.size, 100);
    // Past every exp: the next call sweeps them all out.
    assert.equal(c.seen(claims('z'.repeat(22), now / 1000 + 200), now + 61_000), false);
    assert.equal(c.size, 1);
  });

  it('stays within its bound, dropping the oldest first', () => {
    const c = replayCache({ max: 3 });
    const now = 1_800_000_000_000, exp = now / 1000 + 60;
    for (const j of ['a', 'b', 'c', 'd']) c.seen(claims(j.repeat(22), exp), now);
    assert.equal(c.size, 3);
    assert.equal(c.seen(claims('d'.repeat(22), exp), now), true);
    assert.equal(c.seen(claims('a'.repeat(22), exp), now), false, 'the oldest went first');
  });
});
