/* Tool registration for the remote (Streamable HTTP) server. Every call runs as the openGym user
   who approved the OAuth connection: the uid comes from the verified token, never from the
   request, so a connection has no way to name another account. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { TOOLS } from './tools.js'
import { WRITE_TOOLS } from './write-tools.js'
import { withProfile } from './state.js'

const denied = message => Object.assign(new Error(message), { code: 'FORBIDDEN' })

// `authInfo` is what oauth.js verifyAccessToken() returned. Destructive tools are not run
// directly: they are queued with `requestApproval` until the user approves them in Settings,
// and run again from there with `approvedRequest` set.
export async function executeTool(tool, params, authInfo, requestApproval = null) {
  const uid = authInfo?.extra?.userId
  if (!uid || !authInfo.scopes.includes('opengym:read')) throw denied('incomplete OAuth grant')
  if (tool.write && !authInfo.scopes.includes('opengym:write')) throw denied('this connection is read-only; reconnect and allow write access')
  if (tool.destructive && authInfo.extra.approvedRequest == null) {
    if (!requestApproval) throw Object.assign(new Error('approval in openGym is required'), { code: 'APPROVAL_REQUIRED' })
    return requestApproval(authInfo, tool, params)
  }
  return withProfile(uid, () => tool.handler(params))
}

export function createMcpServer({ authInfo, requestApproval }) {
  const server = new McpServer({ name: 'opengym', version: '0.1.0' })
  const canWrite = authInfo.scopes.includes('opengym:write')
  for (const tool of [...TOOLS, ...WRITE_TOOLS]) {
    if (tool.write && !canWrite) continue
    const hints = { readOnlyHint: !tool.write, destructiveHint: !!tool.destructive, openWorldHint: false }
    server.tool(tool.name, tool.description, tool.schema, hints, async params => {
      try {
        const result = await executeTool(tool, params || {}, authInfo, requestApproval)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: `${err.code || 'ERROR'}: ${err.message}` }] }
      }
    })
  }
  return server
}
