/* The identity-token verifier, on its own - no provider, no network, no clock of its own.
 *
 * This is the file that decides whether an externally signed assertion of identity is allowed to
 * become a session on this instance, so the tests are written as the attacks and accidents it
 * exists to stop: a forged signature, a token minted for somebody else's client, a token from
 * another issuer, a replay of one captured earlier, an algorithm the caller never agreed to, and
 * an address the issuer never vouched for being passed on as though it had.
 *
 * Everything here is offline. The keys are generated in this process, the key set is a local one
 * built over their public halves, and the current time is passed in, so no case depends on the
 * machine's clock or on anything outside this file.
 *
 * The token-minting helper is deliberately local rather than shared: the common test scaffolding
 * exists for modules that resolve the data directory when they are imported, and the verifier
 * must never acquire that coupling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createLocalJWKSet, errors } from 'jose';

const { verifyIdToken } = await import('../oidc/verify.js');

const ISSUER = 'https://id.example.com';
const CLIENT_ID = 'opengym-at-example';
const NONCE = 'n-0S6_WzA2Mj';
/* One fixed instant, handed to every case, so nothing here can go flaky on a drifting clock or on
   a run that happens to cross a second boundary. */
const NOW = 1767225600000;
const T = Math.floor(NOW / 1000);

const rsa1 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsa2 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec1 = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

const pub = (kp, kid, alg) => ({ ...kp.publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig' });
/* Two signing keys of one kind and one of another, all published by the same issuer. Possession
   of ANY key the issuer publishes must not amount to possession of the one a given token names. */
const keys = createLocalJWKSet({ keys: [pub(rsa1, 'k1', 'RS256'), pub(rsa2, 'k2', 'RS256'), pub(ec1, 'e1', 'ES256')] });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

/* A claim set given as `undefined` is dropped by serialisation, which is how the cases below say
   "this token carries no subject" without a second factory. */
const claims = over => ({ iss: ISSUER, sub: 'subject-one', aud: CLIENT_ID, nonce: NONCE, iat: T, exp: T + 300, ...over });

/* `dsaEncoding: 'ieee-p1363'` is not optional. A JWS elliptic signature is the raw r||s pair,
   while the platform's default output is the DER structure, and the mismatch surfaces only as a
   bare "signature verification failed" with nothing to point at. */
function mint({ over = {}, kid = 'k1', alg = 'RS256', priv = rsa1.privateKey } = {}) {
  const h = b64({ alg, typ: 'JWT', kid }), p = b64(claims(over));
  if (alg === 'none') return h + '.' + p + '.';
  if (alg.startsWith('HS')) return h + '.' + p + '.' + crypto.createHmac('sha' + alg.slice(2), priv).update(h + '.' + p).digest('base64url');
  const key = alg.startsWith('ES') ? { key: priv, dsaEncoding: 'ieee-p1363' } : priv;
  return h + '.' + p + '.' + crypto.sign('sha' + alg.slice(2), Buffer.from(h + '.' + p), key).toString('base64url');
}

const verify = (token, over = {}) => verifyIdToken(token, { keys, issuer: ISSUER, clientId: CLIENT_ID, nonce: NONCE, now: NOW, ...over });

/* Assert the reason and not only the refusal: a case refused for the wrong reason would stay
   green after the check it exists to guard had been deleted. */
const because = expected => e => {
  assert.ok(e.message.includes(expected), `expected a refusal mentioning ${expected}, got: ${e.message}`);
  return true;
};

/* base64url spells the last two alphabet positions '-' and '_' where standard base64 spells them
   '+' and '/'. A signature containing neither would make the standard-base64 re-spelling
   byte-identical to the original and the case would pass for the wrong reason, so mint until one
   does rather than trusting a freshly generated key to produce one. */
function mintWithReSpellableSignature() {
  for (let i = 0; i < 200; i++) {
    const token = mint({ over: { jti: 'filler-' + i } });
    const sig = token.split('.')[2];
    if (sig.includes('-') && sig.includes('_')) return token;
  }
  throw new Error('no signature carrying both base64url-specific characters after 200 attempts');
}

/** Every string reachable anywhere on a value, however deeply nested. */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/* ---------- accepted ---------- */

test('a genuine token from the configured issuer is accepted, on either kind of signing key', async () => {
  const rs = await verify(mint());
  assert.equal(rs.iss, ISSUER);
  assert.equal(rs.sub, 'subject-one');

  const es = await verify(mint({ kid: 'e1', alg: 'ES256', priv: ec1.privateKey }));
  assert.equal(es.iss, ISSUER);
  assert.equal(es.sub, 'subject-one');
});

test('a token that expired a minute ago is accepted, because a self-hosted clock drifts either way', async () => {
  const r = await verify(mint({ over: { iat: T - 120, exp: T - 60 } }));
  assert.equal(r.sub, 'subject-one');
});

test('an extra audience is accepted only when the authorized party names this client', async () => {
  const r = await verify(mint({ over: { aud: [CLIENT_ID, 'some-other-client'], azp: CLIENT_ID } }));
  assert.equal(r.sub, 'subject-one');
});

/* ---------- refused: signature and algorithm ---------- */

test('a signature with one bit flipped is refused', async () => {
  const [h, p, sig] = mint().split('.');
  const bytes = Buffer.from(sig, 'base64url');
  bytes[0] ^= 1;
  await assert.rejects(verify([h, p, bytes.toString('base64url')].join('.')), because('ERR_JWS_SIGNATURE_VERIFICATION_FAILED'));
});

test('a sibling key of the same issuer cannot sign for the key a token names', async () => {
  await assert.rejects(verify(mint({ kid: 'k1', priv: rsa2.privateKey })), because('ERR_JWS_SIGNATURE_VERIFICATION_FAILED'));
});

test('an unsigned token declaring no algorithm is refused', async () => {
  await assert.rejects(verify(mint({ alg: 'none' })), because('ERR_JOSE_ALG_NOT_ALLOWED'));
});

test('a symmetric algorithm is refused by the allowlist, not left to the signature check', async () => {
  /* The specification makes the client secret the key for a symmetric algorithm, so a token the
     attacker signs with a value the issuer publishes must never get as far as being compared. */
  const secret = rsa1.publicKey.export({ type: 'spki', format: 'pem' });
  await assert.rejects(verify(mint({ alg: 'HS256', priv: secret })), because('ERR_JOSE_ALG_NOT_ALLOWED'));
});

test('a token naming a key the issuer does not publish is refused', async () => {
  await assert.rejects(verify(mint({ kid: 'nobody-has-this-key' })), because('no signing key at the provider matches this token'));
});

test('a non-canonical re-spelling of a valid signature is refused, so one token cannot have many string forms', async () => {
  const token = mintWithReSpellableSignature();
  await assert.doesNotReject(verify(token), 'the canonical spelling of this signature must itself be valid');
  const [h, p, sig] = token.split('.');
  for (const respelt of [sig + '=', sig + '!', sig.replace(/-/g, '+').replace(/_/g, '/')]) {
    await assert.rejects(verify([h, p, respelt].join('.')), because('ERR_JWS_INVALID'));
  }
});

/* ---------- refused: claims ---------- */

test('another issuer is refused, and so is this issuer spelt the way some providers name themselves', async () => {
  await assert.rejects(verify(mint({ over: { iss: 'https://evil.example.com' } })), because('ERR_JWT_CLAIM_VALIDATION_FAILED'));
  /* A bare host is a real provider's own legacy spelling of its issuer. It is refused with no
     special case, because an issuer check relaxed for one provider is the exception that becomes
     a vulnerability three refactors later. */
  await assert.rejects(verify(mint({ over: { iss: 'id.example.com' } })), because('ERR_JWT_CLAIM_VALIDATION_FAILED'));
});

test('a token minted for another client at the same issuer is refused', async () => {
  await assert.rejects(verify(mint({ over: { aud: 'someone-elses-client' } })), because('ERR_JWT_CLAIM_VALIDATION_FAILED'));
});

test('an extra untrusted audience with no authorized party is refused, because membership is not validation', async () => {
  await assert.rejects(verify(mint({ over: { aud: [CLIENT_ID, 'some-other-client'] } })), because('names other audiences'));
  await assert.rejects(verify(mint({ over: { aud: [CLIENT_ID, 'some-other-client'], azp: 'some-other-client' } })), because('names other audiences'));
});

test('an authorized party naming another client is refused even when this client is the only audience', async () => {
  /* Membership in the audience is not the whole answer: a provider that minted the token for a
     different client at the same issuer records that client as the authorized party, and a token
     whose sole audience is this instance is exactly the shape that check has to catch. */
  await assert.rejects(verify(mint({ over: { aud: CLIENT_ID, azp: 'some-other-client' } })), because('issued to another client'));
  await assert.rejects(verify(mint({ over: { aud: [CLIENT_ID], azp: 'some-other-client' } })), because('issued to another client'));
});

test('an authorized party naming this client is accepted, single audience or not', async () => {
  assert.equal((await verify(mint({ over: { aud: CLIENT_ID, azp: CLIENT_ID } }))).sub, 'subject-one');
  assert.equal((await verify(mint({ over: { aud: [CLIENT_ID], azp: CLIENT_ID } }))).sub, 'subject-one');
});

test('a token that expired five minutes ago is refused', async () => {
  await assert.rejects(verify(mint({ over: { iat: T - 350, exp: T - 300 } })), because('the sign-in took too long'));
});

test('a token issued ten minutes in the future is refused', async () => {
  /* Without a maximum token age the library does not look at the issued-at claim at all, so this
     case is the one that proves the bound is set. */
  await assert.rejects(verify(mint({ over: { iat: T + 600, exp: T + 900 } })), because('ERR_JWT_CLAIM_VALIDATION_FAILED'));
});

test('a token that does not answer this sign-in attempt is refused, whether its nonce is wrong or absent', async () => {
  await assert.rejects(verify(mint({ over: { nonce: 'a-nonce-from-some-other-attempt' } })), because('does not answer this sign-in attempt'));
  await assert.rejects(verify(mint({ over: { nonce: undefined } })), because('does not answer this sign-in attempt'));
});

test('a caller that supplies no nonce is refused before the token is examined, so an absent expectation cannot match an absent claim', async () => {
  const token = mint({ over: { nonce: undefined } });
  for (const supplied of [undefined, null, '', '   ', 0, {}]) {
    await assert.rejects(verify(token, { nonce: supplied }), because('a nonce is required'));
  }
  /* The same answer for a string that is not a token at all: nothing was parsed to reach it. */
  await assert.rejects(verify('not-a-token-in-any-sense', { nonce: undefined }), because('a nonce is required'));
});

test('a token with no subject is refused', async () => {
  await assert.rejects(verify(mint({ over: { sub: undefined } })), because('ERR_JWT_CLAIM_VALIDATION_FAILED'));
});

test('a subject that is not a usable string is refused, not turned into the identity handle', async () => {
  /* The identity handle is built from this value. A number and its decimal spelling collapse into
     one identity, an object becomes a handle every such token shares, and an empty string leaves
     a handle that is just the issuer. */
  for (const sub of [12345, { a: 1 }, ['s1'], true, '']) {
    await assert.rejects(verify(mint({ over: { sub } })), because('no usable subject'), `sub ${JSON.stringify(sub)} became an identity`);
  }
});

test('a structurally malformed token is refused', async () => {
  await assert.rejects(verify('not.a.token'), because('ERR_JWS_INVALID'));
});

test('no refusal repeats the token back, so a rejected credential does not travel into the logs', async () => {
  const refused = [
    mint({ over: { iss: 'https://evil.example.com' } }),
    mint({ over: { aud: 'someone-elses-client' } }),
    mint({ over: { nonce: 'a-nonce-from-some-other-attempt' } }),
    mint({ over: { iat: T - 350, exp: T - 300 } }),
    mint({ kid: 'nobody-has-this-key' }),
    mint({ alg: 'none' }),
    mint({ kid: 'k1', priv: rsa2.privateKey })
  ];
  for (const token of refused) {
    const e = await verify(token).then(() => null, err => err);
    assert.ok(e, 'this token was supposed to be refused');
    assert.ok(!e.message.includes(token), 'the whole token is in the refusal message');
    for (const part of token.split('.')) {
      if (part.length > 8) assert.ok(!e.message.includes(part), 'part of the token is in the refusal message');
    }
  }
});

test('a provider that cannot be read is reported as an outage and never as a bad token', async () => {
  /* During an outage the key resolver is what fails, and calling that "the identity token did not
     verify" points whoever reads it at the token and the client registration for a fault that is
     a network away. */
  const timeout = () => { throw new errors.JWKSTimeout(); };
  await assert.rejects(verify(mint(), { keys: timeout }), because('did not answer in time'));

  /* An error with no code has no verdict to report, and interpolating the absent field renders as
     the literal text "(undefined)". */
  const broken = () => { throw new Error('socket hang up'); };
  const e = await verify(mint(), { keys: broken }).then(() => null, err => err);
  assert.ok(e, 'a resolver that throws must not produce a verified identity');
  assert.ok(!e.message.includes('undefined'), `an absent field was interpolated: ${e.message}`);
  assert.ok(e.message.includes('could not be checked'), `expected an unreadable-provider sentence, got: ${e.message}`);
});

/* ---------- the shape of the answer ---------- */

test('the answer is exactly the issuer, the subject, a vouched-for address and the remaining claims', async () => {
  const r = await verify(mint());
  assert.deepEqual(Object.keys(r).sort(), ['claims', 'email', 'iss', 'sub']);
  /* The identity handle is the PAIR. A subject handed back with no issuer beside it would let a
     second provider, configured later, collide with the first with nothing to notice it. */
  assert.equal(r.iss, ISSUER);
  assert.equal(r.sub, 'subject-one');
  assert.equal(r.claims.iss, ISSUER);
  assert.equal(r.claims.sub, 'subject-one');
});

test('an address the issuer has not marked verified is absent from the answer, not present under a second name', async () => {
  const address = 'someone@example.com';
  for (const over of [{ email: address, email_verified: false }, { email: address }, { email: address, email_verified: 'true' }]) {
    const r = await verify(mint({ over }));
    assert.equal(r.email, null, 'an unverified address is absent, not a weaker truth');
    assert.ok(!strings(r).includes(address), 'the address is still reachable somewhere on the returned value');
    assert.ok(!JSON.stringify(r).includes(address), 'the address survives serialisation of the returned value');
  }
});

test('the returned claims carry the display claims and neither raw email claim, verified or not', async () => {
  for (const verified of [true, false]) {
    const r = await verify(mint({
      over: {
        email: 'someone@example.com', email_verified: verified,
        name: 'Someone Example', preferred_username: 'someone', picture: 'https://id.example.com/someone.png'
      }
    }));
    assert.equal('email' in r.claims, false, 'the dedicated field must be the only way to reach an address');
    assert.equal('email_verified' in r.claims, false);
    assert.equal(r.claims.name, 'Someone Example');
    assert.equal(r.claims.preferred_username, 'someone');
    assert.equal(r.claims.picture, 'https://id.example.com/someone.png');
  }
});

test('a verified address is reported through the dedicated field, and two subjects sharing one address stay two identities', async () => {
  const address = 'shared@example.com';
  const a = await verify(mint({ over: { sub: 'subject-one', email: address, email_verified: true } }));
  const b = await verify(mint({ over: { sub: 'subject-two', email: address, email_verified: true } }));
  assert.equal(a.email, address);
  assert.equal(b.email, address);
  assert.equal(a.iss, b.iss);
  assert.notEqual(a.sub, b.sub, 'an address is profile data and never an identity');
});

test('the module exports exactly the verifier and the freshness classifier, so no lookup keyed on an address can be added quietly', async () => {
  const mod = await import('../oidc/verify.js');
  assert.deepEqual(Object.keys(mod), ['signInFreshness', 'verifyIdToken']);
  assert.equal(typeof mod.verifyIdToken, 'function');
  assert.equal(typeof mod.signInFreshness, 'function');
});

/* ---------- signInFreshness: when the issuer says the sign-in happened ---------- */

const { signInFreshness } = await import('../oidc/verify.js');

/* The departure is the instant the browser left for the provider, in epoch seconds. Placed well
   before NOW so a sign-in reported between the two is ordinary, and one reported after NOW is a
   clock that has run ahead. */
const DEPARTED = T - 60;
const fresh = (claimsIn, over = {}) => signInFreshness(claimsIn, { authAfter: DEPARTED, now: NOW, ...over });

test('a token with or without auth_time verifies exactly as before, and the claim is passed through only when sent', async () => {
  const withIt = await verify(mint({ over: { auth_time: T - 30 } }));
  assert.equal(withIt.sub, 'subject-one');
  assert.equal(withIt.claims.auth_time, T - 30);
  const without = await verify(mint());
  assert.equal(without.sub, 'subject-one');
  assert.equal('auth_time' in without.claims, false, 'an issuer that sends no auth_time must not appear to have sent one');
});

test('no auth_time claim at all is unreported, never fresh and never stale', () => {
  assert.equal(fresh({}), 'unreported');
  assert.equal(fresh({ iss: ISSUER, sub: 'subject-one', iat: T }), 'unreported');
});

test('a sign-in reported after the departure is fresh', () => {
  assert.equal(fresh({ auth_time: DEPARTED + 5 }), 'fresh');
  assert.equal(fresh({ auth_time: T }), 'fresh');
});

test('a sign-in reported up to the clock skew before the departure is still fresh, and one beyond it is stale', () => {
  assert.equal(fresh({ auth_time: DEPARTED - 119 }), 'fresh');
  assert.equal(fresh({ auth_time: DEPARTED - 120 }), 'fresh');
  assert.equal(fresh({ auth_time: DEPARTED - 121 }), 'stale');
  assert.equal(fresh({ auth_time: DEPARTED - 86400 }), 'stale', 'a provider session from yesterday is not a sign-in for this request');
});

test('a sign-in reported further in the future than the clock skew is stale', () => {
  assert.equal(fresh({ auth_time: T + 120 }), 'fresh');
  assert.equal(fresh({ auth_time: T + 121 }), 'stale');
});

test('an auth_time that is present but not a usable time is stale, never unreported', () => {
  for (const auth_time of [String(DEPARTED + 5), null, NaN, Infinity, -Infinity, true, {}, [DEPARTED + 5]]) {
    assert.equal(fresh({ auth_time }), 'stale', `auth_time ${String(auth_time)} must not skip the rule`);
  }
});

test('a missing or unusable departure time throws rather than answering', () => {
  for (const authAfter of [undefined, null, NaN, Infinity, String(DEPARTED)]) {
    assert.throws(() => signInFreshness({ auth_time: DEPARTED + 5 }, { authAfter, now: NOW }));
    assert.throws(() => signInFreshness({}, { authAfter, now: NOW }));
  }
  assert.throws(() => signInFreshness({ auth_time: DEPARTED + 5 }));
});

test('the classifier leaves the claims it reads untouched', () => {
  const claimsIn = Object.freeze({ auth_time: DEPARTED + 5, sub: 'subject-one' });
  assert.equal(fresh(claimsIn), 'fresh');
  assert.deepEqual(claimsIn, { auth_time: DEPARTED + 5, sub: 'subject-one' });
});
