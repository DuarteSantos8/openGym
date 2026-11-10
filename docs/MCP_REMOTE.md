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

### Claude, ChatGPT and Gemini: sign in with openGym (OAuth)

This is the "use your subscription" route: the assistant app people already pay for comes to
openGym, not the other way round. **Settings → Use your subscription** in the app walks through it
with the exact address, a QR code, a link to each app's connector page and a status that turns to
"Connected via Claude" once the assistant has used its token. Nobody pastes an API key, and no
Claude or ChatGPT login ever reaches openGym (Anthropic's terms forbid third-party apps from using
claude.ai logins; a connector is the way they allow).

Claude, ChatGPT and Gemini add a custom connector by its address and then sign in with OAuth. With
`MCP=on`, openGym is that sign-in: the assistant identifies itself, sends you to openGym, you pick
what it may see and change, and it gets an ordinary scoped token (listed under Settings → API
tokens and Use your subscription as "Claude (connector)", revocable there like any other). Nothing
else is needed on the server.

| App | Where | Plan (as of 2026-11) |
|---|---|---|
| **Claude** (web, Desktop, mobile once added) | [Customize → Connectors](https://claude.ai/customize/connectors) → Add custom connector. Name openGym, the address, OAuth fields empty, then Connect. | Free (one custom connector), Pro, Max, Ultra; on Team and Enterprise an Owner adds it under Organization settings → Connectors and members connect. ([Anthropic](https://claude.com/docs/connectors/custom/add-unlisted)) |
| **ChatGPT** (web) | [Plugins](https://chatgpt.com/plugins) → + → Add custom MCP server. Name, the address, authentication OAuth, then Create. | Paid plans; Business and Enterprise workspaces decide whether members may add their own, and some plans get read tools only. ([OpenAI](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)) |
| **Gemini** (web app), where available | Settings & help → Connected apps → Add a custom app, the address. | Reported since mid-2026 for personal Google accounts on some Google AI plans and countries; Google documents only Gemini Enterprise's own route so far. |

Organisations with Claude's request-header connectors (beta) can instead put
`Authorization: Bearer ogt_…` there.

What the sign-in is, for the curious (api/oauth.js), checked against
[Claude's connector requirements](https://claude.com/docs/connectors/building/authentication) and
[ChatGPT's](https://developers.openai.com/apps-sdk/build/auth):

- **Discovery.** The mcp container answers an unauthenticated call with `401` and
  `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="…"`
  (Claude starts sign-in from a 401 only). The protected resource document names the address you
  pasted as `resource` and openGym as the only authorization server, whose RFC 8414 metadata is
  also served under the OpenID Connect name.
- **Who the assistant is.** Client ID Metadata Documents (`client_id_metadata_document_supported`):
  Claude and ChatGPT identify themselves with an https `client_id` that openGym fetches (public
  internet only, 5 KB, 5 s, cached an hour), so no registration piles up. Dynamic Client
  Registration (RFC 7591) stays for clients that use it. Public clients only (`none`).
- **The sign-in.** PKCE with S256 only, the redirect matched exactly (a loopback one on any port,
  for Claude Code), `resource` (RFC 8707) must be this server's MCP address, a consent screen in
  the app (`#/connect/…`, signed-in only, shows the assistant and where it sends you back, and warns
  when that is a program on this computer), `iss` on every answer (RFC 9207).
- **Tokens.** A one-time code bound to the client, the redirect and the verifier. A client that
  asks for `offline_access` (Claude adds it because the metadata lists it) or registered the
  `refresh_token` grant gets a refresh token: the access token then lives a day, each refresh
  rotates both on the same token row, and a refresh token used again after a grace minute ends
  the connection (OAuth 2.1 for public clients). The connection itself ends when you chose on
  the consent screen, or when you revoke it. Errors are RFC 6749 codes (`invalid_grant`).
- **Revocation.** RFC 7009 at `/api/oauth/revoke`, for an assistant that disconnects.
- **Limits.** At most ten tokens per profile; at the limit an older connector (the one used
  longest ago) makes room, so reconnecting Claude a few times never ends at a consent screen
  that cannot say yes.

**Under `BASE_PATH`.** The address is `https://<host><BASE_PATH>/mcp`, the issuer
`https://<host><BASE_PATH>`. The 401 points at the document below the prefix, and the metadata
answers at `<BASE_PATH>/.well-known/openid-configuration` as well as at the root's path-inserted
`/.well-known/oauth-authorization-server<BASE_PATH>` (when your proxy passes the root's
`/.well-known/` to openGym too). Pass the prefix through to openGym (`BASE_PATH=/gym`, docs/SELF_HOSTING.md
§5); a proxy that strips it leaves openGym unaware of it, and the sign-in then names the wrong address.

**Reachable from the internet.** Claude, ChatGPT and Gemini call the connector from their own
servers, so the address has to be public https (a reverse proxy, a Cloudflare tunnel). A LAN-only
or plain-http openGym works with the token header from a local client such as Claude Code or
Claude Desktop's local servers, not as a connector; the app says so on that screen. Anthropic's
traffic comes from `160.79.104.0/21` if you allowlist.

### Ask it

"Make me three full-body routines with only bodyweight and a pull-up bar", "how did my bench go this
month", "log today: squats 3x5 at 100 kg". Routines it makes appear in openGym at once and sync to
your phone; its writes need a token (or a sign-in) with Change directly for that category.

## What it serves

Stateless Streamable HTTP (MCP 2025-03-26 and later): `POST /mcp` with JSON-RPC, a JSON answer,
no session id, no GET stream. `GET /mcp/health` is the health check. The server's `instructions`
tell the assistant how the tools fit together: read first, find exercises with `search_exercises`,
preview writes with `dry_run`, save after the user agrees.

| Tool | Needs |
|---|---|
| list_routines, get_routine, preview_session, get_week_plan, get_programme | Plans: See |
| list_workouts, get_workout, estimate_1rm, muscle_balance | Workouts: See |
| search_exercises | Workouts or Plans: See (the library, not your data) |
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
- The connector sign-in's two open doors, registering a client and starting a sign-in, take 30
  requests a minute per address on the api (`OAUTH_ANON_PER_MIN`), then 429.

## Settings of the container

| Variable | Default | |
|---|---|---|
| `MCP_PORT` | 3100 | port inside the container |
| `OPENGYM_API_URL` | `http://api:3000` | the api inside the compose network |
| `MCP_PATH` | `/mcp` | path it answers on |
| `MCP_ALLOWED_ORIGINS` | `ORIGIN` | browser origins allowed, comma separated |
| `BASE_PATH` | empty | the subpath prefix, for the sign-in pointer of the 401 |

The web container reads `MCP_BACKEND` (`mcp`) and `MCP_PORT` (3100) to find it.

## Not yet

- Helm and the Kubernetes manifests do not include the mcp container.
- Phone-only openGym (no server) has nothing an assistant could reach; the in-app Coach with
  OpenRouter, an API key or a local model is the way there.
