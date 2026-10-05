/* Proves three properties against a real spawned server and a real provider round
 * trip: the api/oidc/* modules run unchanged on this base, a sign-in through the provider mints
 * the exact session makeSession() mints (so "sign out everywhere" still ends it), and records in
 * their minimal stored shape -- an identity row { iss, sub, userId, email, linkedAt }, a
 * credential row with no name or created, a db.json with no key beyond
 * users/creds/subs/invites/identities -- are read, signed in with and listed unchanged, exactly
 * as an earlier build of this feature would have left them, with no migration step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startProvider, startApi, providerSignIn, softAuthenticator, stepUp, proofRoundTrip, mintSession } from './oidc-harness.mjs';

const SEEDED_USER = { id: 'seeded-user-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
const seededIdentity = (provider, over = {}) => ({
  iss: provider.base, sub: 'subject-1', userId: SEEDED_USER.id,
  email: null, linkedAt: '2026-01-01T00:00:00.000Z', ...over
});
const SEEDED_STATE = {
  unit: 'kg', lang: 'en', routines: [], week: {}, exWeights: {}, bodyweight: [], customEx: [], workouts: [], _ts: 1000, _rev: 1
};

test('a seeded identity signs in through the provider, lands on the app root with a session, and reads back its own data unchanged', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, {
    provider,
    db: { users: [SEEDED_USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider)] },
    states: { [SEEDED_USER.id]: SEEDED_STATE }
  });
  const dbFile = path.join(h.dataDir, 'db.json');
  const before = fs.readFileSync(dbFile, 'utf8');

  const { res, sessionCookie } = await providerSignIn(h, provider, { sub: 'subject-1' });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/', 'a known identity carries no fragment at all');
  assert.ok(sessionCookie, 'no session cookie was set');

  // Read back BEFORE any further request: GET /api/data below records a pull timestamp and would
  // otherwise make this comparison meaningless.
  const after = fs.readFileSync(dbFile, 'utf8');
  assert.equal(after, before, 'signing in through an identity this instance already knows must write nothing');

  const me = await h.req('GET', '/api/me', { cookie: sessionCookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, SEEDED_USER.id);
  assert.equal(me.body.user.name, SEEDED_USER.name);

  const data = await h.req('GET', '/api/data', { cookie: sessionCookie });
  assert.equal(data.status, 200);
  assert.deepEqual(data.body.state, SEEDED_STATE);
});

test('a seeded identity whose user is disabled answers account-disabled and sets no session cookie', async t => {
  const provider = await startProvider(t);
  const disabledUser = { ...SEEDED_USER, id: 'disabled-user-1', disabled: true };
  const h = await startApi(t, {
    provider,
    db: { users: [disabledUser], creds: [], subs: [], invites: [], identities: [seededIdentity(provider, { userId: disabledUser.id })] }
  });
  const { res, sessionCookie } = await providerSignIn(h, provider, { sub: 'subject-1' });
  assert.equal(res.fragment.get('err'), 'account-disabled');
  assert.equal(sessionCookie, null);
});

test('POST /api/logout/all ends a provider-minted session on its next request', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, {
    provider,
    db: { users: [SEEDED_USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const { sessionCookie } = await providerSignIn(h, provider, { sub: 'subject-1' });
  assert.ok(sessionCookie);

  const logoutAll = await h.req('POST', '/api/logout/all', { body: {}, cookie: sessionCookie });
  assert.equal(logoutAll.status, 200);

  const me = await h.req('GET', '/api/me', { cookie: sessionCookie });
  assert.equal(me.status, 401, 'the same cookie must stop working on the next request');
});

test('an unconfigured instance carries no oidc key at all, and passkey sign-in is unaffected', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env: { OIDC_ISSUER: '', OIDC_CLIENT_ID: '' }, db: { users: [], creds: [], subs: [], invites: [] } });
  const config = await h.req('GET', '/api/config');
  assert.equal(config.status, 200);
  assert.equal('oidc' in config.body, false);
  const health = await h.req('GET', '/api/health');
  assert.equal(health.status, 200);
});

/* ---------- passkeys in the minimal stored shape (no name, no created) ---------- */

test('a passkey row in the minimal stored shape signs in through /api/login/options + /api/login/verify', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [SEEDED_USER], creds: [key.row(SEEDED_USER.id)], subs: [], invites: [] } });
  const opts = await h.req('POST', '/api/login/options', { body: {} });
  const verify = await h.req('POST', '/api/login/verify', { body: { cid: opts.body.cid, credential: key.assertion(opts.body.options.challenge) } });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.user.id, SEEDED_USER.id);
});

test('a passkey row in the minimal stored shape is listed by GET /api/account/passkeys with name and created null', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [SEEDED_USER], creds: [key.row(SEEDED_USER.id)], subs: [], invites: [] } });
  const opts = await h.req('POST', '/api/login/options', { body: {} });
  const verify = await h.req('POST', '/api/login/verify', { body: { cid: opts.body.cid, credential: key.assertion(opts.body.options.challenge) } });
  const cookie = verify.headers.getSetCookie().find(c => c.startsWith('gymsid=') && !c.startsWith('gymsid=;')).split(';')[0];
  const list = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(list.status, 200);
  const row = list.body.passkeys.find(p => p.id === key.id);
  assert.ok(row, 'the minimal-shape row must still be listed');
  assert.equal(row.name, null);
  assert.equal(row.created, null);
});

test('a second passkey in the minimal stored shape is removed through DELETE /api/account/passkeys, stepping up with the first', async t => {
  const provider = await startProvider(t);
  const first = softAuthenticator();
  const second = softAuthenticator();
  const h = await startApi(t, {
    provider,
    db: { users: [SEEDED_USER], creds: [first.row(SEEDED_USER.id), second.row(SEEDED_USER.id)], subs: [], invites: [] }
  });
  const opts = await h.req('POST', '/api/login/options', { body: {} });
  const verify = await h.req('POST', '/api/login/verify', { body: { cid: opts.body.cid, credential: first.assertion(opts.body.options.challenge) } });
  const cookie = verify.headers.getSetCookie().find(c => c.startsWith('gymsid=') && !c.startsWith('gymsid=;')).split(';')[0];

  const proof = await stepUp(h, first, cookie);
  const remove = await h.req('DELETE', `/api/account/passkeys?id=${encodeURIComponent(second.id)}`, { body: proof, cookie });
  assert.equal(remove.status, 200);
  assert.equal(h.db().creds.some(c => c.id === second.id), false);
  assert.equal(h.db().creds.some(c => c.id === first.id), true, 'removing one passkey must not touch the other');
});

/* ---------- a provider-only profile from the earlier build moves onto a passkey ---------- */

test('a provider-only profile in the stored shape adds a passkey with a provider proof whose token carries no auth_time', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, {
    provider,
    db: { users: [SEEDED_USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider)] }
  });
  const { sessionCookie } = await providerSignIn(h, provider, { sub: 'subject-1' });
  assert.ok(sessionCookie, 'the seeded identity must sign in, or the case proves nothing');

  const { proofCookie, res } = await proofRoundTrip(h, provider, { cookie: sessionCookie, act: 'passkey-add' });
  assert.equal(res.location, '/#/settings?proof=ok');
  const key = softAuthenticator();
  const options = await h.req('POST', '/api/account/passkeys/options', { body: { identityProof: true }, cookie: `${sessionCookie}; ${proofCookie}` });
  assert.equal(options.status, 200);
  const verify = await h.req('POST', '/api/account/passkeys/verify', {
    body: { cid: options.body.cid, credential: key.attestation(options.body.options.challenge) }, cookie: sessionCookie
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.lastWayIn, false);
  assert.ok(h.db().creds.some(c => c.id === key.id && c.userId === SEEDED_USER.id));
});

/* ---------- a row from an issuer the instance no longer uses ---------- */

test('after OIDC_ISSUER moves to another issuer, a stored identity is not a way in: the last passkey stays, and the stale row can be removed', async t => {
  const previous = await startProvider(t);
  const current = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, {
    provider: current,
    db: { users: [SEEDED_USER], creds: [key.row(SEEDED_USER.id)], subs: [], invites: [], identities: [seededIdentity(previous)] }
  });
  const opts = await h.req('POST', '/api/login/options', { body: {} });
  const verify = await h.req('POST', '/api/login/verify', { body: { cid: opts.body.cid, credential: key.assertion(opts.body.options.challenge) } });
  const cookie = verify.headers.getSetCookie().find(c => c.startsWith('gymsid=') && !c.startsWith('gymsid=;')).split(';')[0];

  const state = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(state.body.identity.usable, false, 'a row from another issuer must not read as usable');
  assert.equal(state.body.identity.providerName, null, 'and must not carry the current provider\'s name');
  assert.equal(state.body.lastWayIn, true, 'the passkey is the only way in left');

  const removePasskey = await h.req('DELETE', `/api/account/passkeys?id=${encodeURIComponent(key.id)}`, { body: await stepUp(h, key, cookie), cookie });
  assert.equal(removePasskey.status, 409);
  assert.equal(removePasskey.body.code, 'last-way-in');
  assert.equal(h.db().creds.length, 1, 'the last passkey must stay');

  const ticket = await h.req('POST', '/api/account/identities/proof-ticket', { body: { act: 'passkey-remove' }, cookie });
  assert.equal(ticket.status, 409, 'a stale row can never be offered as a proof');
  assert.equal(ticket.body.code, 'not-linked');

  const removeIdentity = await h.req('DELETE', '/api/account/identities', { body: await stepUp(h, key, cookie), cookie });
  assert.equal(removeIdentity.status, 200);
  assert.equal(removeIdentity.body.identity, null);
  assert.equal(h.db().identities.length, 0);
});

/* ---------- identities whose profile is gone ---------- */

test('deleting a user through the admin route removes their identity, and that identity can start over as a new profile', async t => {
  const provider = await startProvider(t);
  const admin = { id: 'admin-1', name: 'Root', created: '2026-01-01T00:00:00.000Z', admin: true };
  const email = 'deleted-person@example.com';
  const h = await startApi(t, {
    provider,
    db: { users: [admin, SEEDED_USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider, { email })] }
  });
  const del = await h.req('POST', '/api/admin/user/delete', { body: { id: SEEDED_USER.id }, cookie: mintSession(h.secret, admin.id) });
  assert.equal(del.status, 200);
  assert.deepEqual(h.db().identities, [], 'the identity row must go with the profile');
  assert.equal(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8').includes(email), false, 'and so must the address it kept');

  const { res } = await providerSignIn(h, provider, { sub: 'subject-1' });
  assert.equal(res.fragment.get('oidc'), 'confirm', 'the identity is new again, not refused');
});

test('an identity row whose profile no longer exists is dropped at start-up, and that identity can start over as a new profile', async t => {
  const provider = await startProvider(t);
  const orphan = seededIdentity(provider, { userId: 'deleted-long-ago', email: 'orphan@example.com' });
  const h = await startApi(t, {
    provider,
    db: { users: [SEEDED_USER], creds: [], subs: [], invites: [], identities: [seededIdentity(provider, { sub: 'subject-2' }), orphan] }
  });
  assert.deepEqual(h.db().identities, [seededIdentity(provider, { sub: 'subject-2' })], 'only the orphan row is dropped');
  const { res } = await providerSignIn(h, provider, { sub: 'subject-1' });
  assert.equal(res.fragment.get('oidc'), 'confirm', 'the orphan identity is new again, not account-disabled');
});

test('a db.json whose identities hold null and garbage entries still starts, keeps the valid rows, and says only how many went', async t => {
  const provider = await startProvider(t);
  const valid = seededIdentity(provider, { email: 'kept@example.com' });
  const orphan = seededIdentity(provider, { sub: 'subject-orphan', userId: 'deleted-long-ago' });
  const h = await startApi(t, {
    provider,
    db: { users: [SEEDED_USER], creds: [], subs: [], invites: [], identities: [null, valid, 'garbage', 42, [], { iss: 7, sub: null }, orphan] }
  });
  assert.equal((await h.req('GET', '/api/config')).status, 200, 'the server must start');
  assert.deepEqual(h.db().identities, [valid], 'only the valid row is kept, and the clean-up is written');
  assert.match(h.log, /identity rows dropped at start-up: 1 without a profile, 5 malformed/);
  assert.equal(/subject-|kept@example\.com/.test(h.log), false, 'the log line carries counts only');
  const { sessionCookie } = await providerSignIn(h, provider, { sub: 'subject-1' });
  assert.ok(sessionCookie, 'the kept identity still signs in');
});

test('a db.json whose identities value is not a list still starts, with passkey sign-in and provider sign-in working', async t => {
  for (const identities of [{}, 'x', null]) {
    const provider = await startProvider(t);
    const h = await startApi(t, { provider, db: { users: [SEEDED_USER], creds: [], subs: [], invites: [], identities } });
    assert.equal((await h.req('POST', '/api/login/options', { body: {} })).status, 200, 'the server must start');
    assert.deepEqual(h.db().identities, identities, 'the unusable value is left as it was found');
    assert.doesNotMatch(h.log, /identity rows dropped at start-up/);
    const { res } = await providerSignIn(h, provider, { sub: 'subject-1' });
    assert.equal(res.fragment.get('oidc'), 'confirm', 'provider sign-in answers, as for an identity never linked');
  }
});

test('a db.json whose profile list cannot be read keeps every linked identity', async t => {
  const provider = await startProvider(t);
  const row = { iss: provider.base, sub: 'subject-1', userId: SEEDED_USER.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
  for (const users of [undefined, {}, 'x']) {
    const db = { creds: [], subs: [], invites: [], identities: [row] };
    if (users !== undefined) db.users = users;
    const h = await startApi(t, { provider, db });
    assert.equal((await h.req('POST', '/api/login/options', { body: {} })).status, 200, 'the server must start');
    assert.deepEqual(h.db().identities, [row], 'no row is judged orphaned against an unreadable profile list');
    assert.doesNotMatch(h.log, /identity rows dropped at start-up/);
  }
});
