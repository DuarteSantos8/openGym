// The one cloud client a build has: sign-in, the profile row and the project's functions, made
// from the build's environment the first time it is asked for. null when the build names no
// project, and then nothing here ever makes a request.
//
// Loaded only through import() behind the cloud edition (lib/edition.js): never in the default build.
import { cloudConfig, createAuth, CloudAuthError } from './auth.js'
import { createProfiles } from './profile.js'

export function buildCloud({ url, key }, { fetchImpl = (...a) => globalThis.fetch(...a), storage } = {}) {
  const auth = createAuth({ url, key, fetchImpl, ...(storage ? { storage } : {}) })
  const profiles = createProfiles({ url, key, auth, fetchImpl })
  /** Calls one of the project's functions as the signed-in user. `{ status, data }`, whatever the status. */
  async function fn(name, body = {}) {
    if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new CloudAuthError('validation_failed')
    const token = await auth.fresh()
    if (!token) throw new CloudAuthError('not_signed_in')
    let res
    try {
      res = await fetchImpl(`${url}/functions/v1/${name}`, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    } catch { throw new CloudAuthError('network') }
    return { status: res.status, data: await res.json().catch(() => null) }
  }
  return { auth, profiles, fn }
}

let made
/** This build's client, or null. */
export function cloud(env = import.meta.env) {
  if (made === undefined) { const cfg = cloudConfig(env); made = cfg ? buildCloud(cfg) : null }
  return made
}
