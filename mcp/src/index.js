#!/usr/bin/env node
/* Gains MCP server — stdio transport. The LLM client (Claude Desktop, Cursor, …) spawns
   this process locally, talks JSON-RPC over stdin/stdout, tears it down when the session ends.
   No extra container, no new outbound network — your data stays in a folder you control. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { TOOLS } from './tools.js'
import { init, getUser } from './state.js'

const server = new McpServer({
  name: 'gains',
  version: '0.1.0'
})

// Fail fast on bad config so a misnamed GAINS_DATA doesn't silently answer every call with
// the no-state sentinel. Always register every tool so the LLM sees the full list at
// handshake, even when state didn't resolve.
try {
  init()
  const u = getUser()
  console.error(`[gains-mcp] serving profile ${u.name} (${u.id})`)
} catch (e) {
  console.error(`[gains-mcp] ${e.message}`)
  // Don't exit — keep the tool listings up so the user sees a useful error after fixing their
  // env and restarting.
}

for (const t of TOOLS) {
  server.tool(
    t.name,
    t.description,
    t.schema,
    async (params) => {
      try {
        const result = t.handler(params || {})
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
