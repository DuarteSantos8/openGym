#!/usr/bin/env node
/* openGym MCP server — stdio transport. The LLM client (Claude Desktop, Cursor, …) spawns
   this process locally, talks JSON-RPC over stdin/stdout, tears it down when the session ends.
   No extra container. Reading the data folder, the read tools make no network call; paired
   (OPENGYM_URL + OPENGYM_TOKEN, no OPENGYM_DATA), they read through your own openGym server as
   log_workout writes through it, and talk to nothing else. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { TOOLS } from './tools.js'
import { WRITE_TOOLS } from './write-tools.js'
import { init, getUser, apiMode, refresh } from './state.js'

const server = new McpServer({
  name: 'opengym',
  version: '0.1.0'
})

// Fail fast on bad config so a misnamed OPENGYM_DATA doesn't silently answer every call with
// the no-state sentinel. Always register every tool so the LLM sees the full list at
// handshake, even when state didn't resolve.
try {
  init()
  await refresh()
  const u = getUser()
  console.error(`[opengym-mcp] serving profile ${u.name} (${u.id})${apiMode() ? ' through the openGym api' : ''}`)
} catch (e) {
  console.error(`[opengym-mcp] ${e.message}`)
  // Don't exit — keep the tool listings up so the user sees a useful error after fixing their
  // env and restarting.
}

const READS = new Set(TOOLS)
for (const t of [...TOOLS, ...WRITE_TOOLS]) {
  server.tool(
    t.name,
    t.description,
    t.schema,
    async (params) => {
      try {
        // Through the api, a read tool first checks the revision and downloads the profile only
        // when it moved; reading the data folder this does nothing.
        if (READS.has(t)) await refresh()
        // log_workout talks to the server, so a handler may answer with a promise.
        const result = await t.handler(params || {})
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (err) {
        const code = err.code || 'ERROR'
        return {
          isError: true,
          content: [{ type: 'text', text: `${code}: ${err.message}` }]
        }
      }
    }
  )
}

const transport = new StdioServerTransport()
await server.connect(transport)
// Process stays alive serving JSON-RPC over stdio until the LLM client disconnects.
