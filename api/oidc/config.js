/* Whether this instance offers OIDC sign-in at all, and with what, decided from the environment.

   The configuration lives in environment variables and NOT in the state directory. That is the
   mirror image of the decision the Coach took for itself, and it is taken for one reason: a
   file-backed design has to CREATE something to represent "switched off", and the moment "off" is
   a stored record, the promise that an unconfigured instance is unchanged stops being a single
   assertion and becomes an argument about defaults, migrations and what an empty file means.
   Read from the environment, "off" is the absence of a variable: nothing to write, nothing to
   migrate, and nothing new riding along in the backup archive the documentation tells owners to
   make.

   One pure function answers in exactly three ways -- the feature is off; the feature is off and
   here is the variable you got wrong; the feature is on and here is the configuration -- and two
   thin views sit over it. A half-set or malformed block is always the second answer, never a
   partial third, so nobody is offered a sign-in path this instance cannot complete and the
   operator gets a sentence naming the value to go and change instead of a button that silently
   never appeared. Reporting rather than throwing is the point: a typo here must leave the server
   running and passkey sign-in working.

   The client secret may appear in a return value or in an error string exactly never. Everything
   else here is an address, and naming an address back is the whole purpose of the sentences. */

/* Fixed rather than configurable: the provider is registered against one exact path, and a second
   spelling of it is a second thing to mistype for no gain. */
const CALLBACK_PATH = '/api/oidc/callback';
/* openid is what makes a provider return an identity token at all; profile and email are what a
   new profile gets named and recognised by. */
const DEFAULT_SCOPES = 'openid profile email';
const DOCS = 'See docs/SELF_HOSTING.md.';
/* A browser treats these three as a secure context without TLS, which is the same carve-out
   passkey sign-in already depends on -- so a local checkout can run a local issuer over http and
   nothing on the open internet can. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/* Every variable read under this prefix. The list exists to tell "nobody configured anything"
   apart from "somebody configured half of it", which get opposite answers. */
const OIDC_VARS = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_SCOPES', 'OIDC_NAME'];

/* A variable that is present but blank is not present: a commented-out line and an empty one mean
   the same thing to whoever wrote the file, and they must mean the same thing here. */
const read = (env, name) => { const v = env[name]; return typeof v === 'string' ? v.trim() : ''; };

/* Every refusal names the variable at fault and ends at the manual, because a named variable with
   no documentation behind it is half an answer. */
const off = reason => ({ on: false, error: `${reason} ${DOCS}` });

/** True when this URL's host is one a browser treats as a secure context without TLS. */
export function allowsPlainHttp(url) {
  return LOCAL_HOSTS.has(String((url && url.hostname) || '').toLowerCase());
}

/* The issuer is the one value compared byte for byte against something outside this instance, so
   its shape is checked and never repaired. Returns { url } or { error }. */
function checkIssuer(raw) {
  let u;
  try { u = new URL(raw); } catch { return { error: `OIDC_ISSUER=${raw} is not a valid URL. It is the provider's base address, for example https://id.example.com.` }; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowsPlainHttp(u))) {
    return { error: `OIDC_ISSUER=${raw} must be an https address. Plain http is accepted only on localhost, 127.0.0.1 and [::1], which a browser treats as a secure context without TLS.` };
  }
  /* The value is deliberately not echoed in this one sentence: a credential in a URL is a
     credential in every log line and every error page that repeats the URL back. */
  if (u.username || u.password) return { error: 'OIDC_ISSUER must not carry a username or a password. The issuer is written into error messages and logs, and a credential in a URL travels with it.' };
  if (u.search || u.hash) return { error: `OIDC_ISSUER=${raw} must not carry a query string or a fragment. The discovery path is appended to the issuer, so anything after it lands in the wrong place.` };
  /* Refused rather than stripped, and that is the whole reason this check exists: the value is
     compared byte for byte against the issuer the provider calls itself in its own discovery
     document. Silently normalising a slash away here would move the mismatch to a place where the
     error message can no longer name the variable that caused it. A path component is kept for the
     same reason, and because the well-known path is appended to it rather than replacing it. */
  if (raw.endsWith('/')) return { error: `OIDC_ISSUER=${raw} must not end in a slash. This value is compared byte for byte against what the provider calls itself, so a slash removed here would come back as a mismatch that names nothing.` };
  return { url: u };
}

/**
 * The environment is read INSIDE this function, not at module top level. That is a deliberate
 * departure from the rest of this tree, where server.js and coach/config.js both read at import
 * time: the guarantee this module carries is that an unconfigured instance is unchanged and a
 * misconfigured one says so, and that has to be assertable by setting a variable and asking
 * again, rather than through a dynamic-import dance at the top of every test.
 *
 * There is no cache and no reset seam for the same reason. The parse is a handful of string
 * checks, so a cache would buy nothing and would make the "nothing is written, nothing is
 * remembered" claim depend on invalidation order.
 */
export function readConfig({ env = process.env } = {}) {
  const issuer = read(env, 'OIDC_ISSUER');
  const clientId = read(env, 'OIDC_CLIENT_ID');
  const clientSecret = read(env, 'OIDC_CLIENT_SECRET');
  const redirect = read(env, 'OIDC_REDIRECT_URI');
  const scopes = read(env, 'OIDC_SCOPES') || DEFAULT_SCOPES;
  const label = read(env, 'OIDC_NAME');
  const originRaw = read(env, 'ORIGIN');

  /* OIDC_ISSUER is the on-switch. With it and every sibling absent, say nothing at all: an
     instance nobody configured must not be told about a feature it does not have. */
  if (!issuer) {
    const present = OIDC_VARS.filter(v => read(env, v));
    if (!present.length) return { on: false };
    return off(`OIDC_ISSUER is not set, but ${present.join(', ')} ${present.length > 1 ? 'are' : 'is'}. OIDC sign-in stays off until OIDC_ISSUER gives the address of the provider.`);
  }
  if (!clientId) return off(`OIDC_CLIENT_ID is not set. OIDC_ISSUER=${issuer} names a provider, but the client id is what that provider knows this instance by, so sign-in stays off.`);

  const checked = checkIssuer(issuer);
  if (checked.error) return off(checked.error);

  /* ORIGIN is REQUIRED once the block is otherwise on-shaped, rather than defaulted. It is not
     read through and not guessed, and neither is a matter of taste: the redirect URI is derived
     from it, an operator who configured a provider has necessarily registered one exact redirect
     URI with it, and this module deliberately does not inherit the localhost fallback server.js
     applies to the same variable. Guessing would produce a redirect the provider refuses as
     unregistered, which surfaces the mistake at the provider instead of here; reading an absent
     value through would produce "undefined/api/oidc/callback" while reporting the feature ON,
     which is precisely the silent half-enabled state this module exists to make impossible. */
  if (!originRaw) return off('ORIGIN is not set, and the address OIDC sign-in sends the browser back to is derived from it. A provider only accepts a redirect URI that was registered with it, so a guessed address would be refused there rather than reported here.');
  let origin;
  try { origin = new URL(originRaw); } catch { return off(`ORIGIN=${originRaw} is not a valid URL, and the redirect URI for OIDC sign-in is built from its origin.`); }
  /* Parsing is not enough, and this is the branch the paragraph above is about. An origin is a
     scheme, a host and a port; a value that parses but has none of them -- a javascript:, mailto:
     or file: URL -- yields the literal string "null" from .origin, so reading it through would
     produce "null/api/oidc/callback" while reporting the feature ON. The comparison that guards
     an explicit redirect URI would then be 'null' against 'null' and would let a javascript: URL
     through to a later phase as the address a browser is sent to. */
  if (origin.protocol !== 'https:' && origin.protocol !== 'http:') return off(`ORIGIN=${originRaw} must be an http or https address. The redirect URI for OIDC sign-in is built from its origin, and this value has none.`);
  if (origin.protocol === 'http:' && !allowsPlainHttp(origin)) return off(`ORIGIN=${originRaw} must be an https address. The provider delivers the authorization code to an address derived from it, and plain http carries that code in cleartext. Plain http is accepted only on localhost, 127.0.0.1 and [::1].`);

  /* Derived by default so the one address that must match the browser exactly is written once.
     An explicit value is still honoured, because a deployment may terminate elsewhere -- but one
     on a different origin is always a misconfiguration, so both names go in the sentence. */
  let redirectUri = origin.origin + CALLBACK_PATH;
  let redirectPath = CALLBACK_PATH;
  if (redirect) {
    let r;
    try { r = new URL(redirect); } catch { return off(`OIDC_REDIRECT_URI=${redirect} is not a valid URL. It is the full address the provider sends the browser back to.`); }
    /* Not echoed in this one sentence, for the reason the issuer's own credential check gives. */
    if (r.username || r.password) return off('OIDC_REDIRECT_URI must not carry a username or a password. The redirect URI is written into error messages and logs, and a credential in a URL travels with it.');
    /* RFC 6749 section 3.1.2 forbids a fragment on a redirection endpoint outright, and a browser
       never sends one to a server, so a provider that accepts the registration at all would send
       the browser somewhere this instance cannot answer. */
    if (r.hash) return off(`OIDC_REDIRECT_URI=${redirect} must not carry a fragment. A redirection endpoint is registered without one, and a browser never sends a fragment to a server.`);
    /* The scheme and the host are settled by the comparison below rather than by a check of their
       own: ORIGIN is already known to be a hierarchical https address, or plain http on a host a
       browser treats as a secure context, and an equal origin is that same scheme and host. */
    if (r.origin !== origin.origin) return off(`OIDC_REDIRECT_URI=${redirect} is not on the same origin as ORIGIN=${originRaw}. The provider sends the browser back to this instance, so the redirect URI has to be an address this instance answers on.`);
    redirectUri = redirect;
    redirectPath = r.pathname;
  }

  if (!scopes.split(/\s+/).includes('openid')) return off(`OIDC_SCOPES=${scopes} does not include openid. Without that scope the provider returns no identity token, so there is nothing for this instance to verify.`);

  return {
    on: true,
    issuer,
    clientId,
    /* null rather than '' so a caller cannot send an empty credential by accident. Absent means a
       public client authenticating with PKCE alone, which self-hosted issuers permit. */
    clientSecret: clientSecret || null,
    redirectUri,
    scopes,
    /* A sign-in button needs words on it, and the issuer host is a truthful default that costs no
       provider registry. */
    name: label || checked.url.hostname,
    /* The public path this app is served under, e.g. "/" or "/gym/". The operator's registered
       redirect URI is the one place that path is written down, so a browser-facing return address
       is built from it rather than assumed to be the site root -- the same reasoning that already
       keeps every other return address in this file off of anything the request itself carries. */
    appPath: appPathFrom(redirectPath)
  };
}

/* Strips a trailing "api/oidc/callback" off a redirect URI's own pathname, leaving whatever came
   before it -- "/" when nothing did. A path that does not end that way (a redirect URI proxied
   through a route this instance did not register under CALLBACK_PATH) answers "/" rather than
   guess: an operator running a deployment strange enough to trip this gets the site root back,
   never a path this module invented. */
function appPathFrom(pathname) {
  const suffix = 'api/oidc/callback';
  if (!pathname.endsWith(suffix)) return '/';
  return pathname.slice(0, pathname.length - suffix.length) || '/';
}

/**
 * What every HTTP client is told. null means no provider exists anywhere -- and null is the whole
 * mechanism behind that promise: with nothing configured there is no key for a client to branch
 * on, so an unconfigured instance is not merely missing a button, it is indistinguishable from a
 * build that never had the feature. Only a display label is ever exposed.
 */
export function publicConfig({ env = process.env } = {}) {
  const cfg = readConfig({ env });
  return cfg.on ? { name: cfg.name } : null;
}
