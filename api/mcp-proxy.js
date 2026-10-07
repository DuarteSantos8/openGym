// Settings → MCP / AI talks to the optional MCP container through here, so the browser only ever
// calls its own origin. The container checks the session cookie and the cross-origin headers
// itself; this only forwards them. The consent page does not come through here — nginx sends
// /mcp-authorize to the container directly.
export const MCP_ENABLED = !!process.env.MCP_INTERNAL_URL;

const ROUTES = { '/manage': '/manage', '/revoke': '/manage/revoke', '/approve': '/manage/approve' };
const FORWARD = ['cookie', 'content-type', 'origin', 'sec-fetch-site'];
const MAX_BODY = 32 * 1024;

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function proxyMcp(req, res) {
  // 503 is what Settings reads as "not enabled on this server".
  if (!MCP_ENABLED) return reply(res, 503, { error: 'MCP is not enabled on this server' });
  const url = new URL(req.url, 'http://x');
  const target = ROUTES[url.pathname.slice('/api/mcp'.length)];
  if (!target) return reply(res, 404, { error: 'not found' });

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    if ((size += chunk.length) > MAX_BODY) return reply(res, 413, { error: 'request too large' });
    chunks.push(chunk);
  }
  const headers = {};
  for (const key of FORWARD) if (req.headers[key]) headers[key] = req.headers[key];
  let response;
  try {
    response = await fetch(new URL(target, process.env.MCP_INTERNAL_URL), {
      method: req.method, headers, redirect: 'manual', signal: AbortSignal.timeout(10000),
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks)
    });
  } catch {
    // 502 is what Settings reads as "enabled, but the container is not answering".
    return reply(res, 502, { error: 'MCP service is unavailable' });
  }
  res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
  res.end(Buffer.from(await response.arrayBuffer()));
}
