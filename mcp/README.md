# openGym MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) bridge that lets an external LLM
application (Claude Desktop, Cursor, Cline, Continue, etc.) read your openGym profile —
routines, workouts, body-weight log, estimated 1RMs, and muscle balance — directly from your
self-hosted `./data` directory.

It is read-only and runs one of two ways: locally, as a stdio process the LLM client spawns
(no container, no extra authentication), or as the opt-in `mcp` container of a self-hosted
instance, reachable at `https://<your host>/mcp`, where the client signs in through the app (see
[Self-hosted, over HTTPS](#self-hosted-over-https)). The LLM never sees passkeys, VAPID keys, or
session secrets — it can only read the same `state-<uid>.json` files the openGym api already
writes.

The numbers it answers with are computed by the **same pure functions the React UI uses**
(`frontend/src/lib/*.js`) — `estimate1RM`, `loadOfWorkouts`, `effectiveRoutine`, etc. — so a
"what's my bench 1RM?" answer matches the Stats screen exactly.

> Read-only today; write tools are planned but not shipped yet. See **Roadmap** below.

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

## Self-hosted, over HTTPS

For an instance run with `docker compose`, the `mcp` service serves the same tools over
Streamable HTTP. It mounts `./data` read-only, and the web container proxies `/mcp` to it, so the
endpoint is on the address the app already has: a Cloudflare tunnel or reverse proxy pointed at
the web container carries it with no change, and nothing new is opened on the host.

### 1. Turn it on

Add one line to `.env`, then `docker compose up -d`:

```bash
COMPOSE_PROFILES=mcp
```

There is no secret to generate. `ORIGIN` (already set for passkeys) is where clients are sent to
sign in.

### 2. Connect a client

Give the client `https://gym.example.com/mcp`. For example:

```bash
claude mcp add --transport http opengym https://gym.example.com/mcp
```

In apps that take a custom connector, paste the same URL. The client opens the app in a browser;
you sign in as usual (passkey, or password where the instance offers it) and approve the client
on the **Connect** screen. From then on it reads that profile only, for as long as it keeps
refreshing its token (90 days at most between uses).

Every person on a shared instance connects their own client and sees only their own data. To
disconnect every client of a profile, use **Sign out everywhere** in Settings; a new password, an
admin disabling the profile, or deleting it does the same. Each connection is recorded in the
admin activity log as "Connected an AI app".

How it works: the api is a small OAuth 2.1 authorization server (`api/oauth.js`, discovery at
`/.well-known/oauth-authorization-server`): dynamic client registration, PKCE (S256) only,
one-hour access tokens and rotating refresh tokens, stored in `db.json` as hashes. This server
checks the access token against that file and answers for the profile it belongs to.

Under a subpath (`BASE_PATH`) the discovery documents still have to be reachable at the root of
the host (`/.well-known/oauth-*`), which a proxy that only forwards the prefix does not do.

## Tools

Nine read-only tools in v1:

| Tool | What it answers |
|---|---|
| `list_routines` | What routines are saved in my profile? (names + exercise counts) |
| `get_routine` | What does the Push Day routine prescribe? (sets/reps/weight and rest per exercise) |
| `preview_session` | What will the app actually put on screen when I start this routine — after the progression policy and my history have overridden the plan? |
| `get_week_plan` | What's planned when: the next seven days with their routines and how each was decided (coach week, a pinned session, an override, the weekday plan), the current coach week when one is running, and the weekday table. |
| `list_workouts` | Recent sessions — newest first, with dates, sets done/planned, volume, duration, PRs. |
| `get_workout` | Full set-by-set breakdown of one session, by `workout_id` or by date. On a day with two sessions the date alone returns both ids to pick from rather than guessing at one. |
| `get_bodyweight` | Weigh-ins with the latest weight, the goal line, and deltas vs goal. |
| `estimate_1rm` | All-time best 1RM for an exercise + the trend, or a PR table across all exercises. |
| `muscle_balance` | Which muscles I've trained this week/month/all-time, ranked + which I've neglected. |

`get_routine` and `preview_session` answer two different questions, and confusing them is the
easiest way for a coach to give wrong advice. `get_routine` reports what the routine *stores*.
`preview_session` reports what the athlete will actually *see*: a routine holding "squat 3×8 @
60 kg" opens at 75 kg if the policy progressed or deloaded from that routine's last logged
session. The routine's own weight is the last fallback the session builder consults, not the
first; its reps hold unless a policy that moves reps moved them, or the profile starts planned
sessions from the last session (`starts_from`). Ask `preview_session` before naming a weight.

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
- **No container unless you ask for one.** stdio is spawned by the LLM client; the `mcp`
  compose service only starts with `COMPOSE_PROFILES=mcp`.
- **No new auth over stdio.** The filesystem is the boundary — same as `docker compose`
  running on the user's box. Over HTTP, OAuth through the app's own sign-in; no new kind of
  account. No passkey material, VAPID keys, or session secrets ever cross either.
- **No telemetry, no outbound network.** Reads `./data/*.json`, read-only.

## Tests

```bash
cd mcp && npm test
```

The tool cases seed state from `frontend/src/lib/demoSeed.js` (the same deterministic fixture
the public demo runs on). Pins JSON shape and the user-facing edge cases: rest-day override,
missing routine, zero-workout history, no synced state, superset links, three 1RM formulas.
"Today" is pinned via `vi.useFakeTimers({ now: ..., toFake: ['Date'] })` so date-dependent
tools see consistent values regardless of when the suite runs. The pure lib functions have
their own 92 tests in `frontend/src/lib/*.test.js`. `test/http.test.js` covers the HTTP transport
with tokens issued by `api/oauth.js`: two profiles kept apart, and every way a grant ends.

## Roadmap

- **Done (Phase 1):** read-only stdio, 8 tools, direct `./data` access.
- **Done (Phase 1.5):** `preview_session` — the policy's next prescription, the opening set
  rows it produces, and which of plan / confirmed weight / history each number came from.
- **Done (Phase 3, ahead of 2):** Streamable HTTP transport (`src/http.js`, stateless), opt-in
  `mcp` container proxied at `/mcp`, OAuth through the app's sign-in (`api/oauth.js`).
- **Phase 2:** read+write over stdio. Requires a long-lived token auth path minted from the
  admin dashboard (new `./data/tokens.json`) and a write-lock against the web UI's read-modify-
  write of `state-<uid>.json`. Tools: `log_workout`, `add_bodyweight`, `edit_routine`,
  `assign_weekday`, `override_day`.

## License

AGPL-3.0-or-later, same as openGym.
