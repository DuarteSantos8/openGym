# openGym MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) bridge that lets an external LLM
application (Claude Desktop, Cursor, Cline, Continue, etc.) read your openGym profile —
routines, workouts, body-weight log, estimated 1RMs, and muscle balance — directly from your
self-hosted `./data` directory.

It runs locally as a stdio process, adds no new container, and reads the same
`state-<uid>.json` files the openGym api already writes. Read tools require only filesystem
access. Optional plan writing uses a paired OpenGym bearer token and the app's existing
revision-checked API. The LLM never sees passkeys, VAPID keys, or session secrets.

The numbers it answers with are computed by the **same pure functions the React UI uses**
(`frontend/src/lib/*.js`) — `estimate1RM`, `loadOfWorkouts`, `effectiveRoutine`, etc. — so a
"what's my bench 1RM?" answer matches the Stats screen exactly.

> The MCP can create, edit, and delete routines when paired as a device, and assign new
> routines to weekdays. It cannot log workouts or change bodyweight entries.

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

Eleven read tools and three write tools:

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
| `search_exercises` | Find exercise IDs, including custom exercises, for a proposed plan. |
| `list_exercises` | Browse the full built-in and custom exercise catalogue in pages (default 100, maximum 200). Follow `next_offset` until null. |
| `create_training_plan` | Add routines and optionally assign them to specific weekdays (requires a paired token). |
| `edit_routine` | Edit a routine's name, icon, progression policy, or ordered exercise list by ID (requires a paired token). |
| `delete_routine` | Delete a routine and clear its schedule assignments, preserving workout history (requires a paired token). |

For edits, use `list_routines` / `get_routine` to find the routine ID. Omitted fields stay
unchanged. Supplying `exercises` replaces the complete ordered list; settings on retained IDs
are preserved except for supplied targets, and orphan superset links are cleared. Use
`preview_session` afterwards because progression and history can override routine targets.
Show the user the proposed changes before calling a write tool. Deletion follows the same
behavior as the app: an emptied weekday assignment is removed, as is a date-specific override
pointing at the deleted routine. An affected date then falls back to its weekday plan.
The app's existing sync limitation still applies: a stale device merging during a conflict
can restore a deleted routine, since routine deletions have no tombstones.

### Pairing for routine writes

In the signed-in openGym web app, go to Settings → Pair the mobile app. From the repository
root, run the helper with the same data directory and profile as your MCP server:

```bash
OPENGYM_DATA=/path/to/openGym/data OPENGYM_UID=<your-uid> \
  OPENGYM_API_URL=https://gym.example.com node mcp/scripts/pair-chatgpt.mjs
```

Enter the one-time code when prompted. The helper saves `OPENGYM_API_URL` and
`OPENGYM_API_TOKEN` in the ignored `mcp/.private/tunnel.env` file without printing the token.
Use HTTPS or a loopback HTTP URL. Omit `OPENGYM_UID` for a single-profile instance.

Pass both settings to the MCP server through your client's `env` configuration or your
service's environment file, then restart the client. The server does not load the env file
automatically. Read tools need no token. Plan writes use the revision-checked API, so
concurrent phone syncs cause retries instead of lost workouts. A token expires with its
session and is revoked by **Sign out everywhere**; pair again when needed.

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
- **No new container.** stdio transport is spawned by the LLM client; nothing to add to
  `docker-compose.yml`.
- **Read access uses the filesystem.** Plan writes use a paired OpenGym token and the existing
  API. No passkey material, VAPID keys, or session secrets cross the MCP boundary.
- **No telemetry.** Read tools use `./data/*.json`; the optional plan tool calls only the
  configured OpenGym API.

## Tests

```bash
cd mcp && npm test
```

The suite covers read tools, plan writes, and revision conflicts. Read tests seed state from
`frontend/src/lib/demoSeed.js` (the same deterministic fixture the public demo runs on). It
pins JSON shape and the user-facing edge cases: rest-day override,
missing routine, zero-workout history, no synced state, superset links, three 1RM formulas.
"Today" is pinned via `vi.useFakeTimers({ now: ..., toFake: ['Date'] })` so date-dependent
tools see consistent values regardless of when the suite runs. The pure lib functions have
their own 92 tests in `frontend/src/lib/*.test.js`.

## Roadmap

- **Done (Phase 1):** read-only stdio, 8 tools, direct `./data` access.
- **Done (Phase 1.5):** `preview_session` — the policy's next prescription, the opening set
  rows it produces, and which of plan / confirmed weight / history each number came from.
- **Done (limited write):** create, edit, and delete routines through the revision-checked API
  with a paired bearer token; create plans with weekday assignments.
- **Future write tools:** logging workouts and bodyweight, and
  date overrides.
- **Phase 3:** Streamable HTTP transport, opt-in 4th container in `docker-compose.yml`. Same
  tool implementations, second transport — the MCP SDK supports both behind one tool registration.

## License

AGPL-3.0-or-later, same as openGym.
