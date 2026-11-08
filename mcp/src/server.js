/* The tools as one MCP server, for either transport: stdio (index.js) and Streamable HTTP
   (http.js). With a scoped token's `scopes`, only the tools it can use are listed: a token that
   may only see workouts gets no plan tools and no write tools. The api checks every read and
   write again on its side (api/tokens.js); this list is so a client does not offer what would
   only be refused. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { TOOLS } from './tools.js'
import { WRITE_TOOLS } from './write-tools.js'
import { ROUTINE_TOOLS } from './routine-tools.js'

export const VERSION = '0.2.0'
export const ALL_TOOLS = [...TOOLS, ...WRITE_TOOLS, ...ROUTINE_TOOLS]

// What each tool needs of a scoped token: [category, level] (api/tokens.js TOKEN_CATEGORIES).
export const TOOL_NEEDS = {
  list_routines: ['plans', 'view'], get_routine: ['plans', 'view'], preview_session: ['plans', 'view'],
  get_week_plan: ['plans', 'view'], get_programme: ['plans', 'view'],
  list_workouts: ['workouts', 'view'], get_workout: ['workouts', 'view'], estimate_1rm: ['workouts', 'view'],
  muscle_balance: ['workouts', 'view'], get_bodyweight: ['bodyweight', 'view'],
  log_workout: ['workouts', 'apply'],
  create_routine: ['plans', 'apply'], update_routine: ['plans', 'apply'], delete_routine: ['plans', 'apply'],
}
const RANK = { off: 0, view: 1, apply: 2 }
const WRITES = new Set(['log_workout', 'create_routine', 'update_routine', 'delete_routine'])

/** Whether a token holding `scopes` can use tool `name`. No scopes (the data folder, a paired
 *  session): every tool. A tool not in TOOL_NEEDS is never offered to a scoped token. */
export function toolAllowed(name, scopes) {
  if (!scopes) return true
  const need = TOOL_NEEDS[name]
  if (!need) return false
  return (RANK[scopes[need[0]]] || 0) >= RANK[need[1]]
}

/** A McpServer with the tools `scopes` allow. `around(fn)` runs each call (the HTTP server puts
 *  the request's profile around it). */
export function buildServer({ scopes = null, around = fn => fn() } = {}) {
  // `name` is the id clients key tools by (mcp__opengym__…); `title` is what a client shows.
  const server = new McpServer({ name: 'opengym', title: 'openGym', version: VERSION })
  for (const t of ALL_TOOLS) {
    if (!toolAllowed(t.name, scopes)) continue
    const annotations = WRITES.has(t.name)
      ? { readOnlyHint: false, destructiveHint: t.name === 'delete_routine', idempotentHint: t.name === 'log_workout', openWorldHint: false }
      : { readOnlyHint: true, openWorldHint: false }
    server.tool(t.name, t.description, t.schema, annotations, async params => {
      try {
        const result = await around(() => t.handler(params || {}))
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: `${err.code || 'ERROR'}: ${err.message}` }] }
      }
    })
  }
  return server
}
