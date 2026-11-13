/* A small OpenID provider for the OIDC tests: discovery, a local key set, an authorize endpoint
   that signs whoever `next` says straight in, a token endpoint that checks PKCE and the client,
   and userinfo. `tamper` bends the next ID token (a wrong nonce, aud, iss, an old exp, another
   key) so each check in api/oidc/jwt.js can be watched refusing it. */
import http from 'node:http';
import crypto from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');

export function signJwt(claims, { key, kid = 'k1', alg = 'RS256' } = {}) {
  const head = b64u(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64u(JSON.stringify(claims));
  const data = head + '.' + body;
  const sig = alg === 'ES256'
    ? crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' })
    : alg === 'EdDSA' ? crypto.sign(null, Buffer.from(data), key)
      : crypto.sign('sha256', Buffer.from(data), key);
  return data + '.' + b64u(sig);
}

export async function startMockOidc({ clientId = 'opengym', clientSecret = 's3cret', userinfoGroups = false, endSession = true } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rogue = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const codes = new Map();
  const tokens = new Map();
  const m = {
    issuer: '', clientId, clientSecret, key: privateKey, rogue,
    next: { sub: 'user-1', name: 'Ana', email: 'ana@example.com', email_verified: true, groups: ['opengym'] },
    tamper: {},
    seen: { authorize: [], token: [] },
    jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    if (u.pathname === '/.well-known/openid-configuration') {
      return send(200, {
        issuer: m.issuer, authorization_endpoint: m.issuer + '/authorize', token_endpoint: m.issuer + '/token',
        jwks_uri: m.issuer + '/jwks', userinfo_endpoint: m.issuer + '/userinfo',
        ...(endSession ? { end_session_endpoint: m.issuer + '/logout' } : {}),
        id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256']
      });
    }
    if (u.pathname === '/jwks') return send(200, { keys: [m.jwk] });
    if (u.pathname === '/authorize') {
      const p = Object.fromEntries(u.searchParams);
      m.seen.authorize.push(p);
      const code = crypto.randomBytes(16).toString('hex');
      codes.set(code, { p, who: { ...m.next }, tamper: { ...m.tamper } });
      const back = new URL(p.redirect_uri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', p.state);
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', c => raw += c);
      req.on('end', () => {
        const f = Object.fromEntries(new URLSearchParams(raw));
        m.seen.token.push({ form: f, auth: req.headers.authorization || null });
        const basic = req.headers.authorization?.startsWith('Basic ') ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString() : null;
        if (basic !== `${clientId}:${clientSecret}`) return send(401, { error: 'invalid_client' });
        const c = codes.get(f.code);
        codes.delete(f.code);
        if (!c || f.redirect_uri !== c.p.redirect_uri) return send(400, { error: 'invalid_grant' });
        const S = crypto.createHash('sha256').update(f.code_verifier || '').digest('base64url');
        if (S !== c.p.code_challenge) return send(400, { error: 'invalid_grant', error_description: 'pkce' });
        const now = Math.floor(Date.now() / 1000);
        const { groups, ...who } = c.who;
        const claims = {
          iss: m.issuer, aud: clientId, iat: now, exp: now + 300, nonce: c.p.nonce, auth_time: now,
          ...who, ...(userinfoGroups ? {} : { groups }), ...(c.tamper.claims || {})
        };
        const at = crypto.randomBytes(16).toString('hex');
        tokens.set(at, { sub: who.sub, ...(userinfoGroups ? { groups } : {}), ...(c.tamper.userinfo || {}) });
        const id_token = signJwt(claims, { key: c.tamper.rogue ? rogue : privateKey });
        send(200, { access_token: at, token_type: 'Bearer', id_token, expires_in: 300 });
      });
      return;
    }
    if (u.pathname === '/userinfo') {
      const at = (req.headers.authorization || '').slice(7);
      const t = tokens.get(at);
      return t ? send(200, t) : send(401, { error: 'invalid_token' });
    }
    send(404, { error: 'nope' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  m.issuer = `http://127.0.0.1:${server.address().port}`;
  m.close = () => new Promise(r => server.close(r));
  return m;
}
