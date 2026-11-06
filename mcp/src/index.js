#!/usr/bin/env node
/* openGym MCP server — stdio transport. The LLM client (Claude Desktop, Cursor, …) spawns
   this process locally, talks JSON-RPC over stdin/stdout, tears it down when the session ends.
   No extra container. Two ways to read the profile:

   - the data folder (OPENGYM_DATA, or ./data): the read tools make no network call, and the write
     tools, once paired, talk to your own openGym server and nothing else;
   - the api (#880): with OPENGYM_URL and OPENGYM_TOKEN and no OPENGYM_DATA, everything goes
     through your server, so this process needs no access to ./data and can run on another
     machine. A scoped token (Settings → API tokens) then also decides which tools are listed.

   The same tools over HTTPS, for clients that cannot spawn a process: http.js. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer } from './server.js'
import { init, getUser, withProfile } from './state.js'
import { apiConfig, isScoped } from './api-client.js'
import { createRemoteProfile } from './remote.js'

const env = process.env
const viaApi = env.OPENGYM_SOURCE === 'api' || (env.OPENGYM_SOURCE !== 'data' && !env.OPENGYM_DATA && !!env.OPENGYM_URL && !!env.OPENGYM_TOKEN)

let server
if (viaApi) {
  let remote = null, scopes = null
  try {
    remote = createRemoteProfile(apiConfig(env))
    const me = await remote.me()
    scopes = isScoped(env.OPENGYM_TOKEN) ? me.scopes : null
    console.error(`[opengym-mcp] serving profile ${me.user.name} (${me.user.id}) through ${apiConfig(env).base}`)
  } catch (e) {
    // Every tool stays listed, so the user sees the reason on the first call after fixing it.
    console.error(`[opengym-mcp] ${e.message}`)
  }
  server = buildServer({
    scopes,
    around: async fn => {
      if (!remote) remote = createRemoteProfile(apiConfig(env))
      await remote.refresh()
      return withProfile(remote.snapshot(), fn)
    },
  })
} else {
  // Fail fast on bad config so a misnamed OPENGYM_DATA doesn't silently answer every call with
  // the no-state sentinel. Always register every tool so the LLM sees the full list at
  // handshake, even when state didn't resolve.
  try {
    init()
    const u = getUser()
    console.error(`[opengym-mcp] serving profile ${u.name} (${u.id})`)
  } catch (e) {
    console.error(`[opengym-mcp] ${e.message}`)
  }
  server = buildServer()
}

const transport = new StdioServerTransport()
await server.connect(transport)
// Process stays alive serving JSON-RPC over stdio until the LLM client disconnects.
