import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './durable.js';

export const McpScopes = ['training.read', 'nutrition.read', 'nutrition.write'];
const loopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };

/** Validate the same public-client configuration for environment and GUI. No secrets are accepted. */
export function validateMcpConfiguration(value, origin) {
  if (!value || typeof value.enabled !== 'boolean' || typeof value.url !== 'string' || value.url.length > 2048)
    invalid('MCP requires enabled (boolean), a public URL and an OAuth clients array');
  let resource;
  try { resource = new URL(value.url); } catch { invalid('Invalid MCP public URL'); }
  if (resource.search || resource.hash || resource.username || resource.password || !resource.pathname.endsWith('/mcp')
    || !['http:', 'https:'].includes(resource.protocol) || (value.enabled && resource.protocol !== 'https:' && !loopback(resource)))
    invalid('MCP URL must be HTTPS and end in /mcp (HTTP is localhost-only)');
  if (resource.origin !== new URL(origin).origin) invalid('MCP must use the existing OpenGym origin');
  if (!Array.isArray(value.clients) || value.clients.length > 10 || (value.enabled && !value.clients.length))
    invalid('Enabled MCP requires at least one OAuth client (maximum 10)');
  const identifiers = new Set();
  const clients = value.clients.map(client => {
    if (!client || typeof client.client_id !== 'string' || !client.client_id.trim() || client.client_id.length > 128
      || /[\s\x00-\x1f]/.test(client.client_id) || identifiers.has(client.client_id)) invalid('OAuth client IDs must be nonempty and unique');
    identifiers.add(client.client_id);
    if (client.client_secret !== undefined) invalid('MCP uses public OAuth clients; client secrets are not accepted');
    if (client.client_name !== undefined && (typeof client.client_name !== 'string' || client.client_name.length > 100))
      invalid('OAuth client name must be at most 100 characters');
    if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.length || client.redirect_uris.length > 10)
      invalid('Each OAuth client requires exact callback URLs (maximum 10)');
    for (const redirect of client.redirect_uris) {
      if (typeof redirect !== 'string' || redirect.length > 2048 || redirect.includes('*')) invalid('Callback URLs must be exact, without wildcards');
      let uri;
      try { uri = new URL(redirect); } catch { invalid('Invalid OAuth callback URL'); }
      if (uri.hash || uri.username || uri.password || (uri.protocol !== 'https:' && !(uri.protocol === 'http:' && loopback(uri))))
        invalid('OAuth callback must be HTTPS (HTTP is localhost-only)');
    }
    return { client_id: client.client_id, client_name: client.client_name || client.client_id, redirect_uris: [...new Set(client.redirect_uris)] };
  });
  return { enabled: value.enabled, url: resource.href, clients };
}

/** Environment bootstraps settings; durable GUI settings take precedence on the next API start. */
export function createMcpConfiguration({ data, origin, env = process.env }) {
  const file = path.join(data, 'mcp-settings.json');
  let saved;
  try {
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (document.version !== 1) throw new Error('Unsupported MCP settings version');
    saved = validateMcpConfiguration(document.settings, origin);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('MCP settings unreadable; restore mcp-settings.json', { cause: error });
    saved = validateMcpConfiguration({ enabled: /^(1|true|yes|on)$/i.test(env.MCP_ENABLED || ''),
      url: env.MCP_PUBLIC_URL || origin + '/mcp', clients: JSON.parse(env.MCP_OAUTH_CLIENTS || '[]') }, origin);
  }
  const effective = structuredClone(saved);
  return {
    effective,
    status: admin => ({ enabled: effective.enabled, url: effective.url,
      clients: effective.clients.map(({ client_id, client_name }) => ({ client_id, client_name })),
      scopes: McpScopes, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(admin ? { saved: structuredClone(saved), restartRequired: JSON.stringify(saved) !== JSON.stringify(effective) } : {}) }),
    save: value => {
      const next = validateMcpConfiguration(value, origin);
      atomicWrite(file, JSON.stringify({ version: 1, settings: next }), 0o600);
      saved = next;
    }
  };
}
