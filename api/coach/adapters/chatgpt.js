/* The Coach on a ChatGPT plan (preview, COACH_CHATGPT_PLAN=on; chatgpt-plan.js says what this is
 * and when OpenAI allows it).
 *
 * A plain HTTPS provider like the API-key ones (it spawns nothing), with two differences: the
 * credential is a Sign in with ChatGPT session that renews itself (the access token lives about
 * an hour), and the request follows the plan-usage preview rules: Responses API, store false,
 * stream true, no output-token cap or temperature. The session is read from and written back to
 * the Coach's instance credential (config.js), encrypted like every other one.
 */
import * as cfgStore from '../config.js';
import * as plan from '../chatgpt-plan.js';
import { sseEvents } from '../core/adapters/http.js';
import { SYSTEM_PROMPT } from '../core/system-prompt.js';

export const PROVIDER = 'chatgpt';
const API = plan.RESOURCE;
const hostLine = 'HTTPS · api.openai.com · your ChatGPT plan';

// One renewal at a time: the refresh token rotates, and two jobs racing it would leave one with
// a token OpenAI has already replaced (the docs: "serialize refreshes for the same session").
let renewing = null;
/** The stored session, renewed first when it is about to run out. { ok, cred } or { ok:false, error } */
export async function sessionFor(fetchImpl = globalThis.fetch, now = Date.now()) {
  if (renewing) return renewing;
  const cfg = cfgStore.load();
  const rec = cfgStore.authFor(cfg, PROVIDER);
  const cred = rec && rec.data ? cfgStore.decrypt(rec.data) : null;
  if (!cred || !cred.token) return { ok: false, error: 'not signed in with ChatGPT yet' };
  if (!plan.needsRefresh(cred, now)) return { ok: true, cred };
  renewing = (async () => {
    try {
      const r = await plan.refreshCredential(fetchImpl, cred, now);
      if (!r.ok) return r;
      // saveAuth would also reset who the credential is bound to; a renewal is the same account.
      const fresh = cfgStore.load();
      cfgStore.save({ auth: { ...fresh.auth, [PROVIDER]: { ...rec, data: cfgStore.encrypt(r.cred) } } });
      return { ok: true, cred: r.cred };
    } finally { renewing = null; }
  })();
  return renewing;
}

async function call(fetchImpl, url, init, timeoutMs, signal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true });
  try { return await fetchImpl(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}

export default {
  id: PROVIDER,
  runtime: 'HTTPS',
  spawns: false,
  needsRuntime: false,

  async check(cfg, env, opts = {}) {
    const r = await this.models(cfg, env, opts);
    return r.ok ? { ok: true, version: `${hostLine} · ${r.models.length} models`, models: r.models } : { ok: false, error: r.error };
  },

  /** The models this ChatGPT account may use (`visibility: list`), in the server's order. */
  async models(cfg, env, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 20000, signal } = {}) {
    const s = await sessionFor(fetchImpl);
    if (!s.ok) return { ok: false, error: s.error, models: [] };
    let res;
    try { res = await call(fetchImpl, API + '/models', { headers: { authorization: 'Bearer ' + s.cred.token } }, timeoutMs, signal); }
    catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'timed out' : 'could not reach api.openai.com', models: [] }; }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) return { ok: false, error: `${res.status} ${data?.error?.message || 'the model list was refused'}`.slice(0, 200), models: [] };
    const list = Array.isArray(data?.models) ? data.models.filter(m => m && m.visibility === 'list').map(m => m.slug) : Array.isArray(data?.data) ? data.data.map(m => m.id) : [];
    return { ok: true, models: list.filter(Boolean) };
  },

  async invoke({ prompt, system, schema, model, timeoutMs = 5 * 60000, fetch: fetchImpl = globalThis.fetch, signal }) {
    const s = await sessionFor(fetchImpl);
    if (!s.ok) return { code: 1, text: '', stderr: '401 ' + s.error, timedOut: false };
    let chosen = model;
    if (!chosen) {
      const m = await this.models(null, null, { fetch: fetchImpl });
      chosen = m.ok ? m.models[0] : null;
      if (!chosen) return { code: 1, text: '', stderr: m.error || 'no model available on this ChatGPT plan', timedOut: false };
    }
    const body = plan.responsesBody({ model: chosen, prompt, instructions: system ? SYSTEM_PROMPT + '\n\n' + system : SYSTEM_PROMPT, schema });
    let res;
    try {
      res = await call(fetchImpl, API + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + s.cred.token, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body) }, timeoutMs, signal);
    } catch (e) {
      return e.name === 'AbortError' ? { code: 1, text: '', stderr: 'timed out', timedOut: true } : { code: 1, text: '', stderr: 'could not reach api.openai.com', timedOut: false };
    }
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      let msg = '';
      try { msg = JSON.parse(raw)?.error?.message || ''; } catch { /* not JSON */ }
      return { code: 1, text: '', stderr: `${res.status} ${msg || 'ChatGPT refused the request'}`.slice(0, 300), timedOut: false };
    }
    const out = plan.foldResponses(sseEvents(raw));
    return out.ok ? { code: 0, text: out.text, stderr: '', timedOut: false } : { code: 1, text: '', stderr: out.error, timedOut: false };
  }
};
