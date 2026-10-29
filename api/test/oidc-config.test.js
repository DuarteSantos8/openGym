/* The OIDC environment contract, written as the two failures it exists to prevent.
 *
 * The first is an instance that offers a sign-in path it cannot complete: a half-set block of
 * variables that reads as "on" in one place and as "missing" in another, so a visitor is handed a
 * button that dead-ends at the provider. The second is quieter and worse to live with: an
 * operator who filled in every value, restarted, and got neither a button nor a sentence saying
 * which value was wrong. So every case here pins one of exactly three answers -- off, off with
 * the variable at fault named, or on -- and the refusals are read as strings, because for a
 * feature configured by hand the string IS the feature.
 *
 * The client secret is the one value that may never appear in a return value or in an error. That
 * is asserted over serialized output rather than field by field, so a field added to the result
 * later cannot slip past these tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mod = await import('../oidc/config.js');
const { readConfig, publicConfig, allowsPlainHttp } = mod;

/* Distinctive on purpose: the "never echoed" assertions are substring checks, and a short secret
   would pass them by coincidence rather than by design. */
const SECRET = 'oidc-client-secret-9f3a-never-echoed';

/* One fixture. Every case below is one line of difference from it. ORIGIN rides along with the
   OIDC_ variables because the redirect URI default is derived from it, and this module inherits
   nothing from the server's own fallback for the same variable. */
const FULL = Object.freeze({
  ORIGIN: 'https://gym.example.com',
  OIDC_ISSUER: 'https://id.example.com',
  OIDC_CLIENT_ID: 'opengym',
  OIDC_CLIENT_SECRET: SECRET
});

/** The fixture with overrides applied; an override of undefined removes the variable entirely. */
const env = (over = {}) => {
  const e = { ...FULL, ...over };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
};

/* ---------- off, with nothing to report ---------- */

test('an environment with no OIDC variable at all reports the feature off and carries no error, because an instance nobody configured must not be told about a feature it does not have', () => {
  const r = readConfig({ env: {} });
  assert.equal(r.on, false);
  assert.equal(r.error, undefined, 'silence, not a complaint: there is nothing here to have got wrong');
});

test('an environment with no OIDC variable at all yields a null public configuration, so no client can branch on a key that is not there', () => {
  assert.equal(publicConfig({ env: {} }), null);
});

/* ---------- off, with the variable at fault named ---------- */

const REFUSALS = [
  {
    name: 'a client id set without an issuer reports off and names OIDC_ISSUER, rather than guessing which provider was meant',
    over: { OIDC_ISSUER: undefined },
    names: [/OIDC_ISSUER/]
  },
  {
    name: 'an issuer set without a client id reports off and names OIDC_CLIENT_ID, rather than starting a flow no provider would recognise',
    over: { OIDC_CLIENT_ID: undefined },
    names: [/OIDC_CLIENT_ID/]
  },
  {
    name: 'an issuer with a trailing slash is refused and the error says the value is compared against what the provider calls itself, rather than being silently stripped here',
    over: { OIDC_ISSUER: 'https://id.example.com/' },
    names: [/OIDC_ISSUER/, /calls itself/]
  },
  {
    name: 'plain http on a host that is not local is refused and names OIDC_ISSUER, rather than being accepted because it parses',
    over: { OIDC_ISSUER: 'http://id.example.com' },
    names: [/OIDC_ISSUER/]
  },
  {
    name: 'an issuer carrying a username is refused and names OIDC_ISSUER, rather than being treated as a credential the client may reuse',
    over: { OIDC_ISSUER: 'https://someone@id.example.com' },
    names: [/OIDC_ISSUER/]
  },
  {
    name: 'an issuer carrying a username and password is refused and names OIDC_ISSUER, because a credential in a URL is one that ends up in a log',
    over: { OIDC_ISSUER: 'https://someone:hunter2@id.example.com' },
    names: [/OIDC_ISSUER/]
  },
  {
    name: 'an issuer carrying a query string is refused and names OIDC_ISSUER, because the discovery path is appended to it and a query would land in the wrong place',
    over: { OIDC_ISSUER: 'https://id.example.com?realm=gym' },
    names: [/OIDC_ISSUER/]
  },
  {
    name: 'an issuer carrying a fragment is refused and names OIDC_ISSUER, rather than being accepted with a part no server ever sees',
    over: { OIDC_ISSUER: 'https://id.example.com#gym' },
    names: [/OIDC_ISSUER/]
  },
  {
    name: 'a value that is not a parseable URL is refused and names OIDC_ISSUER, rather than failing later as an unreachable host',
    over: { OIDC_ISSUER: 'id.example.com' },
    names: [/OIDC_ISSUER/]
  },
  {
    name: 'a scopes value that omits openid is refused and names OIDC_SCOPES, because without it the provider returns no identity token at all',
    over: { OIDC_SCOPES: 'profile email' },
    names: [/OIDC_SCOPES/]
  },
  {
    name: 'an explicit redirect URI whose origin differs from ORIGIN is refused and names both OIDC_REDIRECT_URI and ORIGIN, rather than sending the browser to an address this instance does not answer on',
    over: { OIDC_REDIRECT_URI: 'https://other.example.com/api/oidc/callback' },
    names: [/OIDC_REDIRECT_URI/, /ORIGIN/]
  },
  {
    name: 'an explicit redirect URI that is not a parseable URL is refused and names OIDC_REDIRECT_URI',
    over: { OIDC_REDIRECT_URI: 'callback' },
    names: [/OIDC_REDIRECT_URI/]
  },
  /* The redirect URI is echoed into error strings, sent to the provider and is where the
     authorization code is delivered, so it gets the same treatment the issuer gets rather than a
     same-origin test alone. */
  {
    name: 'an explicit redirect URI carrying a username and password is refused and names OIDC_REDIRECT_URI, because a credential in a URL is one that ends up in a log',
    over: { OIDC_REDIRECT_URI: 'https://someone:hunter2@gym.example.com/api/oidc/callback' },
    names: [/OIDC_REDIRECT_URI/]
  },
  {
    name: 'an explicit redirect URI carrying a fragment is refused and names OIDC_REDIRECT_URI, because a redirection endpoint is registered without one and a browser never sends a fragment to a server',
    over: { OIDC_REDIRECT_URI: 'https://gym.example.com/api/oidc/callback#x' },
    names: [/OIDC_REDIRECT_URI/]
  },
  {
    name: 'an otherwise complete block with ORIGIN unset is refused and names ORIGIN, rather than reporting the feature on with a redirect URI derived from an absent value',
    over: { ORIGIN: undefined },
    names: [/ORIGIN/]
  },
  {
    name: 'the same block with ORIGIN set to an empty string is refused the same way, so a variable that is present but blank is not treated as present',
    over: { ORIGIN: '' },
    names: [/ORIGIN/]
  },
  {
    name: 'an ORIGIN that is not a parseable URL is refused and names ORIGIN, because the redirect URI is built from its origin',
    over: { ORIGIN: 'gym.example.com' },
    names: [/ORIGIN/]
  },
  /* A value that PARSES but has no origin is the dangerous half of the same mistake: .origin
     yields the literal string "null", so reading it through reports the feature on with a
     redirect URI of "null/api/oidc/callback", and the same-origin comparison that guards an
     explicit redirect URI becomes 'null' against 'null' and passes anything opaque. */
  {
    name: 'an ORIGIN that parses but has no origin at all is refused and names ORIGIN, rather than deriving an address from the literal string "null"',
    over: { ORIGIN: 'javascript:alert(1)' },
    names: [/ORIGIN/]
  },
  {
    name: 'a file URL in ORIGIN is refused and names ORIGIN, because there is no address there to send a browser back to',
    over: { ORIGIN: 'file:///etc' },
    names: [/ORIGIN/]
  },
  {
    name: 'a mailto URL in ORIGIN is refused and names ORIGIN, for the same reason',
    over: { ORIGIN: 'mailto:someone@example.com' },
    names: [/ORIGIN/]
  },
  {
    name: 'an opaque ORIGIN alongside an opaque explicit redirect URI is refused, so the same-origin guard is never asked to compare two values that are both "null"',
    over: { ORIGIN: 'javascript:alert(1)', OIDC_REDIRECT_URI: 'javascript:evil()' },
    names: [/ORIGIN/]
  },
  {
    name: 'plain http on a host that is not local is refused in ORIGIN too, because the authorization code is delivered to an address derived from it',
    over: { ORIGIN: 'http://gym.example.com' },
    names: [/ORIGIN/]
  }
];

for (const c of REFUSALS) {
  test(c.name, () => {
    const r = readConfig({ env: env(c.over) });
    assert.equal(r.on, false, 'a half-set or malformed block is off, never partly on');
    assert.equal(typeof r.error, 'string', 'off for a reason always carries the reason');
    for (const re of c.names) assert.match(r.error, re, 'the sentence names what the operator has to go and change');
    assert.equal(publicConfig({ env: env(c.over) }), null, 'a misconfigured block offers no provider to any client');
  });
}

test('every refusal points the reader at the self-hosting documentation, because a named variable with no manual behind it is half an answer', () => {
  for (const c of REFUSALS) {
    const r = readConfig({ env: env(c.over) });
    assert.match(r.error, /docs\/SELF_HOSTING\.md/, `no documentation pointer in: ${r.error}`);
  }
});

test('the documentation those refusals point at actually describes every variable they can name', () => {
  /* Asserting the pointer exists cannot notice that its target is empty, and a sentence sending
     an operator to a manual that never mentions the variable is worse than no sentence at all. */
  const manual = fs.readFileSync(new URL('../../docs/SELF_HOSTING.md', import.meta.url), 'utf8');
  const sample = fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  for (const name of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_SCOPES', 'OIDC_NAME']) {
    assert.ok(manual.includes(name), `${name} is refused by name but never documented`);
    assert.ok(sample.includes(name), `${name} has no line in the sample environment file`);
  }
  /* ORIGIN is not an OIDC_ variable but becomes required by one, which is the connection an
     operator reading about either has no other way to find. */
  assert.match(manual, /ORIGIN/, 'the ORIGIN requirement is not documented');
});

test('a credential in the redirect URI is refused without the value being echoed back, the way the issuer check does it', () => {
  const r = readConfig({ env: env({ OIDC_REDIRECT_URI: 'https://someone:hunter2@gym.example.com/api/oidc/callback' }) });
  assert.equal(r.on, false);
  assert.ok(!r.error.includes('hunter2'), `the credential travelled into the refusal: ${r.error}`);
});

test('no refusal echoes the client secret, even though the fixture sets one in every case', () => {
  for (const c of REFUSALS) {
    const r = readConfig({ env: env(c.over) });
    assert.ok(!r.error.includes(SECRET), `the secret leaked into: ${r.error}`);
    assert.ok(!JSON.stringify(r).includes(SECRET), 'the secret leaked into a refusal result object');
  }
});

test('the ORIGIN refusal reports off rather than on with a redirect URI reading "undefined", which is the silent half-enabled state this module exists to make impossible', () => {
  const r = readConfig({ env: env({ ORIGIN: undefined }) });
  assert.equal(r.on, false);
  assert.equal(r.redirectUri, undefined, 'nothing is derived from a value that is not there');
  assert.ok(!r.error.includes('undefined'), `an absent value was read through instead of refused: ${r.error}`);
});

test('no refusal for a value that parses but has no origin ever reports the feature on, and none of them derives an address reading "null"', () => {
  for (const bad of ['javascript:alert(1)', 'file:///etc', 'mailto:someone@example.com', 'data:text/html,x']) {
    const r = readConfig({ env: env({ ORIGIN: bad }) });
    assert.equal(r.on, false, `${bad} half-enabled the feature`);
    assert.equal(r.redirectUri, undefined, 'nothing is derived from a value with no origin');
    assert.ok(!String(r.error).includes('null/api/oidc/callback'), 'the literal string "null" was read through as an address');
  }
  /* And the explicit redirect URI cannot ride in on the same hole: two opaque values compare
     equal as strings, so the guard has to be unreachable rather than merely usually right. */
  const r = readConfig({ env: env({ ORIGIN: 'javascript:a', OIDC_REDIRECT_URI: 'javascript:evil()' }) });
  assert.equal(r.on, false);
  assert.equal(r.redirectUri, undefined);
});

/* ---------- on ---------- */

test('a complete environment reports the feature on and the public configuration carries a label', () => {
  const r = readConfig({ env: env() });
  assert.equal(r.on, true);
  assert.equal(r.issuer, 'https://id.example.com');
  assert.equal(r.clientId, 'opengym');
  assert.deepEqual(publicConfig({ env: env() }), { name: 'id.example.com' }, 'a label and nothing else: no issuer, no client id, no secret');
});

test('plain http is accepted on localhost, on 127.0.0.1 and on [::1], because a browser treats those as a secure context without TLS and the project already makes that carve-out', () => {
  for (const host of ['localhost:9000', '127.0.0.1:9000', '[::1]:9000']) {
    const issuer = `http://${host}`;
    assert.equal(allowsPlainHttp(new URL(issuer)), true, `${host} is a secure context without TLS`);
    const r = readConfig({ env: env({ OIDC_ISSUER: issuer, ORIGIN: 'http://localhost:8080' }) });
    assert.equal(r.on, true, `a local issuer at ${host} is usable for a local checkout`);
  }
  assert.equal(allowsPlainHttp(new URL('http://id.example.com')), false, 'the carve-out is the three local hosts, not "http anywhere"');
});

test('an issuer with a path component keeps the path, because the well-known path is appended to the issuer rather than replacing it', () => {
  const r = readConfig({ env: env({ OIDC_ISSUER: 'https://id.example.com/realms/gym' }) });
  assert.equal(r.on, true);
  assert.equal(r.issuer, 'https://id.example.com/realms/gym', 'byte for byte what the operator wrote');
});

test('a configuration with no client secret still reports on, with the secret reported as absent rather than empty, because a public client authenticates with PKCE alone', () => {
  const r = readConfig({ env: env({ OIDC_CLIENT_SECRET: undefined }) });
  assert.equal(r.on, true);
  assert.equal(r.clientSecret, null, 'null, not "": a caller cannot send an empty credential by accident');
});

test('OIDC_NAME overrides the label, and absent, the label is the issuer host, so a sign-in button has words on it without a provider registry', () => {
  assert.equal(readConfig({ env: env({ OIDC_NAME: 'Office SSO' }) }).name, 'Office SSO');
  assert.deepEqual(publicConfig({ env: env({ OIDC_NAME: 'Office SSO' }) }), { name: 'Office SSO' });
  assert.equal(readConfig({ env: env() }).name, 'id.example.com');
});

test('the redirect URI defaults to ORIGIN followed by /api/oidc/callback, so the one address that must match the browser is written once', () => {
  assert.equal(readConfig({ env: env() }).redirectUri, 'https://gym.example.com/api/oidc/callback');
  assert.equal(
    readConfig({ env: env({ OIDC_REDIRECT_URI: 'https://gym.example.com/api/oidc/callback' }) }).redirectUri,
    'https://gym.example.com/api/oidc/callback',
    'an explicit value on the same origin is still honoured'
  );
});

test('the requested scopes default to openid, profile and email', () => {
  assert.equal(readConfig({ env: env() }).scopes, 'openid profile email');
  assert.equal(readConfig({ env: env({ OIDC_SCOPES: 'openid profile' }) }).scopes, 'openid profile');
});

/* ---------- appPath: the public path this app is served under ---------- */

test('with no OIDC_REDIRECT_URI, appPath is the site root', () => {
  assert.equal(readConfig({ env: env() }).appPath, '/');
});

test('a redirect URI whose path ends in /api/oidc/callback under a subpath reports that subpath as appPath', () => {
  const r = readConfig({ env: env({ OIDC_REDIRECT_URI: 'https://gym.example.com/gym/api/oidc/callback' }) });
  assert.equal(r.appPath, '/gym/');
});

test('a redirect URI on the same origin whose path does not end in /api/oidc/callback reports the site root, rather than guess at one', () => {
  const r = readConfig({ env: env({ OIDC_REDIRECT_URI: 'https://gym.example.com/callback' }) });
  assert.equal(r.appPath, '/');
});

test('the public view of a full configuration serializes without any substring of the client secret, so a field added later cannot leak it', () => {
  assert.ok(!JSON.stringify(publicConfig({ env: env() })).includes(SECRET), 'the secret is never anything a client is told');
  assert.equal(Object.keys(publicConfig({ env: env() })).length, 1, 'exactly one key is exposed, so growth is a deliberate act');
});

/* ---------- purity ---------- */

test('importing the module and calling both functions writes nothing anywhere, because "off" is the absence of configuration and not a file that says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-oidc-'));
  const saved = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const before = fs.readdirSync(dir).sort();
    assert.deepEqual(before, [], 'the fixture starts empty');
    readConfig({ env: {} });
    publicConfig({ env: {} });
    readConfig({ env: env() });
    publicConfig({ env: env() });
    assert.deepEqual(fs.readdirSync(dir).sort(), before, 'the state directory is untouched by an instance that has OIDC configured and by one that does not');
  } finally {
    if (saved === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the module exports exactly readConfig, publicConfig and allowsPlainHttp, so an accessor for the secret cannot be added without this assertion going red', () => {
  assert.deepEqual(Object.keys(mod).sort(), ['allowsPlainHttp', 'publicConfig', 'readConfig']);
});

/* The two cases below are the only ones that touch the real process environment, and the restore
   has to survive a failing assertion: without it one genuine failure leaves a live OIDC block set
   for every case that runs afterwards in this file -- including the purity case, which reads the
   default environment -- and would be reported as several failures pointing at innocent code. */
const REAL_VARS = ['ORIGIN', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'];
function withRealEnv(values, body) {
  const saved = Object.fromEntries(REAL_VARS.map(k => [k, process.env[k]]));
  try {
    for (const k of REAL_VARS) delete process.env[k];
    Object.assign(process.env, values);
    body();
  } finally {
    for (const k of REAL_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('the default environment is process.env itself, read on every call, so a complete block set on the real environment reports on', () => {
  withRealEnv({ ORIGIN: 'https://gym.example.com', OIDC_ISSUER: 'https://id.example.com', OIDC_CLIENT_ID: 'opengym', OIDC_CLIENT_SECRET: SECRET }, () => {
    const r = readConfig();
    assert.equal(r.on, true, 'the path the server actually uses is the default one');
    assert.equal(r.redirectUri, 'https://gym.example.com/api/oidc/callback');
    assert.deepEqual(publicConfig(), { name: 'id.example.com' });
  });
});

test('reading is not cached: setting a variable on process.env and calling again returns the new answer, with no reset seam to remember', () => {
  withRealEnv({ ORIGIN: 'https://gym.example.com' }, () => {
    assert.equal(readConfig().on, false, 'nothing configured yet');
    assert.equal(publicConfig(), null);
    process.env.OIDC_ISSUER = 'https://id.example.com';
    process.env.OIDC_CLIENT_ID = 'opengym';
    assert.equal(readConfig().on, true, 'the second call sees the environment as it is now, not as it was at import');
  });
});

test('a failing assertion inside a case that sets the real environment still restores it', () => {
  const before = Object.fromEntries(REAL_VARS.map(k => [k, process.env[k]]));
  assert.throws(() => withRealEnv({ OIDC_ISSUER: 'https://leaked.example.com', OIDC_CLIENT_ID: 'leaked' }, () => {
    assert.equal(readConfig().issuer, 'this assertion is here to fail');
  }));
  assert.deepEqual(Object.fromEntries(REAL_VARS.map(k => [k, process.env[k]])), before, 'a live OIDC block outlived the case that set it');
});
