import crypto from 'node:crypto';
import path from 'node:path';
import Provider, { errors } from 'oidc-provider';
import { createOAuthStore } from './mcp-oauth-store.js';
import { McpScopes, validateMcpConfiguration } from './mcp-config.js';

export { McpScopes } from './mcp-config.js';
const GrantLifetimeSeconds = 30 * 86400;
const InternalCredentialSeconds = 60;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

/** OAuth protocol belongs to oidc-provider; OpenGym supplies login, consent and account status. */
export function createMcpOAuth({ data, secret, origin, publicUrl, clients, userById, readSession, json }) {
  const configuration = validateMcpConfiguration({ enabled: true, url: publicUrl || origin + '/mcp', clients }, origin);
  const resource = new URL(configuration.url);
  clients = configuration.clients;
  const prefix = resource.pathname.slice(0, -'/mcp'.length);
  const issuer = resource.origin + prefix + '/oauth';
  const sessionVersion = user => user.sv || 0;
  const active = binding => {
    const user = userById(binding.userId);
    return !!user && !user.disabled && sessionVersion(user) === binding.sessionVersion;
  };
  const store = createOAuthStore(path.join(data, 'mcp-oauth.json'), secret, active);
  let keys = store.get('OpenGymKeys', 'signing');
  if (!keys) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    keys = { keys: [{ ...privateKey.export({ format: 'jwk' }), kid: crypto.randomUUID(), use: 'sig', alg: 'RS256' }] };
    store.set('OpenGymKeys', 'signing', keys, 10 * 365 * 86400);
  }
  const provider = new Provider(issuer, {
    adapter: store.Adapter, jwks: keys, scopes: ['openid', 'offline_access'], responseTypes: ['code'],
    clients: clients.map(client => ({ client_id: client.client_id, client_name: client.client_name || client.client_id,
      redirect_uris: client.redirect_uris, response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none' })), clientAuthMethods: ['none'],
    cookies: { keys: [crypto.createHmac('sha256', secret).update('opengym-oauth-cookies-v1').digest('hex')] },
    pkce: { required: () => true },
    features: { devInteractions: { enabled: false }, userinfo: { enabled: false }, revocation: { enabled: true },
      resourceIndicators: { enabled: true, defaultResource: () => resource.href, useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, requested) => {
          if (requested !== resource.href) throw new errors.InvalidTarget();
          return { scope: McpScopes.join(' '), audience: resource.href, accessTokenTTL: 600, accessTokenFormat: 'opaque' };
        } } },
    ttl: { AccessToken: 600, AuthorizationCode: 60, Interaction: 600, Grant: GrantLifetimeSeconds,
      RefreshToken: GrantLifetimeSeconds, Session: GrantLifetimeSeconds },
    rotateRefreshToken: () => true,
    // Always reconfirm an authorization request against the current OpenGym browser session.
    loadExistingGrant: async ctx => {
      const id = ctx.oidc.result?.consent?.grantId;
      return id ? ctx.oidc.provider.Grant.find(id) : undefined;
    },
    findAccount: (_ctx, id) => {
      const user = userById(id);
      return user && !user.disabled ? { accountId: id, claims: () => ({ sub: id }) } : undefined;
    },
    interactions: { url: (_ctx, interaction) => prefix + '/oauth/interaction/' + interaction.uid },
    renderError: (ctx, _out, error) => {
      ctx.type = 'application/json'; ctx.body = { error: error.error || 'oauth_error' };
    }
  });
  provider.proxy = true;
  provider.on('server_error', (_ctx, error) => console.error('OAuth server error', error.code || error.name, error.syscall || ''));
  const callback = provider.callback();
  async function verify(token, scope) {
    const access = await provider.AccessToken.find(token);
    const binding = access && store.get('OpenGymGrant', access.grantId);
    if (!access || access.isExpired || access.aud !== resource.href || !binding || !active(binding)
      || !await provider.Grant.find(access.grantId)) throw Object.assign(new Error('OAuth access revoked or invalid'), { status: 401, code: 'invalid_token' });
    const scopes = String(access.scope || '').split(' ');
    if (scope && !scopes.includes(scope)) throw Object.assign(new Error('Required permission not granted'), { status: 403, code: 'insufficient_scope' });
    return { user: userById(binding.userId), scopes, grantId: access.grantId, clientId: binding.clientId };
  }
  const mac = value => crypto.createHmac('sha256', secret).update('nutrition-delegation-v1:' + value).digest('base64url');
  function nutritionCredential(principal, method, pathname) {
    const payload = Buffer.from(JSON.stringify({ aud: 'opengym-nutrition', uid: principal.user.id,
      sv: sessionVersion(principal.user), grantId: principal.grantId, method, pathname,
      exp: Date.now() + InternalCredentialSeconds * 1000 })).toString('base64url');
    return 'ogn.' + payload + '.' + mac(payload);
  }
  function nutritionIdentity(token) {
    const [kind, payload, signature, extra] = token.split('.');
    if (kind !== 'ogn' || !payload || !signature || extra) return null;
    const expected = mac(payload);
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    let claim;
    try { claim = JSON.parse(Buffer.from(payload, 'base64url')); } catch { return null; }
    const binding = store.get('OpenGymGrant', claim.grantId);
    if (claim.aud !== 'opengym-nutrition' || !Number.isFinite(claim.exp) || claim.exp <= Date.now()
      || !binding || binding.userId !== claim.uid || !active(binding) || claim.sv !== binding.sessionVersion
      || !store.get('Grant', claim.grantId)) return null;
    const required = claim.method === 'GET' ? 'nutrition.read' : 'nutrition.write';
    if (!binding.scopes.includes(required) || !/^\/api\/nutrition\/(products|diary|entries)(\/[0-9a-f-]{36})?$/.test(claim.pathname)) return null;
    const user = userById(claim.uid);
    return { user: { id: user.id, name: user.name }, delegated: { method: claim.method, pathname: claim.pathname } };
  }
  async function handle(req, res, pathname) {
    const metadata = '/.well-known/oauth-protected-resource';
    if ([metadata, metadata + resource.pathname].includes(pathname) && req.method === 'GET') {
      json(res, 200, { resource: resource.href, authorization_servers: [issuer], scopes_supported: McpScopes }); return true;
    }
    if (pathname === '/.well-known/oauth-authorization-server' || pathname === '/.well-known/oauth-authorization-server' + new URL(issuer).pathname) {
      if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }); return true; }
      json(res, 200, { issuer, authorization_endpoint: issuer + '/auth', token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/jwks', revocation_endpoint: issuer + '/token/revocation',
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true, scopes_supported: ['openid', 'offline_access', ...McpScopes] }); return true;
    }
    const interactionPath = /^\/oauth\/interaction\/([a-zA-Z0-9_-]+)$/.exec(pathname);
    if (!interactionPath && !pathname.startsWith('/oauth/')) return false;
    if (req.headers.host !== resource.host || (req.headers.origin && req.headers.origin !== resource.origin)) {
      json(res, 403, { error: 'invalid_origin' }); return true;
    }
    // Both interactions and provider routes must see the configured public origin, not proxy input.
    req.headers['x-forwarded-proto'] = resource.protocol.slice(0, -1);
    req.headers['x-forwarded-host'] = resource.host;
    req.originalUrl = prefix + req.url;
    if (interactionPath) {
      const details = await provider.interactionDetails(req, res);
      if (interactionPath[1] !== details.uid) { json(res, 400, { error: 'invalid_interaction' }); return true; }
      const user = readSession(req);
      if (req.method === 'GET') {
        const csrf = crypto.randomBytes(24).toString('base64url');
        store.set('OpenGymConsent', details.uid, { csrf, userId: user?.id || null }, 600);
        const scopes = String(details.params.scope || '').split(' ').filter(scope => McpScopes.includes(scope));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY' });
        res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenGym access</title><style>body{font:18px system-ui;max-width:38rem;margin:3rem auto;padding:1rem}button{padding:.7rem;margin:.5rem}li{margin:.5rem}</style><h1>Connect OpenGym</h1><p>Client: ${escapeHtml(details.params.client_id)}</p><p>Callback: ${escapeHtml(details.params.redirect_uri)}</p><p>${user ? 'Account: ' + escapeHtml(user.name) : `Sign in to <a href="${escapeHtml(resource.origin + prefix + '/') }" target="_blank" rel="noopener">OpenGym</a>, then reload this page.`}</p><ul>${scopes.map(scope => `<li>${escapeHtml(scope)}</li>`).join('')}</ul>${user ? `<form method="post"><input type="hidden" name="csrf" value="${csrf}"><button name="decision" value="allow">Allow access</button><button name="decision" value="deny">Cancel</button></form>` : ''}</html>`);
        return true;
      }
      if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return true; }
      const form = await readForm(req);
      const consent = store.get('OpenGymConsent', details.uid);
      if (!user || !consent || consent.userId !== user.id || form.get('csrf') !== consent.csrf) {
        json(res, 403, { error: 'invalid_consent' }); return true;
      }
      store.remove('OpenGymConsent', details.uid);
      if (form.get('decision') !== 'allow') {
        await provider.interactionFinished(req, res, { error: 'access_denied' }, { mergeWithLastSubmission: false }); return true;
      }
      if (details.prompt.name === 'login') {
        await provider.interactionFinished(req, res, { login: { accountId: user.id, remember: false } }, { mergeWithLastSubmission: false });
      } else if (details.prompt.name === 'consent' && details.session?.accountId === user.id) {
        const grant = new provider.Grant({ accountId: user.id, clientId: details.params.client_id });
        grant.addOIDCScope(String(details.params.scope || '').split(' ').filter(scope => ['openid', 'offline_access'].includes(scope)).join(' '));
        const scopes = String(details.params.scope || '').split(' ').filter(scope => McpScopes.includes(scope));
        grant.addResourceScope(resource.href, scopes.join(' '));
        const grantId = await grant.save();
        store.set('OpenGymGrant', grantId, { grantId, userId: user.id, sessionVersion: sessionVersion(user),
          clientId: details.params.client_id, scopes, created: new Date().toISOString() }, GrantLifetimeSeconds);
        await provider.interactionFinished(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true });
      } else json(res, 403, { error: 'account_changed_restart_authorization' });
      return true;
    }
    const original = req.url;
    req.url = req.url.slice('/oauth'.length);
    try { await callback(req, res); } finally { req.url = original; }
    return true;
  }
  async function readForm(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded'))
      throw Object.assign(new Error('invalid consent form'), { status: 400 });
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 4096) throw Object.assign(new Error('consent form too large'), { status: 413 });
    }
    return new URLSearchParams(text);
  }
  return { resource, provider, store, verify, handle, nutritionCredential, nutritionIdentity,
    grants: userId => store.list('OpenGymGrant').filter(binding => binding.userId === userId && active(binding)) };
}
