/* /api/integrations: the app's Settings → Integrations page talks to these. Handed the session
 * helpers by server.js, like coach/routes.js, so this module holds no closure over db or SECRET.
 * Every route needs a signed-in profile and only ever sees that profile's connections; ids are
 * looked up in the caller's own file, so another profile's id is simply "no such connection".
 * Documented in api/openapi.yaml (tag Integrations). */

export function integrationRoutes({ json, readBody, readSession, hub, audit = () => {} }) {
  // A refusal the hub throws ({ status, code, message }) is the caller's to read, never a 500.
  const guard = fn => async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try { await fn(req, res, user); }
    catch (e) {
      if (!e?.status) throw e;
      json(res, e.status, { error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) },
        e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : undefined);
    }
  };
  const idOf = body => (typeof body?.id === 'string' ? body.id.slice(0, 40) : null);

  return {
    'GET /api/integrations': guard(async (req, res, user) => {
      json(res, 200, hub.describe(user.id));
    }),

    'POST /api/integrations/connect': guard(async (req, res, user) => {
      const body = await readBody(req);
      const provider = typeof body.provider === 'string' ? body.provider.slice(0, 40) : '';
      const out = hub.connect(user.id, provider, body);
      audit(req, 'integration.connect', { user, msg: `${provider}: ${out.connection.label}` });
      json(res, 200, out);
    }),

    'POST /api/integrations/update': guard(async (req, res, user) => {
      const body = await readBody(req);
      json(res, 200, hub.update(user.id, idOf(body), body));
    }),

    'POST /api/integrations/disconnect': guard(async (req, res, user) => {
      const body = await readBody(req);
      const gone = hub.disconnect(user.id, idOf(body));
      audit(req, 'integration.disconnect', { user, msg: `${gone.provider}: ${gone.label}` });
      json(res, 200, { ok: true });
    }),

    'POST /api/integrations/test': guard(async (req, res, user) => {
      const body = await readBody(req);
      json(res, 200, await hub.test(user.id, idOf(body), typeof body.type === 'string' ? body.type : null));
    }),

    'POST /api/integrations/retry': guard(async (req, res, user) => {
      const body = await readBody(req);
      json(res, 200, await hub.retry(user.id, idOf(body)));
    }),

    'GET /api/integrations/log': guard(async (req, res, user) => {
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      json(res, 200, hub.log(user.id, id ? id.slice(0, 40) : null));
    }),
  };
}
