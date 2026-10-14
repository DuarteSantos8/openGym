#!/usr/bin/env node
/* openGym MCP server — stdio transport. The LLM client (Claude Desktop, Cursor, …) spawns
   this process locally, talks JSON-RPC over stdin/stdout, tears it down when the session ends.
   No extra container, no new outbound network — your data stays in a folder you control. */
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createServer } from './server.js'
import { TOOLS } from './tools.js'
import { init, getUser } from './state.js'

// Fail fast on bad config so a misnamed OPENGYM_DATA doesn't silently answer every call with
// the no-state sentinel. Always register every tool so the LLM sees the full list at
// handshake, even when state didn't resolve.
try {
  init()
  const u = getUser()
  console.error(`[opengym-mcp] serving profile ${u.name} (${u.id})`)
} catch (e) {
  console.error(`[opengym-mcp] ${e.message}`)
  // Don't exit — keep the tool listings up so the user sees a useful error after fixing their
  // env and restarting.
}

serveStdio(() => createServer(TOOLS))
// Process stays alive serving JSON-RPC over stdio until the LLM client disconnects.
