// Node remains the public API gateway. ASP.NET resolves the forwarded credentials via
// /api/me; no name, user id, body, query or client identity header is forwarded.
const base = process.env.NUTRITION_URL || 'http://127.0.0.1:5080';
const target = new URL('/api/nutrition/hello', base);
if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
  throw new Error('NUTRITION_URL must be an HTTP(S) URL without credentials');

/** MCP uses the same HTTP service, with a short-lived operation-bound credential, never SQLite. */
export async function requestNutrition(method, pathname, query = {}, body, credential) {
  const known = nutritionRoute(method, pathname)
    || (method === 'GET' && ['/api/nutrition/products', '/api/nutrition/diary'].includes(pathname))
    || (method === 'POST' && pathname === '/api/nutrition/entries');
  if (!known) throw new Error('Unsupported Nutrition operation');
  const url = new URL(pathname, base);
  for (const key of pathname.endsWith('/products') ? ['search', 'offset'] : ['date'])
    if (query[key] !== undefined) url.searchParams.set(key, query[key]);
  try {
    const response = await fetch(url, { method, headers: { Authorization: 'Bearer ' + credential,
      Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (![200, 201, 400, 401, 403, 404, 409, 410, 413].includes(response.status))
      throw new Error('Invalid Nutrition response');
    const raw = await response.text();
    if (raw.length > 8 * 1024 * 1024) throw new Error('Invalid Nutrition response');
    const result = JSON.parse(raw);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid Nutrition response');
    if (!response.ok) throw Object.assign(new Error(result.code || result.error || 'Nutrition request rejected'),
      { code: result.code || 'nutrition_error', status: response.status });
    return result;
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('Nutrition unavailable; check the diary or retry the identical entry ID and payload'),
      { code: 'nutrition_unavailable', status: 503, uncertain: method !== 'GET' });
  }
}

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

// Allowlisted paths only: never turn a client-supplied URL into an internal fetch target.
export function nutritionRoute(method, pathname) {
  const item = /^\/api\/nutrition\/(products|entries)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(pathname);
  return item && ['GET', 'PUT', 'DELETE'].includes(method) ? `${method} /api/nutrition/${item[1]}/{id}` : null;
}

export async function nutritionProxy(req, res, { readSession, json, readBody }) {
  if (!readSession(req)) return json(res, 401, { error: 'not signed in' });
  const incoming = new URL(req.url, 'http://gateway');
  const url = new URL(incoming.pathname, base);
  const allowed = incoming.pathname === '/api/nutrition/products' ? ['search', 'offset']
    : incoming.pathname === '/api/nutrition/diary' ? ['date'] : [];
  if (req.method === 'GET') for (const name of allowed) {
    if (incoming.searchParams.has(name)) url.searchParams.set(name, incoming.searchParams.get(name));
  }
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  for (const name of ['cookie', 'authorization']) if (req.headers[name]) headers[name] = req.headers[name];
  // Use the gateway's bounded JSON reader and preserve its 400/413/client-disconnect handling.
  const body = ['POST', 'PUT'].includes(req.method) ? JSON.stringify(await readBody(req)) : undefined;
  if (body && Buffer.byteLength(body) > 64 * 1024) return json(res, 413, { error: 'body too large' });
  try {
    const response = await fetch(url, { method: req.method, headers, body,
      redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (response.status >= 500) return json(res, response.status === 503 ? 503 : 502, { error: 'nutrition unavailable' });
    if (![200, 201, 400, 401, 404, 409, 410, 413].includes(response.status))
      return json(res, 502, { error: 'invalid nutrition response' });
    // The service's bounded catalog/day response may be larger than a write request.
    const raw = await response.text();
    if (raw.length > 8 * 1024 * 1024) return json(res, 502, { error: 'invalid nutrition response' });
    let result;
    try { result = JSON.parse(raw); }
    catch { return json(res, 502, { error: 'invalid nutrition response' }); }
    if (!result || typeof result !== 'object' || Array.isArray(result))
      return json(res, 502, { error: 'invalid nutrition response' });
    return json(res, response.status, result);
  } catch {
    return json(res, 503, { error: 'nutrition unavailable' });
  }
}
