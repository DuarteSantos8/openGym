// A starting suggestion for the MCP connector's own hostname, shown in the setup guide.
//
// One level under the registrable domain on purpose: `gym.example.com` → `gym-mcp.example.com`,
// not `mcp.gym.example.com`. Cloudflare's free certificate covers `*.example.com` only, so a
// second-level subdomain fails TLS there — the most likely proxy for someone following a guide.
// A bare domain gets `mcp.` in front; an IP address or `localhost` has no domain to borrow.
export function suggestMcpHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return 'mcp.example.com'
  const labels = host.split('.')
  if (labels.length < 3) return 'mcp.' + host
  return labels[0] + '-mcp.' + labels.slice(1).join('.')
}
