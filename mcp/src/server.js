import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

/** One registration path for local and remote clients; handlers may perform async API calls. */
export function createServer(tools, { authorize, remote = false, resourceMetadataUrl } = {}) {
  const server = new McpServer({ name: 'opengym', version: '0.2.0' }, {
    instructions: 'Use preview_session before advising training weights. Nutrition products are personal and measured per 100 grams. Clarify ambiguous products and quantities; never guess grams from pieces. Use the same entry UUID and payload for retries after uncertain writes. Read an entry and obtain user confirmation before deleting it. Dates use the server process timezone unless supplied explicitly.'
  })
  for (const tool of tools) {
    const scope = tool.scope || 'training.read'
    server.registerTool(tool.name, {
      title: tool.name.replaceAll('_', ' '), description: tool.description,
      inputSchema: z.object(tool.schema).strict(),
      annotations: { readOnlyHint: !tool.write, destructiveHint: !!tool.destructive,
        idempotentHint: !tool.write || !!tool.idempotent, openWorldHint: false },
      ...(remote ? { _meta: { securitySchemes: [{ type: 'oauth2', scopes: [scope] }] } } : {})
    }, async params => {
      try {
        if (authorize) await authorize(scope)
        const result = await tool.handler(params || {})
        return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (err) {
        const code = err.code || 'ERROR'
        return { isError: true,
          ...(resourceMetadataUrl && ['invalid_token', 'insufficient_scope'].includes(code) ? {
            _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${resourceMetadataUrl}", scope="${scope}", error="${code}", error_description="Authorization required for this operation"`] }
          } : {}),
          structuredContent: { code, ...(err.status ? { status: err.status } : {}),
          ...(err.uncertain ? { outcome: 'unknown', retry_same_id: true } : {}) },
          content: [{ type: 'text', text: `${code}: ${err.message}` }] }
      }
    })
  }
  return server
}
