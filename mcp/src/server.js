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
  // The library is not the user's data: any token that may see workouts or plans gets it.
  search_exercises: [['workouts', 'view'], ['plans', 'view']],
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
  const alternatives = Array.isArray(need[0]) ? need : [need]
  return alternatives.some(([cat, lv]) => (RANK[scopes[cat]] || 0) >= RANK[lv])
}

/* What the assistant reads once when it connects (MCP `instructions`): how the tools fit together,
   so Claude, ChatGPT or Gemini plan with the library's ids and ask before they write. */
export const INSTRUCTIONS = [
  'openGym is the user\'s own gym tracker: their routines, weekly plan, logged workouts and body weight.',
  'Read before you advise: list_routines and get_week_plan for the plan, list_workouts and estimate_1rm for how training went, muscle_balance for what is under- or over-trained.',
  'To build or change a plan, find each exercise with search_exercises and pass its id, then call create_routine or update_routine with dry_run: true, show the user the preview and save only after they agree.',
  'To log a session the user describes, use log_workout (dry_run first if you had to guess anything).',
  'Weights are in the profile\'s unit (kg or lb) unless you say otherwise. Deleting needs the user\'s explicit yes.',
  'A tool that is missing was not granted: the user picks what you may see and change when they connect openGym.',
].join(' ')

/** A McpServer with the tools `scopes` allow. `around(fn)` runs each call (the HTTP server puts
 *  the request's profile around it). */
export function buildServer({ scopes = null, around = fn => fn() } = {}) {
  // `name` is the id clients key tools by (mcp__opengym__…); `title` is what a client shows.
  const server = new McpServer({ name: 'opengym', title: 'openGym', version: VERSION, websiteUrl: 'https://opengym.ch' }, { instructions: INSTRUCTIONS })
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
