# openGym MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) bridge that lets an external LLM
application (Claude Desktop, Cursor, Cline, Continue, etc.) read your openGym profile —
routines, workouts, body-weight log, estimated 1RMs, and muscle balance — directly from your
self-hosted `./data` directory.

It is read-only, runs as a stdio process spawned by the LLM client **or** as an HTTP server
reachable over the network, and requires no extra authentication (stdio) or an optional API
key (HTTP). The LLM never sees passkeys, VAPID keys, or session secrets — it can only read the
same `state-<uid>.json` files the openGym api already writes.

The numbers it answers with are computed by the **same pure functions the React UI uses**
(`frontend/src/lib/*.js`) — `estimate1RM`, `loadOfWorkouts`, `effectiveRoutine`, etc. — so a
"what's my bench 1RM?" answer matches the Stats screen exactly.

> Phase 1 + Phase 1.5 shipped. Read-only today; long-lived token auth + write tools are
> planned but not shipped yet. See **Roadmap** below.

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

## HTTP mode (remote access)

When the LLM client runs on a different machine (Kubernetes, a remote desktop, …) the stdio
transport won't work. HTTP mode runs the **Streamable HTTP** transport (the current MCP HTTP
spec) on a single endpoint that clients reach over the network.

### 1. Start the server

```bash
# local (Node installed):
OPENGYM_UID=<your-uid> OPENGYM_HTTP_PORT=3100 node src/http.js

# Docker (built via docker-compose):
OPENGYM_UID=<your-uid> docker compose up mcp
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `OPENGYM_DATA` | `./data` | Path to the data directory (same as stdio) |
| `OPENGYM_UID` | *(auto-detect)* | Profile to serve when no `?uid=` param is given. Auto-detected exactly like stdio mode (single state file / single profile in `db.json`) |
| `OPENGYM_HTTP_PORT` | `3100` | Port to listen on |
| `OPENGYM_API_KEY` | *(none)* | If set, requires `Authorization: Bearer <key>` header |

### 2. Connect from your LLM client

Point the client at `http://<host>:3100/mcp` (optionally with `?uid=<uid>` to pick the
profile). Most MCP clients speak Streamable HTTP natively — a bare `url` is enough; no
transport override, no SSE anything:

```jsonc
{
  "mcpServers": {
    "opengym": {
      "url": "http://<host>:3100/mcp?uid=<your-uid>",   // ?uid= optional when OPENGYM_UID is set
      "headers": {
        "Authorization": "Bearer <your-api-key>"        // only if OPENGYM_API_KEY is set
      }
    }
  }
}
```

The server:

- answers JSON-RPC on `POST /mcp` — the SDK mints a session id (stateful mode) returned in
  the `Mcp-Session-Id` response header, and every subsequent request must echo it.
- accepts `DELETE /mcp` to end a session.
- answers `405` to `GET /mcp` — this server never initiates messages, so the optional
  standalone SSE stream would have nothing to carry.
- exposes an unauthenticated `GET /health` used by the container healthcheck.

Multiple clients can be connected at once, each with its own session (and optionally its own
`?uid=`).

For Docker Compose deployments the service is optional — it is **not** started by a plain
`docker compose up`. Start it explicitly: `docker compose up mcp`.

## Tools

Nine read-only tools in v1:

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
  The HTTP mode uses the SDK's built-in `StreamableHTTPServerTransport`.
- **stdio: no new container.** Stdio transport is spawned by the LLM client; nothing to add to
  `docker-compose.yml`.
- **HTTP: opt-in 4th container.** The MCP Dockerfile and a `mcp` service in
  `docker-compose.yml` are optional — not started by a plain `docker compose up`.
- **No new auth (stdio).** The filesystem is the boundary — same as `docker compose` running on
  the user's box. No passkey material, VAPID keys, or session secrets ever cross it.
- **Optional API key (HTTP).** `OPENGYM_API_KEY` provides a simple Bearer-token guard. It is
  not a substitute for TLS; use it behind a reverse proxy with HTTPS in production.
- **No telemetry, no outbound network.** Reads `./data/*.json` and stays alive only while an
  LLM client is connected (stdio) or an SSE session is active (HTTP).

## Tests

```bash
cd mcp && npm test
```

58 cases seeding state from `frontend/src/lib/demoSeed.js` (the same deterministic fixture
the public demo runs on). Pins JSON shape and the user-facing edge cases: rest-day override,
missing routine, zero-workout history, no synced state, superset links, three 1RM formulas.
"Today" is pinned via `vi.useFakeTimers({ now: ..., toFake: ['Date'] })` so date-dependent
tools see consistent values regardless of when the suite runs. The pure lib functions have
their own 92 tests in `frontend/src/lib/*.test.js`.

## Roadmap

- **Done (Phase 1):** read-only stdio, 9 tools, direct `./data` access.
- **Done (Phase 1.5):** `preview_session` — the policy's next prescription, the opening set
  rows it produces, and which of plan / confirmed weight / history each number came from.
- **Done (Phase 1.5b):** Streamable HTTP transport — `src/http.js` + `mcp/Dockerfile` +
  optional `mcp` service in `docker-compose.yml`. Per-session profiles via `?uid=` query
  param, else auto-detected. Optional API key.
- **Phase 2:** read+write over stdio. Requires a long-lived token auth path minted from the
  admin dashboard (new `./data/tokens.json`) and a write-lock against the web UI's read-modify-
  write of `state-<uid>.json`. Tools: `log_workout`, `add_bodyweight`, `edit_routine`,
  `assign_weekday`, `override_day`.

## License

AGPL-3.0-or-later, same as openGym.
