/* The ID token check (api/oidc/jwt.js), the config parser and the account decisions
   (api/oidc/accounts.js), one rule per assertion. The server-level tests are in server-oidc.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyIdToken, allowedAlgs, decodeJwt } from '../oidc/jwt.js';
import { oidcConfig } from '../oidc/config.js';
import { decide, accessOf, nameFor, claimAt } from '../oidc/accounts.js';
import { signJwt } from './mock-oidc.mjs';

const ISS = 'https://id.example.com';
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ed = crypto.generateKeyPairSync('ed25519');
const jwk = (k, kid, alg) => ({ ...k.publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig' });
const JWKS = { keys: [jwk(rsa, 'r1', 'RS256'), jwk(ec, 'e1', 'ES256'), jwk(ed, 'd1', 'EdDSA')] };
const now = Date.now();
const t0 = Math.floor(now / 1000);
const base = (over = {}) => ({ iss: ISS, aud: 'og', sub: 'abc', nonce: 'n-1', iat: t0, exp: t0 + 300, ...over });
const opts = (over = {}) => ({ jwks: JWKS, issuer: ISS, clientId: 'og', nonce: 'n-1', algs: ['RS256', 'ES256', 'EdDSA'], now, ...over });
const rejects = (p, code) => assert.rejects(p, e => e.code === code);

test('a good token passes with RS256, ES256 and EdDSA', async () => {
  assert.equal((await verifyIdToken(signJwt(base(), { key: rsa.privateKey, kid: 'r1' }), opts())).sub, 'abc');
  assert.equal((await verifyIdToken(signJwt(base(), { key: ec.privateKey, kid: 'e1', alg: 'ES256' }), opts())).sub, 'abc');
  assert.equal((await verifyIdToken(signJwt(base(), { key: ed.privateKey, kid: 'd1', alg: 'EdDSA' }), opts())).sub, 'abc');
});

test('signature: another key, a flipped byte, alg none, HS256 and an alg off the list are refused', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await rejects(verifyIdToken(signJwt(base(), { key: other, kid: 'r1' }), opts()), 'signature');
  const good = signJwt(base(), { key: rsa.privateKey, kid: 'r1' });
  const [h, p, s] = good.split('.');
  const flipped = Buffer.from(s, 'base64url'); flipped[10] ^= 1;
  await rejects(verifyIdToken([h, p, flipped.toString('base64url')].join('.'), opts()), 'signature');
  // A payload swapped under the same signature.
  const p2 = Buffer.from(JSON.stringify(base({ sub: 'admin' }))).toString('base64url');
  await rejects(verifyIdToken([h, p2, s].join('.'), opts()), 'signature');
  const none = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + p + '.';
  await rejects(verifyIdToken(none, opts()), 'alg');
  const hs = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'r1' })).toString('base64url');
  await rejects(verifyIdToken(hs + '.' + p + '.' + s, opts()), 'alg');
  await rejects(verifyIdToken(good, opts({ algs: ['ES256'] })), 'alg');
});

test('keys: an unknown kid fetches the set once more, then gives up', async () => {
  const tok = signJwt(base(), { key: rsa.privateKey, kid: 'rotated' });
  let asked = 0;
  await rejects(verifyIdToken(tok, opts({ refetch: async () => { asked++; return JWKS; } })), 'no-key');
  assert.equal(asked, 1);
  const rotated = { keys: [{ ...jwk(rsa, 'rotated', 'RS256') }] };
  assert.equal((await verifyIdToken(tok, opts({ refetch: async () => rotated }))).sub, 'abc');
  // An RSA key under 2048 bits is not trusted even when it signs.
  const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  await rejects(verifyIdToken(signJwt(base(), { key: weak.privateKey, kid: 'w' }), opts({ jwks: { keys: [jwk(weak, 'w', 'RS256')] } })), 'no-key');
});

test('claims: issuer, audience, azp, exp, iat, nbf, nonce, sub', async () => {
  const sign = c => signJwt(c, { key: rsa.privateKey, kid: 'r1' });
  await rejects(verifyIdToken(sign(base({ iss: ISS + '/' })), opts()), 'issuer');
  await rejects(verifyIdToken(sign(base({ aud: 'other' })), opts()), 'audience');
  await rejects(verifyIdToken(sign(base({ aud: ['og', 'other'] })), opts()), 'audience');
  assert.ok(await verifyIdToken(sign(base({ aud: ['og', 'other'], azp: 'og' })), opts()));
  await rejects(verifyIdToken(sign(base({ azp: 'other' })), opts()), 'audience');
  await rejects(verifyIdToken(sign(base({ exp: t0 - 120 })), opts()), 'expired');
  assert.ok(await verifyIdToken(sign(base({ exp: t0 - 30 })), opts()), 'within the clock skew');
  await rejects(verifyIdToken(sign(base({ exp: undefined })), opts()), 'expired');
  await rejects(verifyIdToken(sign(base({ iat: t0 + 600 })), opts()), 'expired');
  await rejects(verifyIdToken(sign(base({ nbf: t0 + 600 })), opts()), 'expired');
  await rejects(verifyIdToken(sign(base({ nonce: 'n-2' })), opts()), 'nonce');
  await rejects(verifyIdToken(sign(base({ nonce: undefined })), opts()), 'nonce');
  await rejects(verifyIdToken(sign(base()), opts({ nonce: '' })), 'nonce');
  await rejects(verifyIdToken(sign(base({ sub: '' })), opts()), 'malformed');
  await rejects(verifyIdToken(sign(base({ auth_time: t0 - 3600 })), opts({ maxAgeSec: 300 })), 'stale');
});

test('malformed tokens and critical headers', async () => {
  await rejects(verifyIdToken('a.b', opts()), 'malformed');
  await rejects(verifyIdToken('not json.x.y', opts()), 'malformed');
  await rejects(verifyIdToken('x'.repeat(20000), opts()), 'malformed');
  const crit = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'r1', crit: ['exp'] })).toString('base64url') + '.e30.';
  await rejects(verifyIdToken(crit, opts()), 'malformed');
  assert.equal(decodeJwt(signJwt(base(), { key: rsa.privateKey })).claims.sub, 'abc');
});

test('allowedAlgs: what the provider says, cut to what we verify; RS256 when it says nothing', () => {
  assert.deepEqual(allowedAlgs(undefined), ['RS256']);
  assert.deepEqual(allowedAlgs(['HS256', 'none', 'ES256', 'RS256']), ['ES256', 'RS256']);
});

test('config: off without issuer and client, problems named, defaults sane', () => {
  assert.equal(oidcConfig({}, { origin: 'https://gym.x' }).enabled, false);
  const half = oidcConfig({ OIDC_ISSUER: ISS }, { origin: 'https://gym.x' });
  assert.equal(half.enabled, false);
  assert.match(half.problems[0], /OIDC_CLIENT_ID/);
  const c = oidcConfig({ OIDC_ISSUER: ISS + '/', OIDC_CLIENT_ID: 'og', OIDC_SCOPES: 'profile groups', OIDC_ALLOWED_GROUPS: 'a, b' }, { origin: 'https://gym.x' });
  assert.equal(c.enabled, true);
  assert.equal(c.issuer, ISS);
  assert.deepEqual(c.scopes, ['openid', 'profile', 'groups']);
  assert.equal(c.redirectUri, 'https://gym.x/api/oidc/callback');
  assert.equal(c.appBase, 'https://gym.x');
  assert.deepEqual(c.allowedGroups, ['a', 'b']);
  assert.equal(c.label, 'SSO');
  assert.equal(c.linkByEmail, false);
  const sub = oidcConfig({ OIDC_ISSUER: ISS, OIDC_CLIENT_ID: 'og', OIDC_REDIRECT_URI: 'https://x.y/gym/api/oidc/callback' }, { origin: 'https://x.y' });
  assert.equal(sub.appBase, 'https://x.y/gym');
  assert.equal(oidcConfig({ OIDC_ISSUER: ISS, OIDC_CLIENT_ID: 'og', OIDC_REDIRECT_URI: 'https://x.y/elsewhere' }, { origin: 'https://x.y' }).enabled, false);
});

const cfg = (env = {}) => oidcConfig({ OIDC_ISSUER: ISS, OIDC_CLIENT_ID: 'og', ...env }, { origin: 'https://gym.x' });
const claims = (over = {}) => ({ iss: ISS, sub: 's1', name: 'Ana', email: 'ana@x.ch', email_verified: true, groups: ['gym'], ...over });

test('decide: linked, created, refused by group, e-mail rules, invite-only', () => {
  const db = { users: [{ id: 'a', name: 'Ana', oidc: { iss: ISS, sub: 's1' } }, { id: 'b', name: 'Bo', email: 'bo@x.ch' }] };
  assert.equal(decide(db, claims(), cfg()).kind, 'existing');
  assert.deepEqual(decide(db, claims(), cfg({ OIDC_ALLOWED_GROUPS: 'other' })), { kind: 'refuse', code: 'group', user: db.users[0] });
  assert.equal(decide(db, claims({ sub: 's2', email: 'new@x.ch' }), cfg()).kind, 'create');
  assert.equal(decide(db, claims({ sub: 's2', email: 'bo@x.ch' }), cfg()).code, 'link-needed', 'linking by e-mail is off by default');
  assert.equal(decide(db, claims({ sub: 's2', email: 'bo@x.ch', email_verified: false }), cfg({ OIDC_EMAIL_LINKING: '1' })).code, 'link-needed');
  assert.equal(decide(db, claims({ sub: 's2', email: 'bo@x.ch', email_verified: undefined }), cfg({ OIDC_EMAIL_LINKING: '1' })).code, 'link-needed');
  assert.equal(decide(db, claims({ sub: 's2', email: 'bo@x.ch' }), cfg({ OIDC_EMAIL_LINKING: '1' })).kind, 'link');
  // An address already used by another linked identity is never moved over.
  assert.equal(decide({ users: [{ id: 'c', email: 'c@x.ch', oidc: { iss: ISS, sub: 'old' } }] }, claims({ sub: 'new', email: 'c@x.ch' }), cfg({ OIDC_EMAIL_LINKING: '1' })).code, 'link-needed');
  assert.equal(decide(db, claims({ sub: 's3', email: 'z@x.ch' }), cfg(), { inviteOnly: true }).code, 'invite');
  assert.equal(decide(db, claims({ sub: 's3', email: 'z@x.ch' }), cfg({ OIDC_ALLOWED_GROUPS: 'gym' }), { inviteOnly: true }).kind, 'create');
  const off = { users: [{ id: 'd', disabled: true, oidc: { iss: ISS, sub: 'dd' } }] };
  assert.equal(decide(off, claims({ sub: 'dd' }), cfg()).code, 'disabled');
});

test('access: groups claim by name or path, role map access, ungated means everyone', () => {
  assert.equal(accessOf(claims({ groups: [] }), cfg()).allowed, true);
  assert.equal(accessOf(claims({ groups: ['x'] }), cfg({ OIDC_ROLE_MAP: 'access=gym' })).allowed, false);
  const r = accessOf(claims({ groups: ['gym', 'ops'] }), cfg({ OIDC_ROLE_MAP: 'access=gym, admin=ops' }));
  assert.equal(r.allowed, true); assert.equal(r.roles.admin, true);
  const kc = cfg({ OIDC_GROUPS_CLAIM: 'realm_access.roles', OIDC_ALLOWED_GROUPS: 'gym' });
  assert.equal(accessOf({ realm_access: { roles: ['gym'] } }, kc).allowed, true);
  assert.equal(accessOf({ groups: 'gym' }, cfg({ OIDC_ALLOWED_GROUPS: 'gym' })).allowed, true, 'one group as a string');
  assert.equal(claimAt({ a: { b: 1 } }, 'a.b'), 1);
  assert.equal(claimAt({ 'https://x/groups': ['g'] }, 'https://x/groups')[0], 'g');
});

test('nameFor: the provider name, made unique, never empty', () => {
  const taken = new Set(['Ana', 'Ana 2']);
  assert.equal(nameFor({ name: 'Ana' }, n => taken.has(n)), 'Ana 3');
  assert.equal(nameFor({ preferred_username: 'bo' }, () => false), 'bo');
  assert.equal(nameFor({ email: 'cy@x.ch' }, () => false), 'cy');
  assert.equal(nameFor({}, () => false), 'Lifter');
  assert.equal(nameFor({ name: 'x'.repeat(80) }, () => false).length, 36);
});
