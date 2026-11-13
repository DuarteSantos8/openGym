/* OIDC sign-in settings, read once from the environment (docs/SELF_HOSTING.md, "Sign in with
 * your identity provider"). Without OIDC_ISSUER and OIDC_CLIENT_ID the feature is off and
 * every /api/oidc route answers 404. */
import { parseRoleMap } from '../role-claims.js';

const on = v => /^(1|true|yes|on)$/i.test(String(v || ''));
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

// The app comes back here and nowhere else (an exact match, no prefixes, no wildcards).
export const APP_RETURNS = Object.freeze(['opengym://oidc']);

export function oidcConfig(env, { origin }) {
  const issuer = String(env.OIDC_ISSUER || '').trim();
  const clientId = String(env.OIDC_CLIENT_ID || '').trim();
  const problems = [];
  if (!issuer && !clientId) return { enabled: false, problems };
  if (!issuer) problems.push('OIDC_CLIENT_ID is set but OIDC_ISSUER is not');
  if (!clientId) problems.push('OIDC_ISSUER is set but OIDC_CLIENT_ID is not');
  let issuerUrl = null;
  try { issuerUrl = issuer ? new URL(issuer) : null; } catch { problems.push('OIDC_ISSUER is not a URL'); }
  if (issuerUrl && !/^https?:$/.test(issuerUrl.protocol)) problems.push('OIDC_ISSUER must be http(s)');
  const scopes = list(String(env.OIDC_SCOPES || 'openid profile email').replace(/\s+/g, ','));
  if (!scopes.includes('openid')) scopes.unshift('openid');
  const redirectUri = String(env.OIDC_REDIRECT_URI || '').trim() || origin.replace(/\/+$/, '') + '/api/oidc/callback';
  if (!/\/api\/oidc\/callback$/.test(redirectUri)) problems.push('OIDC_REDIRECT_URI must end in /api/oidc/callback');
  const tokenAuth = /^post$/i.test(env.OIDC_TOKEN_AUTH || '') ? 'post' : 'basic';
  const roleRules = parseRoleMap(env.OIDC_ROLE_MAP);
  return {
    enabled: problems.length === 0,
    problems,
    issuer: issuer.replace(/\/+$/, ''),
    clientId,
    clientSecret: String(env.OIDC_CLIENT_SECRET || ''),
    tokenAuth,
    scopes,
    label: String(env.OIDC_LABEL || '').trim().slice(0, 40) || 'SSO',
    only: on(env.OIDC_ONLY),
    groupsClaim: String(env.OIDC_GROUPS_CLAIM || 'groups').trim() || 'groups',
    allowedGroups: list(env.OIDC_ALLOWED_GROUPS),
    roleRules,
    linkByEmail: on(env.OIDC_EMAIL_LINKING),
    logout: on(env.OIDC_LOGOUT),
    redirectUri,
    // Where a finished sign-in lands: the app's own address, also on a subpath install.
    appBase: redirectUri.replace(/\/api\/oidc\/callback$/, '') || origin
  };
}

/** Whether the provider's groups decide who may have an account at all. */
export const gated = cfg => cfg.allowedGroups.length > 0 || cfg.roleRules.some(r => r.role === 'access');
