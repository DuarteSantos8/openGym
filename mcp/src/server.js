/* The MCP server with every tool registered, transport-free. index.js connects it to stdio,
   http.js builds one per request for the self-hosted container. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { TOOLS } from './tools.js'

export function buildServer() {
  const server = new McpServer({
    name: 'opengym',
    version: '0.1.0'
  })
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
  return server
}
