# openGym MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) bridge that lets an external LLM
application (Claude Desktop, Cursor, Cline, Continue, etc.) read your openGym profile —
routines, workouts, body-weight log, estimated 1RMs, and muscle balance — using either the
legacy local stdio process or the opt-in Streamable HTTP gateway. The HTTP gateway has no
profile-data mount: every request carries a scoped, expiring bearer grant minted in Settings.
The direct bearer path is independent of OAuth, so a client that can send an
`Authorization: Bearer …` header does not need discovery, dynamic registration, or an
authorization server.
The LLM never sees passkeys, VAPID keys, or session secrets.

The numbers it answers with are computed by the **same pure functions the React UI uses**
(`frontend/src/lib/*.js`) — `estimate1RM`, `loadOfWorkouts`, `effectiveRoutine`, etc. — so a
"what's my bench 1RM?" answer matches the Stats screen exactly.

The local stdio process remains read-only. The HTTP gateway can submit a validated routine
proposal for an explicit in-app approval; it never writes a routine directly.

### Remote HTTP authorization (manual bearer)

Use this path for clients that accept a custom bearer header:

1. In openGym **Settings → MCP access**, create a named grant for the client. Select only the
   read scopes it needs (`exercise:read`, `routine:read`, `workout:read`, `bodyweight:read`,
   `progress:read`). Add `routine:propose` only for a short, explicitly approved proposal
   window.
2. Copy the token once into the client's secret/header storage and send it only as
   `Authorization: Bearer <one-time token>` to `https://gym.derrickserna.com/mcp`. Never put a
   token in a URL, source file, prompt, or log. The token is stored server-side only as a hash.
3. Set an expiry that matches the task. Revoke the named grant in Settings when the client is no
   longer needed; subsequent calls fail with `401` (or `403` for an insufficient scope).

The gateway validates the grant's user, audience, scopes, expiry, and revocation on every request.
It has no anonymous mode and no master-token fallback. This direct bearer flow does not call any
OAuth endpoint. The optional OAuth 2.1/PKCE bridge remains available for clients such as
Claude.ai that cannot attach arbitrary bearer headers; it exchanges the same user-scoped grant and
is not required by clients using the manual path.

## Quick start

### 1. Install

```bash
cd mcp
npm install
```

### 2. Point it at your data

The MCP server reads the same `./data` directory `docker compose up` creates. Pick the profile
to answer for — its user id is in `./data/db.json` under `users[].id`:

```bash
# single-user instance (the common self-hosted case) — auto-detected:
node src/index.js

# multi-user instance, or just to be explicit:
OPENGYM_UID=<your-uid> OPENGYM_DATA=/path/to/openGym/data node src/index.js
```

### 3. Register with your LLM client

Add the server to your LLM client's MCP config. For Claude Desktop, edit
`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "opengym": {
      "command": "node",
      "args": ["/absolute/path/to/openGym/mcp/src/index.js"],
      "env": {
        "OPENGYM_DATA": "/absolute/path/to/openGym/data",
        "OPENGYM_UID": "<your-uid>"   // optional — auto-detected if you have one profile
      }
    }
  }
}
```

For Cursor and other MCP-compatible clients, see the client's MCP docs — the same `command` +
`args` + `env` shape is what every stdio MCP server expects.

Restart the client; you should see the openGym tools appear with "serving profile \<name\>" on
the server's stderr.

## Tools

Twelve read-only tools plus two proposal/readback tools are available:

| Tool | What it answers |
|---|---|
| `list_routines` | What routines are saved in my profile? (names + exercise counts) |
| `get_routine` | What does the Push Day routine prescribe? (sets/reps/weight and rest per exercise) |
| `preview_session` | What will the app actually put on screen when I start this routine — after the progression policy and my history have overridden the plan? |
| `get_week_plan` | What's on my plan this week, including today with any date-specific override? |
| `list_workouts` | Recent sessions — newest first, with dates, sets done/planned, volume, duration, PRs. |
| `get_workout` | Full set-by-set breakdown of one session, by `workout_id` or by date. On a day with two sessions the date alone returns both ids to pick from rather than guessing at one. |
| `get_bodyweight` | Weigh-ins with the latest weight, the goal line, and deltas vs goal. |
| `estimate_1rm` | All-time best 1RM for an exercise + the trend, or a PR table across all exercises. |
| `muscle_balance` | Which muscles I've trained this week/month/all-time, ranked + which I've neglected. |
| `list_exercises`, `search_exercises`, `get_exercise` | Traverse the built-in and profile custom exercise catalogue. |
| `propose_routine` | Submit a validated draft for in-app approval (HTTP gateway only). |
| `get_routine_proposal` | Inspect a pending or approved proposal (HTTP gateway only). |

`get_routine` and `preview_session` answer two different questions, and confusing them is the
easiest way for a coach to give wrong advice. `get_routine` reports what the routine *stores*.
`preview_session` reports what the athlete will actually *see*: a routine holding "squat 3×8 @
60 kg" opens at 75 kg if the policy deloaded from the last logged session, and the rep counts
come from history, not the plan. The routine's own numbers are the last fallback the session
builder consults, not the first. Ask `preview_session` before naming a weight.

Each tool returns JSON the LLM can format as it likes; structured fields (sets, dates, levels)
are pre-formatted into human-readable labels in `src/labels.js` so the LLM doesn't need to
re-interpret them.

## How it reuses the training logic

The MCP server imports the training helpers under `frontend/src/lib/` directly as Node ESM
and calls the same functions the React UI does (`history.js`, `onerm.js`, `muscles.js`,
`exercises.js`). The numbers it returns match what the Stats screen shows, because they are
the same code.

The one lib file that wasn't Node-safe was `i18n.js` (Vite's `import.meta.glob` at module
top level) — split into `i18n-core.js` (pure, Node-safe) + `i18n.js` (Vite/React bits,
re-exports from core). `exercises.js` got a one-line `import.meta.env || {}` guard. No new
dependencies landed in `frontend/`, no public exports changed.

## Design constraints honoured

- **One runtime dependency beyond the MCP SDK:** none. No database driver, no HTTP framework.
- **Scoped remote auth.** The HTTP gateway stores no profile files and accepts only grants
  minted by the signed-in app; grants can be revoked without restarting it.
- **No second profile writer.** Proposal approval and ordinary sync both use the API's
  conditional state writer; the gateway itself never mounts `/data`.
- The local stdio process still reads `./data/*.json` and exits when its client disconnects.

## Tests

```bash
cd mcp && npm test
```

The suite seeds state from `frontend/src/lib/demoSeed.js` (the same deterministic fixture
the public demo runs on). Pins JSON shape and the user-facing edge cases: rest-day override,
missing routine, zero-workout history, no synced state, superset links, three 1RM formulas.
"Today" is pinned via `vi.useFakeTimers({ now: ..., toFake: ['Date'] })` so date-dependent
tools see consistent values regardless of when the suite runs. The pure lib functions have
their own 92 tests in `frontend/src/lib/*.test.js`.

## Roadmap

- **Done (Phase 1):** read-only stdio, catalogue + progress tools, direct `./data` access.
- **Done (Phase 1.5):** `preview_session` — the policy's next prescription, the opening set
  rows it produces, and which of plan / confirmed weight / history each number came from.
- **Done (Phase 2/3):** scoped Streamable HTTP transport in the optional `mcp` Compose service;
  proposals are validated, idempotent, and require an app-side approval with `If-Match`.
- **Future:** additional write tools remain intentionally out of scope; proposal approval is the
  only write path and stays behind the app UI and a short-lived scoped grant.

## License

AGPL-3.0-or-later, same as openGym.
