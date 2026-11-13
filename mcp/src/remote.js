/* The profile read through the api instead of the data folder (#880): with OPENGYM_URL and
   OPENGYM_TOKEN and no OPENGYM_DATA on stdio, and always over HTTP (http.js). The MCP server then
   needs no access to ./data, which holds every profile on the instance, and can run anywhere.

   A scoped token (ogt_…, Settings → API tokens) reads /api/token/*, which hands it only its
   categories; a paired session reads the app's own /api/me and /api/data. Either way the document
   is fetched again only when the revision moved (one small request per tool call otherwise). */
import { apiFetch, profilePaths, isScoped } from './api-client.js'

const err = (code, message) => Object.assign(new Error(message), { code })

/** A cache of one profile behind one token: refresh() before a tool call, then snapshot(). */
export function createRemoteProfile(cfg, { fetchImpl } = {}) {
  const opts = fetchImpl ? { fetchImpl } : {}
  const paths = profilePaths(cfg)
  let user = null, scopes = null, state, rev = null, wid = null
  return {
    get scoped() { return isScoped(cfg.token) },
    /** Whose profile and what the token may do; asked once, then kept, unless `fresh` (the HTTP
     *  server asks on every request, so a revoked token is turned away at once). */
    async me({ fresh = false } = {}) {
      if (user && !fresh) return { user, scopes }
      const r = await apiFetch(cfg, paths.me, opts)
      const u = r.body?.user
      if (!u || typeof u.id !== 'string') throw err('EAPI', `the openGym server did not say whose token this is (GET ${paths.me})`)
      user = { id: u.id, name: typeof u.name === 'string' ? u.name : '' }
      scopes = r.body?.token?.scopes || null
      return { user, scopes }
    },
    async refresh() {
      await this.me()
      if (state !== undefined && rev !== null) {
        const r = await apiFetch(cfg, paths.rev, opts)
        if (r.body?.rev === rev && (r.body?.wid || null) === wid) return
      }
      const r = await apiFetch(cfg, paths.data, opts)
      state = r.body?.state && typeof r.body.state === 'object' ? r.body.state : null
      rev = typeof r.body?.rev === 'number' ? r.body.rev : 0
      wid = typeof r.body?.wid === 'string' ? r.body.wid : (state && typeof state._wid === 'string' ? state._wid : null)
    },
    /** What withProfile() takes. A copy each time: the tools may shape what they read. */
    snapshot() {
      return { state: state ? structuredClone(state) : null, user, scopes, api: cfg, invalidate: () => { rev = null } }
    },
    invalidate() { rev = null },
  }
}
