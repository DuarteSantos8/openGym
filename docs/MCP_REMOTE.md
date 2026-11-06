# MCP over HTTPS

openGym's MCP tools at `https://<your host>/mcp`, for AI assistants that cannot start a process on
your computer: Claude or ChatGPT on the web and phone, another machine, an agent somewhere else.
The local stdio server ([mcp/README.md](../mcp/README.md)) keeps working as before.

It is an optional fourth container. It holds no data and no secret: it does not mount `./data`.
Every request carries a [scoped token](API_TOKENS.md), and every read and write goes through the
api with that token, which hands it only its categories. The tools a token cannot use are not
even listed.

## Turn it on

In `.env`:

```bash
COMPOSE_PROFILES=mcp   # starts the mcp container
MCP=on                 # tells the app to show the address in Settings
```

Then `docker compose up -d`. The web container already proxies `/mcp` to it, so whatever publishes
the app (a reverse proxy, a Cloudflare tunnel) carries it with no new route and no new port.
Without the container `/mcp` answers a JSON 503 saying MCP is not running.

## Connect an assistant

1. **Settings → Integrations → API tokens → New token.** Tick what it may see, and Change
   directly only where you want it to write (Workouts to log sessions, Plans & routines to make
   and change routines). Copy the token; it is shown once.
2. In the assistant, add a custom MCP connector with the address from that page
   (`https://<your host>/mcp`) and the header `Authorization: Bearer ogt_…`.

For a client configured by file, for example Claude Code:

```bash
claude mcp add --transport http opengym https://gym.example.com/mcp --header "Authorization: Bearer ogt_…"
```

or in a JSON config:

```json
{ "mcpServers": { "opengym": { "type": "http", "url": "https://gym.example.com/mcp",
  "headers": { "Authorization": "Bearer ogt_…" } } } }
```

Assistants that only offer an OAuth sign-in for custom connectors cannot pass a header yet; see
"Not yet" below.

## What it serves

Stateless Streamable HTTP (MCP 2025-03-26 and later): `POST /mcp` with JSON-RPC, a JSON answer,
no session id, no GET stream. `GET /mcp/health` is the health check.

| Tool | Needs |
|---|---|
| list_routines, get_routine, preview_session, get_week_plan, get_programme | Plans: See |
| list_workouts, get_workout, estimate_1rm, muscle_balance | Workouts: See |
| get_bodyweight | Body weight: See |
| log_workout | Workouts: Change directly |
| create_routine, update_routine, delete_routine | Plans: Change directly |

`update_routine` with `expected_revision` and `delete_routine` (which needs it, and
`confirm: true`) write over exactly the revision the user saw, or not at all: a profile that moved
comes back as a conflict to read again, never a retry against data nobody looked at.

## Security notes

- A paired session's token (the phone's) is refused here: only `ogt_` tokens, so a hosted
  assistant never holds a full sign-in.
- The token is checked with the api on every request, so a revoked one stops at once.
- A browser page from another origin is turned away (`Origin` must be `ORIGIN` or one of
  `MCP_ALLOWED_ORIGINS`); clients that are not browsers send none.
- 30 refused requests a minute per client address, then 429. The api's own per-token limits apply
  to everything else.

## Settings of the container

| Variable | Default | |
|---|---|---|
| `MCP_PORT` | 3100 | port inside the container |
| `OPENGYM_API_URL` | `http://api:3000` | the api inside the compose network |
| `MCP_PATH` | `/mcp` | path it answers on |
| `MCP_ALLOWED_ORIGINS` | `ORIGIN` | browser origins allowed, comma separated |

The web container reads `MCP_BACKEND` (`mcp`) and `MCP_PORT` (3100) to find it.

## Not yet

- OAuth sign-in for connectors that only speak OAuth (#781's flow): tokens come first because they
  are scoped and revocable per program; OAuth would issue the same kind of token after a consent
  screen.
- Helm and the Kubernetes manifests do not include the mcp container.
- Under `BASE_PATH` the endpoint is `<BASE_PATH>/mcp`.
