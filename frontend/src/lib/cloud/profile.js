// The account's profile row in the hosted service (supabase/migrations/…_profiles.sql): a display
// name, an experience level and the link to the app's own server. Training data is NOT here and
// never goes through this file: it stays in the app's API (ADR 0010).
//
// The row is read and changed through the project's REST interface as the signed-in user, so the
// database's row level security decides what happens, not this code: someone else's row is not
// visible, and `node_uid` cannot be written whatever is sent. cleanProfilePatch only saves a
// round trip for what would be refused anyway.
//
// Loaded only through import() behind isCloud() (lib/edition.js): never in the default build.
import { CloudAuthError } from './auth.js'

const FIELDS = 'id,display_name,experience,node_uid'
const LEVELS = new Set(['beginner', 'intermediate', 'advanced'])

/** The part of a change a person is allowed to make: a name of at most 80 characters and a level. */
export function cleanProfilePatch(patch) {
  const out = {}
  if (!patch || typeof patch !== 'object') return out
  if ('display_name' in patch) {
    const name = typeof patch.display_name === 'string' ? patch.display_name.trim().slice(0, 80) : ''
    out.display_name = name || null
  }
  if ('experience' in patch && (patch.experience === null || LEVELS.has(patch.experience))) out.experience = patch.experience
  return out
}

export function createProfiles({ url, key, auth, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  const base = String(url).replace(/\/+$/, '') + '/rest/v1/profiles'

  async function call(method, query, { body, prefer } = {}) {
    const token = await auth.fresh()
    const id = auth.session()?.user?.id
    if (!token || !id) return null
    let res
    try {
      res = await fetchImpl(`${base}?${query(encodeURIComponent(id))}`, {
        method,
        headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new CloudAuthError('network') }
    if (!res.ok) throw new CloudAuthError('refused', res.status)
    const rows = await res.json().catch(() => [])
    return Array.isArray(rows) && rows[0] ? rows[0] : null
  }

  return {
    /** The signed-in user's row, or null when nobody is signed in. */
    get: () => call('GET', id => `select=${FIELDS}&id=eq.${id}`),
    /** Changes the name or the level. Resolves with the row as the server now has it. */
    update(patch) {
      const clean = cleanProfilePatch(patch)
      if (!Object.keys(clean).length) return Promise.resolve(null)
      return call('PATCH', id => `id=eq.${id}&select=${FIELDS}`, { body: clean, prefer: 'return=representation' })
    },
  }
}
