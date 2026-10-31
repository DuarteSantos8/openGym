/* Where a paired token lives so the user never has to put it into the MCP config: a private file
   in the user's config directory, written by the pair_opengym tool and read by every write tool.
   OPENGYM_URL and OPENGYM_TOKEN in the environment still win, for anyone who prefers a config.

   The token is a full sign-in to the profile (api-client.js), so the file is 0600 in a 0700
   directory, written whole and renamed into place, and the token is never returned to the model,
   logged, or put into an error. */
import fs from 'node:fs'
import path from 'node:path'

/** The credentials file for `env`, or null when it names no home (a test's bare environment). */
export function credentialsPath(env = process.env) {
  const explicit = (env.OPENGYM_CREDENTIALS || '').trim()
  if (explicit) return explicit
  const base = (env.XDG_CONFIG_HOME || '').trim() || ((env.HOME || '').trim() && path.join(env.HOME.trim(), '.config'))
  return base ? path.join(base, 'opengym-mcp', 'credentials.json') : null
}

/** { url, token, user } as pair_opengym saved it, or null: no file, or one that is not ours. */
export function loadCredentials(env = process.env) {
  const file = credentialsPath(env)
  if (!file) return null
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof data?.url === 'string' && typeof data?.token === 'string' && data.url && data.token ? data : null
  } catch {
    return null
  }
}

/** Write the credentials, replacing any earlier ones. Returns the path written. */
export function saveCredentials(env, { url, token, user }) {
  const file = credentialsPath(env)
  if (!file) throw Object.assign(new Error('no place to keep the token: set OPENGYM_CREDENTIALS to a file path (HOME is not set)'), { code: 'ENOCONFIG' })
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ url, token, user: user || null, saved: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
  return file
}
