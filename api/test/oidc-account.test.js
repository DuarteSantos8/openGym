/* One count of every way into a profile -- passkeys, a password (only while PASSWORD_LOGIN is on)
 * and a linked identity (only while its own provider is still configured) -- read by every
 * removal route and shown by the account state a Settings screen renders from
 * (passkeyState(u).lastWayIn). Proven here against a real spawned server so the screen that
 * predicts a refusal and the route that enforces it are checked against the same server, not two
 * copies of the same claim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startProvider, startApi, softAuthenticator, stepUp, withPassword, mintSession } from './oidc-harness.mjs';

const USER = { id: 'u1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
const PW = 'correct horse battery staple';
const seededIdentity = (provider, over = {}) => ({
  iss: provider.base, sub: 'subject-1', userId: USER.id,
  email: null, linkedAt: '2026-01-01T00:00:00.000Z', ...over
});

/* ---------- the way-in matrix, with a drift guard against the routes that enforce it ---------- */

test('one passkey and nothing else: lastWayIn is true, and removing it is refused', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);

  const state = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(state.body.lastWayIn, true);

  const proof = await stepUp(h, key, cookie);
  const remove = await h.req('DELETE', `/api/account/passkeys?id=${encodeURIComponent(key.id)}`, { body: proof, cookie });
  assert.equal(remove.status, 409, 'the drift guard: lastWayIn said true, so the route must refuse');
  assert.equal(remove.body.code, 'last-way-in');
});

test('one passkey plus a linked identity: lastWayIn is false, and removing the passkey succeeds', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, {
    provider,
    db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const cookie = mintSession(h.secret, USER.id);

  const before = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(before.body.lastWayIn, false, 'the drift guard: the route below must then allow the removal');

  const proof = await stepUp(h, key, cookie);
  const remove = await h.req('DELETE', `/api/account/passkeys?id=${encodeURIComponent(key.id)}`, { body: proof, cookie });
  assert.equal(remove.status, 200);
  assert.equal(remove.body.lastWayIn, true, 'the identity is now the only way in');
  assert.equal(h.db().creds.length, 0);
});

test('a linked identity alone: lastWayIn is true', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const state = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(state.body.lastWayIn, true);
});

test('a password plus a linked identity, no passkey: lastWayIn is false, and removing the password succeeds', async t => {
  const provider = await startProvider(t);
  const user = { ...USER, pw: await withPassword(PW) };
  const h = await startApi(t, {
    provider, env: { PASSWORD_LOGIN: '1' },
    db: { users: [user], creds: [], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const cookie = mintSession(h.secret, user.id);

  const before = await h.req('GET', '/api/account/password', { cookie });
  assert.equal(before.body.identity, true, 'the account screen must be able to offer the identity as a proof of removing the password');

  const state = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(state.body.lastWayIn, false, 'the drift guard: the route below must then allow the removal');

  const remove = await h.req('DELETE', '/api/account/password', { body: { current: PW }, cookie });
  assert.equal(remove.status, 200);
  assert.equal(h.db().users[0].pw, undefined);
});

test('a password alone, no passkey and no identity linked: lastWayIn is true, and removing it is refused', async t => {
  const provider = await startProvider(t);
  const user = { ...USER, pw: await withPassword(PW) };
  const h = await startApi(t, { provider, env: { PASSWORD_LOGIN: '1' }, db: { users: [user], creds: [], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, user.id);

  const state = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(state.body.lastWayIn, true);

  const remove = await h.req('DELETE', '/api/account/password', { body: { current: PW }, cookie });
  assert.equal(remove.status, 409, 'the drift guard: lastWayIn said true, so the route must refuse');
  assert.equal(remove.body.code, 'last-way-in');
});

test('with the provider not configured, a stored identity is dormant and counts for nothing', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, {
    provider, env: { OIDC_ISSUER: '', OIDC_CLIENT_ID: '' },
    db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const cookie = mintSession(h.secret, USER.id);

  const state = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(state.body.lastWayIn, true, 'a dormant identity must not be counted as a way in');

  const proof = await stepUp(h, key, cookie);
  const remove = await h.req('DELETE', `/api/account/passkeys?id=${encodeURIComponent(key.id)}`, { body: proof, cookie });
  assert.equal(remove.status, 409, 'the drift guard: lastWayIn said true, so the route must refuse');
  assert.equal(remove.body.code, 'last-way-in');
});

/* ---------- what the account state shows of a linked identity ---------- */

test('GET /api/account/passkeys: identity is null when nothing is linked', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [USER], creds: [], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const state = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(state.body.identity, null);
});

test('GET /api/account/passkeys: a seeded identity reads the provider name, its address and when it was linked', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, {
    provider, env: { OIDC_NAME: 'Example ID' },
    db: { users: [USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider, { email: 'ana@example.com' })] }
  });
  const cookie = mintSession(h.secret, USER.id);
  const state = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.deepEqual(state.body.identity, { providerName: 'Example ID', email: 'ana@example.com', linkedAt: '2026-01-01T00:00:00.000Z', usable: true });
});

test('GET /api/account/passkeys: without OIDC_NAME the provider name is the issuer hostname', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, {
    provider,
    db: { users: [USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const cookie = mintSession(h.secret, USER.id);
  const state = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(state.body.identity.providerName, new URL(provider.base).hostname);
});

test('GET /api/account/passkeys: a stored null address reads back null, and the raw body names neither the subject nor the provider itself', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, {
    provider,
    db: { users: [USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider, { email: null })] }
  });
  const cookie = mintSession(h.secret, USER.id);
  const state = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(state.body.identity.email, null);
  const raw = JSON.stringify(state.body);
  assert.equal(raw.includes('subject-1'), false, 'the subject must never reach the client');
  assert.equal(raw.includes(provider.base), false, "the provider's own base address must never reach the client");
});

/* ---------- nothing identity-related leaks onto /api/me ---------- */

test('GET /api/me answers exactly what it always did -- nothing identity-related', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, {
    provider,
    db: { users: [USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const cookie = mintSession(h.secret, USER.id);
  const me = await h.req('GET', '/api/me', { cookie });
  assert.equal(me.status, 200);
  assert.deepEqual(Object.keys(me.body).sort(), ['user']);
  assert.deepEqual(Object.keys(me.body.user).sort(), ['admin', 'id', 'name']);
});

/* ---------- DELETE /api/account/identities: removing the linked identity ---------- */

test('DELETE /api/account/identities with no session answers not-signed-in, and writes nothing', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider)] } });
  const dbFile = path.join(h.dataDir, 'db.json');
  const before = fs.readFileSync(dbFile, 'utf8');
  const remove = await h.req('DELETE', '/api/account/identities', { body: {} });
  assert.equal(remove.status, 401);
  assert.equal(fs.readFileSync(dbFile, 'utf8'), before);
});

test('DELETE /api/account/identities for a profile with nothing linked answers not-linked, and writes nothing', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const dbFile = path.join(h.dataDir, 'db.json');
  const before = fs.readFileSync(dbFile, 'utf8');
  const remove = await h.req('DELETE', '/api/account/identities', { body: {}, cookie });
  assert.equal(remove.status, 404);
  assert.equal(remove.body.code, 'not-linked');
  assert.equal(fs.readFileSync(dbFile, 'utf8'), before);
});

test('DELETE /api/account/identities refuses the last way in before any proof, and audits nothing', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const dbFile = path.join(h.dataDir, 'db.json');
  const before = fs.readFileSync(dbFile, 'utf8');
  const remove = await h.req('DELETE', '/api/account/identities', { body: {}, cookie });
  assert.equal(remove.status, 409);
  assert.equal(remove.body.code, 'last-way-in');
  assert.equal(fs.readFileSync(dbFile, 'utf8'), before, 'a refusal the state already decides must write nothing');
  assert.equal(h.audit().some(r => r.ev === 'auth.proof.fail'), false, 'a refusal that never asks for a proof must never audit one failing');
});

test('DELETE /api/account/identities with a session alone (empty body) is refused a passkey-required, and writes nothing', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, {
    provider,
    db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const cookie = mintSession(h.secret, USER.id);
  const dbFile = path.join(h.dataDir, 'db.json');
  const before = fs.readFileSync(dbFile, 'utf8');
  const remove = await h.req('DELETE', '/api/account/identities', { body: {}, cookie });
  assert.equal(remove.status, 403);
  assert.equal(remove.body.code, 'passkey-required');
  assert.equal(fs.readFileSync(dbFile, 'utf8'), before);
});

test('DELETE /api/account/identities with a wrong passkey assertion is refused, and audits the failed proof against this change', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const wrong = softAuthenticator();
  const h = await startApi(t, {
    provider,
    db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const cookie = mintSession(h.secret, USER.id);
  const proof = await stepUp(h, wrong, cookie);
  const remove = await h.req('DELETE', '/api/account/identities', { body: proof, cookie });
  assert.equal(remove.status, 403);
  assert.equal(remove.body.code, 'passkey');
  const fail = h.audit().find(r => r.ev === 'auth.proof.fail');
  assert.ok(fail, 'the failed proof must be audited');
  assert.equal(fail.act, 'identity-remove');
  assert.equal(fail.msg, 'step-up-failed');
});

test('DELETE /api/account/identities with a good step-up removes the identity, leaves everything else untouched, and keeps the caller signed in', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const email = 'removal-address@example.com';
  const h = await startApi(t, {
    provider,
    db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [seededIdentity(provider, { email })] }
  });
  const stateFile = path.join(h.dataDir, `state-${USER.id}.json`);
  fs.writeFileSync(stateFile, JSON.stringify({ marker: 'seeded-profile-data' }));
  const stateBefore = fs.readFileSync(stateFile, 'utf8');
  const cookie = mintSession(h.secret, USER.id);

  const proof = await stepUp(h, key, cookie);
  const remove = await h.req('DELETE', '/api/account/identities', { body: proof, cookie });
  assert.equal(remove.status, 200);
  assert.equal(remove.body.ok, true);
  assert.equal(remove.body.identity, null, 'the account state answered back must show the identity gone');
  assert.equal(remove.cookies.length, 0, 'a removal must not touch the session at all');

  const db = h.db();
  assert.equal(db.identities.length, 0);
  assert.equal(db.creds.length, 1, 'the credential row must be untouched');
  assert.equal(db.creds[0].id, key.id);
  assert.deepEqual(db.users[0], USER, 'the user record must be untouched');
  assert.equal(fs.readFileSync(stateFile, 'utf8'), stateBefore, 'the state file must be untouched');

  const ok = h.audit().find(r => r.ev === 'auth.identity.remove');
  assert.ok(ok, 'the success must be recorded under its own event name');
  const raw = fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8');
  assert.equal(raw.includes('subject-1'), false, 'the subject must never reach the log');
  assert.equal(raw.includes(email), false, 'the address must never reach the log');
  assert.equal(raw.includes(provider.base), false, 'the issuer host must never reach the log');

  const me = await h.req('GET', '/api/me', { cookie });
  assert.equal(me.status, 200, 'the caller must still be signed in on the same cookie afterwards');
});

test('DELETE /api/account/identities never touches another profile\'s identity', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const other = { id: 'u2', name: 'Bea', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [USER, other], creds: [key.row(USER.id)], subs: [], invites: [],
      identities: [seededIdentity(provider), seededIdentity(provider, { userId: other.id, sub: 'subject-2' })]
    }
  });
  const cookie = mintSession(h.secret, USER.id);
  const proof = await stepUp(h, key, cookie);
  const remove = await h.req('DELETE', '/api/account/identities', { body: proof, cookie });
  assert.equal(remove.status, 200);
  const db = h.db();
  assert.equal(db.identities.length, 1, 'exactly one identity row must remain');
  assert.equal(db.identities[0].userId, other.id, "the other profile's own row must survive");
});

test('DELETE /api/account/identities from a cross-site request is refused by the origin check, and writes nothing', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, {
    provider,
    db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const cookie = mintSession(h.secret, USER.id);
  const dbFile = path.join(h.dataDir, 'db.json');
  const before = fs.readFileSync(dbFile, 'utf8');
  const proof = await stepUp(h, key, cookie);
  const remove = await h.req('DELETE', '/api/account/identities', { body: proof, cookie, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(remove.status, 403);
  assert.equal(remove.body.error, 'cross-origin request refused');
  assert.equal(fs.readFileSync(dbFile, 'utf8'), before, 'a request refused before the handler runs must write nothing');
});

test('with the provider not configured, its dormant identity is still removable with a proof', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, {
    provider, env: { OIDC_ISSUER: '', OIDC_CLIENT_ID: '' },
    db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const cookie = mintSession(h.secret, USER.id);
  const proof = await stepUp(h, key, cookie);
  const remove = await h.req('DELETE', '/api/account/identities', { body: proof, cookie });
  assert.equal(remove.status, 200);
  assert.equal(h.db().identities.length, 0);
});
