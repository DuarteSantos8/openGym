// Node remains the public API gateway. ASP.NET resolves the forwarded credentials via
// /api/me; no name, user id, body, query or client identity header is forwarded.
const base = process.env.NUTRITION_URL || 'http://127.0.0.1:5080';
const target = new URL('/api/nutrition/hello', base);
if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
  throw new Error('NUTRITION_URL must be an HTTP(S) URL without credentials');

export async function nutritionHello(req, res, { readSession, json }) {
  if (!readSession(req)) return json(res, 401, { error: 'not signed in' });
  const headers = { Accept: 'application/json' };
  for (const name of ['cookie', 'authorization']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  try {
    const response = await fetch(target, { headers, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (response.status === 401) return json(res, 401, { error: 'not signed in' });
    if (response.status === 503) return json(res, 503, { error: 'nutrition unavailable' });
    if (!response.ok) return json(res, 502, { error: 'invalid nutrition response' });
    const body = await response.json();
    if (typeof body?.message !== 'string' || !body.message.trim())
      return json(res, 502, { error: 'invalid nutrition response' });
    return json(res, 200, { message: body.message });
  } catch {
    return json(res, 503, { error: 'nutrition unavailable' });
  }
}
