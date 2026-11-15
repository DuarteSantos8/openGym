/* Sign in with an identity provider (OIDC, #130): the routes. server.js hands in what they need
 * and spreads `routes` into its table only when OIDC is configured.
 *
 * The flow is the authorization code flow with PKCE (S256), a fresh `state` and `nonce` per
 * sign-in, and a short-lived cookie that ties the callback to the browser that started it, so
 * nobody can finish their own sign-in in someone else's browser (login CSRF). The ID token is
 * checked in jwt.js; who it lets in is decided in accounts.js.
 *
 * The phone app goes through the system browser and comes back on opengym://oidc with a one-time
 * code. The code alone is worth nothing: it is bound to a verifier only the app holds (the same
 * idea as PKCE), so another app grabbing the custom scheme gets nothing it can redeem. */
import crypto from 'node:crypto';
import { verifyIdToken, allowedAlgs, OidcError } from './jwt.js';
import { decide, accessOf, linkedTo, nameFor } from './accounts.js';
import { APP_RETURNS, gated } from './config.js';

const FLOW_TTL_MS = 10 * 60000;
const HANDOFF_TTL_MS = 2 * 60000;
const TICKET_TTL_MS = 2 * 60000;
// How long after a provider sign-in it counts as "you just proved it is you" (proveOwner).
export const PROOF_WINDOW_MS = 5 * 60000;
const MAX_PENDING = 5000;

const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const s256 = v => crypto.createHash('sha256').update(v).digest('base64url');
const sameText = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// A Map that forgets: entries expire, and it never holds more than MAX_PENDING (oldest go first).
function pending() {
  const m = new Map();
  return {
    put(k, v, ttl, now) {
      for (const [key, e] of m) if (e.exp < now) m.delete(key);
      while (m.size >= MAX_PENDING) m.delete(m.keys().next().value);
      m.set(k, { ...v, exp: now + ttl });
    },
    take(k, now) {
      if (typeof k !== 'string' || !k) return null;
      const e = m.get(k);
      m.delete(k);
      return e && e.exp >= now ? e : null;
    },
    dropFor(uid) { for (const [k, e] of m) if (e.uid === uid) m.delete(k); },
    get size() { return m.size; }
  };
}

// What a refusal is called on the way back to the app (lib/oidc.js words each one).
const TOKEN_CODES = new Set(['nonce', 'expired', 'audience', 'issuer', 'signature', 'alg', 'no-key', 'malformed', 'stale']);

export function oidcRoutes(d) {
  const { cfg, provider, json, readBody, readSession, sessionOf, audit, auditFail, saveDb, publicUser } = d;
  const now = d.now || Date.now;
  const flows = pending();
  const handoffs = pending();
  const tickets = pending();
  const FLOW_COOKIE = d.secure ? '__Host-gymoidc' : 'gymoidc';
  const flowCookie = v => `${FLOW_COOKIE}=${v}; Path=/; Max-Age=${FLOW_TTL_MS / 1000}; HttpOnly;${d.secure ? ' Secure;' : ''} SameSite=Lax`;
  const clearFlowCookie = `${FLOW_COOKIE}=; Path=/; Max-Age=0; HttpOnly;${d.secure ? ' Secure;' : ''} SameSite=Lax`;
  // A redirect that carries a code or a state must not leak it onward, nor be cached.
  const NO_LEAK = { 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' };

  function redirect(res, location, cookies = []) {
    res.writeHead(302, { Location: location, ...NO_LEAK, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
    res.end();
  }
  // Where a browser lands: the app, with what happened in the query (lib/oidc.js reads it and
  // tidies the address bar). Settings → Account for the two flows that started there.
  const webLanding = (flow, q) => `${cfg.appBase}/?${q}#/${flow && (flow.mode === 'link' || flow.mode === 'reauth') ? 'settings/account' : ''}`;
  function finishError(res, flow, code) {
    if (flow?.mode === 'app') {
      return redirect(res, `${flow.app.ret}?error=${encodeURIComponent(code)}&astate=${encodeURIComponent(flow.app.astate)}`, [clearFlowCookie]);
    }
    redirect(res, webLanding(flow, 'oidc-error=' + encodeURIComponent(code)), [clearFlowCookie]);
  }

  // Too many starts, callbacks or redeems from one address: the answer is a pause.
  const throttled = req => d.throttle ? d.throttle(req) : 0;

  /** Roles the provider's groups give: admin onto the profile, studio roles onto org.json. A role
   *  given by hand is never taken away here, and the owner always stays admin. */
  function applyRoles(user, roles) {
    if (!cfg.roleRules.length) return;
    if (roles.admin && !d.isAdmin(user)) { user.admin = true; user.adminFrom = 'oidc'; }
    else if (!roles.admin && user.adminFrom === 'oidc' && !user.owner) { delete user.admin; delete user.adminFrom; }
    if (d.syncRoles) {
      try { d.syncRoles(user.id, roles); } catch (e) { console.error('oidc roles', e.message); }
    }
  }
  const identity = claims => ({
    iss: claims.iss, sub: claims.sub,
    ...(typeof claims.email === 'string' && claims.email_verified === true ? { email: d.normalizeEmail(claims.email) || undefined } : {}),
    linked: new Date(now()).toISOString()
  });

  /** The proof proveOwner takes from a provider: a sign-in there in the last few minutes. */
  function providerProof(req, user) {
    const s = sessionOf(req);
    return !!(user.oidc && s && s.user === user && s.at && now() - s.at <= PROOF_WINDOW_MS);
  }

  /** The provider's "sign out there too" address, for POST /api/logout. */
  function logoutUrl(user) {
    const end = provider.meta?.end_session_endpoint;
    if (!cfg.logout || !user?.oidc || !end) return null;
    const u = new URL(end);
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('post_logout_redirect_uri', cfg.appBase + '/');
    return u.toString();
  }

  async function verifiedClaims(flow, code, meta) {
    const tok = await provider.exchange({ code, verifier: flow.verifier });
    const claims = await verifyIdToken(tok.id_token, {
      jwks: await provider.jwks(), refetch: () => provider.jwks({ force: true }),
      issuer: meta.issuer, clientId: cfg.clientId, nonce: flow.nonce, now: now(),
      algs: allowedAlgs(meta.id_token_signing_alg_values_supported),
      maxAgeSec: flow.mode === 'reauth' ? PROOF_WINDOW_MS / 1000 : null
    });
    // Groups and the e-mail often live only in userinfo (Authelia, Keycloak without a mapper).
    // Its answer is used only when it is about the same person (OIDC Core 5.3.2).
    const needs = claims[cfg.groupsClaim] === undefined || claims.email === undefined;
    if (needs && tok.access_token) {
      const ui = await provider.userinfo(tok.access_token);
      if (ui && typeof ui === 'object' && ui.sub === claims.sub) {
        const { iss, aud, exp, iat, nonce, azp, ...rest } = ui;
        return { ...rest, ...claims };
      }
    }
    return claims;
  }

  const routes = {
    'GET /api/oidc/start': async (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const mode = q.get('mode') || 'web';
      if (!['web', 'app', 'link', 'reauth'].includes(mode)) return json(res, 400, { error: 'unknown mode' });
      let app = null;
      if (mode === 'app') {
        // Checked before anything else and answered here, never by redirecting: an address that
        // is not on the list is exactly where a code must not be sent.
        const ret = q.get('return') || '';
        const challenge = q.get('challenge') || '';
        const astate = q.get('astate') || '';
        if (!APP_RETURNS.includes(ret)) return json(res, 400, { error: 'that return address is not allowed', code: 'oidc-return' });
        if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || !/^[A-Za-z0-9_-]{16,128}$/.test(astate)) return json(res, 400, { error: 'bad app parameters', code: 'oidc-app' });
        app = { ret, challenge, astate };
      }
      const flow0 = { mode, app };
      const wait = throttled(req);
      if (wait) return finishError(res, flow0, 'throttled');
      let uid = null;
      if (mode === 'link') {
        const tk = tickets.take(q.get('ticket'), now());
        const user = readSession(req);
        if (!tk || !user || tk.uid !== user.id) return finishError(res, flow0, 'link-expired');
        uid = user.id;
      } else if (mode === 'reauth') {
        const user = readSession(req);
        if (!user || !user.oidc) return finishError(res, flow0, 'link-expired');
        uid = user.id;
      }
      let meta;
      try { meta = await provider.discover(); }
      catch { auditFail(req, 'auth.oidc.fail', { ok: false, msg: 'provider-down' }); return finishError(res, flow0, 'provider'); }
      const state = rand(), nonce = rand(), verifier = rand(48), binding = rand();
      flows.put(state, { mode, app, uid, nonce, verifier, bind: s256(binding) }, FLOW_TTL_MS, now());
      const u = new URL(meta.authorization_endpoint);
      const p = u.searchParams;
      p.set('response_type', 'code');
      p.set('client_id', cfg.clientId);
      p.set('redirect_uri', cfg.redirectUri);
      p.set('scope', cfg.scopes.join(' '));
      p.set('state', state);
      p.set('nonce', nonce);
      p.set('code_challenge', s256(verifier));
      p.set('code_challenge_method', 'S256');
      if (mode === 'reauth') p.set('prompt', 'login');
      redirect(res, u.toString(), [flowCookie(binding)]);
    },

    'GET /api/oidc/callback': async (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams;
      if (throttled(req)) return finishError(res, null, 'throttled');
      const flow = flows.take(q.get('state'), now());
      // Unknown, used or expired state, or a callback in another browser than the one that left.
      const bound = flow && (d.cookieValues(req, FLOW_COOKIE) || []).some(v => sameText(s256(v), flow.bind));
      if (!flow || !bound) {
        d.strike?.(req);
        auditFail(req, 'auth.oidc.fail', { ok: false, msg: 'state' });
        return finishError(res, flow && bound ? flow : null, 'state');
      }
      if (q.get('error')) {
        const why = q.get('error') === 'access_denied' ? 'cancelled' : 'provider';
        auditFail(req, 'auth.oidc.fail', { ok: false, msg: 'provider:' + String(q.get('error')).slice(0, 40) });
        return finishError(res, flow, why);
      }
      const code = q.get('code');
      if (!code || code.length > 4096) return finishError(res, flow, 'provider');
      let claims, meta;
      try {
        meta = await provider.discover();
        claims = await verifiedClaims(flow, code, meta);
      } catch (e) {
        const why = e instanceof OidcError && TOKEN_CODES.has(e.code) ? e.code : 'provider';
        if (why !== 'provider') d.strike?.(req);
        auditFail(req, 'auth.oidc.fail', { ok: false, msg: why });
        return finishError(res, flow, why === 'provider' ? 'provider' : 'token');
      }
      const db = d.db();
      const at = now();

      // Linking from Settings, or confirming it is you: the browser that started it must still be
      // signed in as the profile it started for.
      if (flow.mode === 'link' || flow.mode === 'reauth') {
        const user = readSession(req);
        if (!user || user.id !== flow.uid) return finishError(res, flow, 'link-expired');
        const other = linkedTo(db, claims.iss, claims.sub);
        if (flow.mode === 'reauth') {
          if (other !== user) { audit(req, 'auth.oidc.fail', { ok: false, user, msg: 'wrong-account' }); return finishError(res, flow, 'wrong-account'); }
        } else {
          if (other && other !== user) { audit(req, 'auth.oidc.fail', { ok: false, user, msg: 'taken' }); return finishError(res, flow, 'taken'); }
          if (user.oidc && other !== user) return finishError(res, flow, 'already-linked');
        }
        const { roles, allowed } = accessOf(claims, cfg);
        if (!allowed) { audit(req, 'auth.oidc.denied', { ok: false, user, msg: 'group' }); return finishError(res, flow, 'group'); }
        if (flow.mode === 'link') { user.oidc = identity(claims); audit(req, 'auth.oidc.link', { user }); }
        else audit(req, 'auth.oidc.reauth', { user });
        applyRoles(user, roles);
        saveDb();
        return redirect(res, webLanding(flow, 'oidc=' + (flow.mode === 'link' ? 'linked' : 'confirmed')), [clearFlowCookie, ...d.sessionCookie(user, at)]);
      }

      const verdict = decide(db, claims, cfg, { inviteOnly: d.inviteOnly, normalizeEmail: d.normalizeEmail });
      if (verdict.kind === 'refuse') {
        // Taken out of the group at the provider: the sessions this profile still holds end too.
        if (verdict.code === 'group' && verdict.user && gated(cfg)) { verdict.user.sv = (verdict.user.sv || 0) + 1; saveDb(); }
        audit(req, 'auth.oidc.denied', { ok: false, ...(verdict.user ? { user: verdict.user } : {}), msg: verdict.code });
        return finishError(res, flow, verdict.code);
      }
      let user = verdict.user;
      if (verdict.kind === 'link') {
        user.oidc = identity(claims);
        audit(req, 'auth.oidc.link', { user, msg: 'email' });
      } else if (verdict.kind === 'create') {
        user = { id: rand(12), name: nameFor(claims, n => d.nameTaken(n)), created: new Date(at).toISOString(), oidc: identity(claims) };
        // Synchronous from here to the push, like a passkey sign-up: two first sign-ins racing on
        // an empty instance cannot both become its admin.
        d.claimFirstAdmin(req, user);
        db.users.push(user);
        audit(req, 'auth.oidc.create', { user });
      }
      applyRoles(user, accessOf(claims, cfg).roles);
      saveDb();
      audit(req, 'auth.oidc.ok', { user, msg: flow.mode });
      if (flow.mode === 'app') {
        const hcode = rand();
        handoffs.put(hcode, { uid: user.id, challenge: flow.app.challenge, at }, HANDOFF_TTL_MS, now());
        return redirect(res, `${flow.app.ret}?code=${hcode}&astate=${encodeURIComponent(flow.app.astate)}`, [clearFlowCookie]);
      }
      redirect(res, webLanding(flow, 'oidc=signed-in'), [clearFlowCookie, ...d.sessionCookie(user, at)]);
    },

    // The phone trades its one-time code and its verifier for the same token a pairing gives.
    'POST /api/oidc/app/redeem': async (req, res) => {
      const body = await readBody(req);
      if (throttled(req)) return json(res, 429, { error: 'too many attempts, try again later', code: 'locked' });
      const h = handoffs.take(typeof body.code === 'string' ? body.code : '', now());
      const verifier = typeof body.verifier === 'string' ? body.verifier : '';
      const user = h && d.db().users.find(u => u.id === h.uid);
      if (!h || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !sameText(s256(verifier), h.challenge) || !user || user.disabled) {
        d.strike?.(req);
        auditFail(req, 'auth.oidc.fail', { ok: false, msg: 'app-redeem' });
        return json(res, 400, { error: 'that sign-in has expired, try again', code: 'oidc-invalid' });
      }
      audit(req, 'auth.oidc.app', { user });
      json(res, 200, { token: d.makeSession(user, 'b', h.at), user: publicUser(user) });
    },

    // Settings → "Link {provider}": the same proof as every other new way in, then a ticket the
    // browser takes to /api/oidc/start. The ticket is one-time and only for this session.
    'POST /api/oidc/link': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      if (user.oidc) return json(res, 409, { error: 'already linked', code: 'already-linked' });
      const proof = await d.proveOwner(req, res, user, body, 'oidc-link');
      if (!proof) return;
      if (readSession(req) !== user) return json(res, 401, { error: 'not signed in' });
      if (proof === 'passkey') saveDb();
      tickets.dropFor(user.id);
      const ticket = rand();
      tickets.put(ticket, { uid: user.id }, TICKET_TTL_MS, now());
      json(res, 200, { url: '/api/oidc/start?mode=link&ticket=' + ticket });
    },

    // Never the last way in, and the same proof as removing a passkey.
    'POST /api/oidc/unlink': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      if (!user.oidc) return json(res, 200, { ok: true });
      const last = () => json(res, 409, { error: 'the provider is the only way into this profile', code: 'last-way-in' });
      if (d.otherWaysIn(user) < 1) return last();
      const proof = await d.proveOwner(req, res, user, body, 'oidc-unlink');
      if (!proof) return;
      if (readSession(req) !== user) return json(res, 401, { error: 'not signed in' });
      if (d.otherWaysIn(user) < 1) return last();
      delete user.oidc;
      applyRoles(user, { access: false, admin: false, freeTrainer: false, staff: [], memberOf: [] });
      saveDb();
      audit(req, 'auth.oidc.unlink', { user });
      json(res, 200, { ok: true });
    },

    'GET /api/admin/oidc': async (req, res) => {
      if (!d.requireAdmin(req, res)) return;
      json(res, 200, status());
    },
    // "Check now": discovery and keys fetched fresh, so a fixed provider shows up without a restart.
    'POST /api/admin/oidc/check': async (req, res) => {
      const admin = d.requireAdmin(req, res);
      if (!admin) return;
      let ok = true;
      try { await provider.discover({ force: true }); await provider.jwks({ force: true }); }
      catch { ok = false; }
      audit(req, 'admin.oidc.check', { user: admin, ok });
      json(res, 200, status());
    }
  };

  function status() {
    const m = provider.meta;
    const db = d.db();
    return {
      enabled: true,
      issuer: cfg.issuer, clientId: cfg.clientId, confidential: !!cfg.clientSecret, scopes: cfg.scopes,
      label: cfg.label, only: cfg.only, redirectUri: cfg.redirectUri, groupsClaim: cfg.groupsClaim,
      allowedGroups: cfg.allowedGroups, roleRules: cfg.roleRules.length, linkByEmail: cfg.linkByEmail,
      logout: cfg.logout && !!m?.end_session_endpoint, logoutAsked: cfg.logout,
      reachable: !!m, keys: provider.keyCount, algs: m ? allowedAlgs(m.id_token_signing_alg_values_supported) : [],
      lastOk: provider.status.lastOk, lastError: provider.status.lastError, lastErrorAt: provider.status.lastErrorAt,
      linked: db.users.filter(u => u.oidc).length, plainHttp: cfg.issuer.startsWith('http:')
    };
  }

  // "Sign out everywhere": a code or a ticket still on its way must not outlive it.
  const forget = uid => { handoffs.dropFor(uid); tickets.dropFor(uid); };

  return { routes, providerProof, logoutUrl, status, forget };
}
