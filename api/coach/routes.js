/* HTTP surface for the Coach — user routes and admin routes.
 *
 * Written as a factory taking server.js's own helpers rather than importing them: the helpers
 * are closures over the db and the session secret, and passing them in keeps this module free
 * of a cycle (and trivially testable against fakes).
 */
import * as cfgStore from './config.js';
import * as jobs from './jobs.js';
import { computeCohort } from './cohort.js';
import { adapterFor } from './adapters/index.js';
import { canDropPrivileges } from './adapters/spawn.js';
import { DATA_CATEGORIES } from './core/payload.js';
import { validateBaseUrl, baseUrlFor } from './core/providers.js';
import { CAPABILITY_IDS } from './core/catalog.js';
import * as credentials from './core/credentials.js';
import * as oauth from './core/oauth.js';

// Job failures the user sees, in the app's own voice. The raw provider detail never reaches
// them — it goes to the admin card, which is where someone can act on it (FR-47).
const USER_ERROR = {
  off: 'the Coach is not set up on this instance',
  busy: 'the Coach is already thinking about your training',
  cap: 'the Coach is resting — try again tomorrow',
  consent: 'the Coach needs your go-ahead first',
  // Verbatim, because it tells the user the one thing that resolves it and names who resolves
  // it. A vaguer message here turns into a support question for the person running the box.
  shared: cfgStore.SHARED_ACCOUNT_REFUSAL,
  unprivileged: 'the Coach is switched off on this instance for safety reasons'
};
const HTTP_FOR = { off: 503, busy: 409, cap: 429, consent: 403, shared: 409, unprivileged: 503 };

export function coachRoutes({ json, readBody, readSession, requireAdmin }) {
  /** Every user route starts the same way: signed in, feature on, feature reachable. */
  const guard = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    if (!cfgStore.isEnabled() || !cfgStore.isConnected()) { json(res, 503, { error: USER_ERROR.off }); return null; }
    return user;
  };
  const failEnqueue = (res, e) => {
    if (e instanceof jobs.CoachError) return json(res, HTTP_FOR[e.code] || 400, { error: USER_ERROR[e.code] || e.message, code: e.code });
    throw e;
  };

  return {
    /* ------------------------------ user ------------------------------ */

    // What the consent screen has to disclose, straight from the module that builds payloads,
    // so the screen cannot drift from what actually leaves (FR-09). Signed in only: the screen
    // that reads it sits behind a session anyway, and on an invite-only instance which provider
    // this box is wired to is nobody's business who has not been let in.
    'GET /api/coach/disclosure': async (req, res) => {
      if (!readSession(req)) return json(res, 401, { error: 'not signed in' });
      const cfg = cfgStore.load();
      json(res, 200, {
        provider: cfg.provider,
        providerLabel: cfgStore.providerMeta(cfg).label,
        categories: DATA_CATEGORIES,
        version: 1
      });
    },

    'GET /api/coach/status': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      json(res, 200, jobs.status(user.id));
    },

    'POST /api/coach/plan': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      try {
        const job = jobs.enqueue(user.id, {
          kind: 'create',
          intake: body.intake || null,
          refine: body.refine ? String(body.refine).slice(0, 1000) : null
        });
        json(res, 202, { job });
      } catch (e) { failEnqueue(res, e); }
    },

    'POST /api/coach/review': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      try {
        const job = jobs.enqueue(user.id, { kind: 'review', note: body.note ? String(body.note).slice(0, 1000) : null });
        json(res, 202, { job });
      } catch (e) { failEnqueue(res, e); }
    },

    // One workout, read closely. Nothing to apply — the card is kept in the user's log.
    'POST /api/coach/debrief': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      try {
        const job = jobs.enqueue(user.id, { kind: 'debrief', workoutId: body.workoutId ? String(body.workoutId).slice(0, 40) : null });
        json(res, 202, { job });
      } catch (e) { failEnqueue(res, e); }
    },

    /* How this profile sits against everyone else on the instance who opted in: medians only,
       at least three people, and nothing for a profile that does not share itself. */
    'GET /api/coach/cohort': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      if (!cfgStore.load().community) return json(res, 200, { ok: false, enabled: false });
      json(res, 200, computeCohort(user.id));
    },
    'POST /api/coach/cohort/share': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      json(res, 200, { ok: true, sharing: jobs.setShare(user.id, !!body.share) });
    },

    'POST /api/coach/pending/resolve': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      json(res, 200, jobs.resolvePending(user.id, {
        accepted: Array.isArray(body.accepted) ? body.accepted : [],
        rejected: Array.isArray(body.rejected) ? body.rejected : [],
        dismissed: !!body.dismissed
      }));
    },

    // Consent withdrawn, or the profile turned the Coach off: drop everything held server-side
    // for them at once, without waiting for a sync to carry the news (D5).
    'POST /api/coach/forget': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      jobs.clearUser(user.id);
      json(res, 200, { ok: true });
    },

    /* ------------------------------ admin ------------------------------ */

    'GET /api/admin/coach': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const cfg = cfgStore.load();
      const adapter = adapterFor(cfg.provider);
      // For the runtime-backed providers this asks "is the runtime there"; for an HTTPS one it
      // lists the models with the stored key, which is the round trip the card wants anyway.
      const cred = adapter?.spawns === false ? cfgStore.credentialFor(cfgStore.boundUidFor(cfg)) : undefined;
      const check = adapter ? await adapter.check(cfg, cfgStore.jobEnv(process.env.TMPDIR || '/tmp', cred?.ok ? cred : undefined)) : { ok: false, error: 'unknown provider' };
      const log = cfg.log || [];
      const today = new Date().toISOString().slice(0, 10);
      json(res, 200, {
        disabledByEnv: cfgStore.COACH_DISABLED,
        enabled: !!cfg.enabled,
        provider: cfg.provider,
        providers: Object.entries(cfgStore.PROVIDERS).map(([id, p]) => ({
          id, label: p.label, runtime: p.runtime,
          setupToken: !!p.setupToken, deviceLogin: !!p.deviceLogin, apiKey: !!p.apiKeyEnv,
          http: !!p.http, baseUrl: !!p.baseUrl, keyOptional: !!p.keyOptional, keyPlaceholder: p.keyPlaceholder || null,
          defaultModel: p.defaultModel || null,
          // A provider that offers a browser sign-in says so here, and the card draws its second
          // choice from it. The two credential choices stay visibly distinct — a single
          // "Connect" button that sometimes wants a key and sometimes a browser is what makes
          // logout and reauthentication ambiguous later.
          connect: p.connect || null,
          // The provider's own mark, when it has one. Served from this app's own /public.
          logo: p.logo || null,
          // Whether the picker's contents come from a filtered capability catalog rather than
          // the endpoint's whole inventory. The card uses it to say which rule produced the list.
          catalog: p.catalog ? (p.catalog.capability || true) : null,
          // Which providers already hold a key — so switching chips is visibly not a reset.
          connected: !!(cfgStore.authFor(cfg, id) && cfgStore.authFor(cfg, id).data)
        })),
        model: cfgStore.modelFor(cfg),
        models: cfg.models,
        baseUrl: cfgStore.providerMeta(cfg).http ? baseUrlFor(cfg.provider, cfg) : null,
        knownModels: check.models || null,
        caps: cfg.caps,
        community: !!cfg.community,
        runtime: { ok: !!check.ok, version: check.version || null, error: check.error || null, needsKey: !!check.needsKey },
        authMode: cfg.authMode,
        boundUid: cfgStore.boundUidFor(cfg),
        /* Whether a credential is filed, and whose — never the credential. `unreadable` is its
           own state rather than "not connected" because it has a specific cause and a specific
           fix: ./data was restored without its `secret`, so the blob is intact and undecryptable,
           and connecting again is the way out. */
        auth: (() => {
          const meta = cfgStore.providerMeta(cfg);
          const rec = cfgStore.authFor(cfg);
          if (!meta.oauthEnv && !meta.apiKeyEnv) return { state: 'not-required' };
          if (!rec || !rec.data) return { state: meta.keyOptional ? 'optional' : 'none' };
          if (!cfgStore.decrypt(rec.data)) return { state: 'unreadable' };
          return { state: 'connected', type: rec.type || null, account: rec.account || null, connectedAt: rec.connectedAt || null };
        })(),
        // Whether the privilege drop can actually be performed. Surfaced because the control
        // now fails closed: if this reads false, no job runs, and the admin needs to know that
        // from the card rather than from a user reporting that nothing happens. An HTTPS
        // provider has no process to drop, and the card must not show a red banner for it.
        unprivileged: adapter?.spawns === false
          ? { ok: true, dropped: false, why: 'this provider runs no child process' }
          : canDropPrivileges(),
        // Counts and outcomes only — never intake answers, payloads or proposals (FR-12/A4).
        // The same counter the instance cap reads, so the card and the cap cannot disagree.
        jobsToday: cfg.daily?.date === today ? cfg.daily.count : 0,
        lastSuccess: cfgStore.lastSuccess(),
        lastError: cfgStore.lastError(),
        recent: log.slice(-20).reverse().map(e => ({ at: e.at, kind: e.kind, trigger: e.trigger, outcome: e.outcome, errorClass: e.errorClass, ms: e.ms }))
      });
    },

    'POST /api/admin/coach/config': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const patch = {};
      if (body.enabled !== undefined) patch.enabled = !!body.enabled;
      const current = cfgStore.load();
      if (body.provider !== undefined) {
        if (!cfgStore.PROVIDERS[body.provider]) return json(res, 400, { error: 'unknown provider' });
        // Credentials, model and endpoint are all keyed by provider — switching never drops them.
        patch.provider = body.provider;
      }
      const target = patch.provider || current.provider;
      if (body.model !== undefined) {
        patch.models = { ...current.models };
        if (body.model) patch.models[target] = String(body.model).slice(0, 80); else delete patch.models[target];
      }
      if (body.baseUrl !== undefined) {
        if (!cfgStore.PROVIDERS[target].baseUrl) return json(res, 400, { error: `${target} has a fixed endpoint` });
        const v = validateBaseUrl(body.baseUrl);
        if (!v.ok) return json(res, 400, { error: v.error });
        patch.providerOptions = { ...current.providerOptions, [target]: { ...(current.providerOptions[target] || {}), baseUrl: v.value } };
      }
      if (body.community !== undefined) patch.community = !!body.community;
      if (body.caps) {
        patch.caps = {
          perProfileDaily: Math.max(0, Math.min(200, +body.caps.perProfileDaily || 0)),
          instanceDaily: Math.max(0, Math.min(5000, +body.caps.instanceDaily || 0))
        };
      }
      cfgStore.save(patch);
      json(res, 200, { ok: true });
    },

    'POST /api/admin/coach/test': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const r = await jobs.testRun();
      json(res, 200, r);
    },

    /* The models the configured endpoint serves, so the card can offer a list rather than a
       text field that goes stale with every model release. HTTPS providers only.

       `capability` narrows a provider whose catalog is filtered — OrcaRouter is the one — so the
       card can ask for the same rule the job will actually run under instead of the endpoint's
       whole inventory. An unknown value is refused rather than ignored: silently returning chat
       models to a caller that asked for embeddings is how a wrong picker looks correct. */
    'POST /api/admin/coach/models': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const cfg = cfgStore.load();
      const adapter = adapterFor(cfg.provider);
      if (!adapter || typeof adapter.models !== 'function') return json(res, 200, { ok: false, error: 'this provider does not list models', models: [] });
      const body = await readBody(req);
      let capability = null;
      if (body && body.capability !== undefined && body.capability !== null && body.capability !== '') {
        capability = String(body.capability);
        if (!CAPABILITY_IDS.includes(capability)) return json(res, 400, { error: `unknown capability "${capability}"` });
      }
      const cred = cfgStore.credentialFor(cfgStore.boundUidFor(cfg));
      const env = cfgStore.jobEnv(process.env.TMPDIR || '/tmp', cred.ok ? cred : undefined);
      json(res, 200, await adapter.models(cfg, env, capability ? { capability } : {}));
    },

    /* Connect the instance credential. Deferred while the fixture was the only provider — it
       has none, so there was nothing to connect. The real providers give it something to hold,
       which is the condition this route was waiting on.

       The token is accepted once and never read back: it is encrypted here and leaves again
       only as an environment variable on a job's child process. `type` has to match a variable
       the configured provider actually declares, so a Codex key cannot be filed under Claude
       and then silently go nowhere at job time. */
    'POST /api/admin/coach/connect': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const cfg = cfgStore.load();
      // A key may be filed for a provider that is not the active one, so the chips can be
      // prepared ahead of switching; by default it is the active provider's.
      const provider = body.provider !== undefined ? String(body.provider) : cfg.provider;
      if (!cfgStore.PROVIDERS[provider]) return json(res, 400, { error: 'unknown provider' });
      const meta = cfgStore.PROVIDERS[provider];
      const type = String(body.type || '');
      const envVar = (type === 'cli-token' || type === 'oauth') ? meta.oauthEnv
        : type === 'apikey' ? meta.apiKeyEnv : null;
      if (!envVar) {
        return json(res, 400, { error: `${provider} does not take a credential of type "${type}"` });
      }
      const token = String(body.token || '').trim();
      if (!token) return json(res, 400, { error: 'no token supplied' });
      cfgStore.saveAuth(provider, {
        type, account: String(body.account || '').slice(0, 120), data: cfgStore.encrypt({ token }), connectedAt: new Date().toISOString()
      });
      json(res, 200, { ok: true });
    },

    'POST /api/admin/coach/disconnect': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const provider = body.provider !== undefined ? String(body.provider) : cfgStore.load().provider;
      if (!cfgStore.PROVIDERS[provider]) return json(res, 400, { error: 'unknown provider' });
      // A disconnect is also the end of any sign-in that was in flight for that provider: the
      // pending attempt is dropped so a code fetched before the removal cannot refill the slot.
      if (cfgStore.PROVIDERS[provider].connect === 'pkce') oauth.registry.clear();
      cfgStore.saveAuth(provider, null);
      json(res, 200, { ok: true });
    },

    /* ------------------- OrcaRouter: connect with an account -------------------
       The second credential choice, beside the API-key field above. Out-of-band PKCE: the server
       holds the verifier, the admin opens the consent page and pastes back the code it displays.
       The alternative — a loopback redirect — needs a browser and a listener on the *same*
       machine, and this dashboard is served to whatever address the owner deployed it on.

       What these three routes must not do, and do not: return the verifier to the browser, keep a
       finished attempt alive, or let a completion from a superseded attempt write a credential.
       The registry's generation is the guard; every completion names the attempt it belongs to. */

    'POST /api/admin/coach/connect/orcarouter/start': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const cfg = cfgStore.load();
      const provider = cfgStore.PROVIDERS.orcarouter ? 'orcarouter' : cfg.provider;
      if (provider !== 'orcarouter') return json(res, 400, { error: 'the OrcaRouter provider is not registered' });

      const body = await readBody(req);
      const bounded = {};
      if (body && typeof body === 'object') {
        if (body.scope !== undefined) {
          const scope = String(body.scope || '').trim();
          if (scope && scope !== 'api') return json(res, 400, { error: 'scope must be "api"' });
          bounded.scope = scope || 'api';
        }
        if (body.loginHint) bounded.loginHint = String(body.loginHint).slice(0, 200);
      }

      const { url, scope, generation, expiresAt } = await credentials.pkceAdapter.begin(oauth, {
        scope: bounded.scope || 'api', loginHint: bounded.loginHint || null
      });
      json(res, 200, {
        ok: true,
        // The exact URL to open. Returned rather than opened server-side: the browser is on the
        // admin's machine, not this container's, so there is nothing here to open it with — and
        // showing it is also the fallback when their browser does not launch from a link.
        url,
        scope,
        // The generation the browser must quote back. Not a secret; the state and challenge are
        // in the URL and the verifier is not, which is the entire point.
        generation,
        expiresAt,
        appName: credentials.APP_NAME,
        consoleUrl: credentials.consoleUrl()
      });
    },

    'POST /api/admin/coach/connect/orcarouter/complete': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const cfg = cfgStore.load();
      const provider = 'orcarouter';
      if (!cfgStore.PROVIDERS[provider]) return json(res, 400, { error: 'unknown provider' });
      const meta = cfgStore.PROVIDERS[provider];
      if (!meta.apiKeyEnv) return json(res, 400, { error: `${provider} does not take a credential` });

      const body = await readBody(req);
      const generation = body.generation !== undefined ? Number(body.generation) : oauth.registry.generation();
      const attempt = oauth.registry.attemptFor(generation);
      if (!attempt) {
        // Expired, cancelled, or superseded by a newer attempt. Terminal, and it says which.
        return json(res, 409, { error: 'that sign-in is no longer pending — start it again', code: 'no-attempt' });
      }

      const code = String(body.code || '').trim();
      if (!code) return json(res, 400, { error: 'paste the code shown on the consent page' });

      let result;
      try {
        result = await credentials.pkceAdapter.complete(oauth, attempt, code);
      } catch {
        // Never let an unexpected throw escape with the request body in it.
        result = { ok: false, reason: 'network', message: 'Could not reach OrcaRouter. Check this server\'s network and try again.' };
      }
      // The attempt is spent either way: a code is single-use, and a failed exchange means the
      // next try starts from a fresh verifier regardless. The lock is released here so a denial
      // or a network error does not leave the card permanently busy.
      oauth.registry.clear(generation);

      if (!result.ok) {
        // A failure is reported in the same shape the API-key path uses for a bad input —
        // `{ error }` — so the card has one thing to render. `code` is the stable machine reason.
        const status = result.reason === 'rate-limited' ? 429 : result.reason === 'no-attempt' ? 409 : 400;
        return json(res, status, { ok: false, error: result.message, code: result.reason });
      }

      // The key goes into the same encrypted slot the pasted one does. Nothing downstream — the
      // transport, the catalog, the job env — can tell which of the two produced it.
      cfgStore.saveAuth(provider, {
        type: result.type,
        account: String(body.account || result.account || '').slice(0, 120),
        data: cfgStore.encrypt({ token: result.token }),
        connectedAt: new Date().toISOString(),
        via: result.via
      });
      json(res, 200, { ok: true, via: result.via, account: result.account || null, scope: result.scope });
    },

    // Explicit cancel. Idempotent, and safe when the attempt already completed or expired — the
    // card calls it on a Cancel button, a provider switch, and pagehide, and none of those may
    // fail because another one got there first.
    'POST /api/admin/coach/connect/orcarouter/cancel': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req).catch(() => ({}));
      const generation = body && body.generation !== undefined ? Number(body.generation) : null;
      oauth.registry.clear(generation);
      json(res, 200, { ok: true });
    },

    /* The reject path a person takes on the consent screen: they decline, and the card says so
       rather than sitting on a spinner until the attempt expires. */
    'POST /api/admin/coach/connect/orcarouter/denied': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      oauth.registry.clear();
      json(res, 200, { ok: true, reason: 'denied', message: 'Authorization was declined. Nothing was saved.' });
    },

    /* Still absent: `authMode`, and with it the per-profile credential routes. Instance mode is
       the whole of what these two routes serve, and per-profile needs its own connect/clear pair
       against saveProfileAuth/clearProfileAuth — a switch with nothing on the other side is worse
       than no switch, so it waits for the PR that builds that side. */

    /* Whose account this profile is about to spend. Its own route because both the Coach screen
       and the admin card must state it, and neither should be inferring it from settings. */
    'GET /api/coach/account': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      json(res, 200, cfgStore.accountFor(user.id));
    }
  };
}
