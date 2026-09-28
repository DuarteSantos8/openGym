# Remote MCP connector

The stdio bridge in `mcp/` needs the AI client to run on the machine that holds `./data`.
Hosted clients — Claude on the web or phone, ChatGPT, Cursor's cloud agents — cannot do that.
The optional `mcp` compose service serves the same tools, plus write tools, over Streamable
HTTP with OAuth 2.1 (authorization code + S256 PKCE, dynamic client registration).

Nothing changes on an instance that does not enable it.

## How it fits together

Two public HTTPS hostnames:

| Hostname | Serves | Login wall (e.g. Cloudflare Access) |
| --- | --- | --- |
| `gym.example.com` (`ORIGIN`) | the app, and the consent page at `/mcp-authorize` | allowed, with a bypass for `/mcp-authorize` |
| `gym-mcp.example.com` (`MCP_ORIGIN`) | `/mcp`, `/register`, `/token`, `/revoke`, `/.well-known/*`, `/health` | **not allowed** |

The AI service talks to the MCP hostname directly, so nothing may sit in front of it that
expects a browser login. The consent page is on the app's hostname because that is where the
passkey session cookie lives; nginx forwards it to the `mcp` container.

Pick the MCP hostname one level under your domain (`gym-mcp.example.com`, not
`mcp.gym.example.com`) if Cloudflare terminates TLS: its free certificate only covers
`*.example.com`.

## Enable it

In `.env`:

```env
MCP_ORIGIN=https://gym-mcp.example.com
MCP_WEB_PORT=127.0.0.1:8086
MCP_INTERNAL_URL=http://mcp:3001
```

```bash
docker compose --profile mcp up -d --build
```

`MCP_INTERNAL_URL` is what the api uses to reach the container for Settings; it is also what
tells the api that a second process now writes profile files (see [Concurrent writes](#concurrent-writes)).

Then point the MCP hostname at `MCP_WEB_PORT`. It binds to loopback by default, so the reverse
proxy or tunnel has to run on the same host; use `0.0.0.0:8086` (or a LAN address) otherwise.

**Cloudflare Tunnel** — add a second public hostname (a *published application route* in newer
dashboards) to the tunnel openGym already uses:

```text
gym.example.com      -> http://localhost:8080   (WEB_PORT)
gym-mcp.example.com  -> http://localhost:8086   (MCP_WEB_PORT)
```

If Access protects `gym.example.com`, add a Bypass application for exactly
`gym.example.com/mcp-authorize`. The page checks the openGym session itself; behind Access, a
client that opens it in a fresh browser gets stuck on the Access login instead.

**Caddy**:

```caddy
gym.example.com {
    reverse_proxy localhost:8080
}

gym-mcp.example.com {
    reverse_proxy localhost:8086
}
```

The MCP server only answers requests whose `Host` is one of the two hostnames (DNS-rebinding
protection); both are derived from the environment. If a proxy rewrites `Host`, list the extra
value in `ALLOWED_HOSTS` (comma-separated hostnames).

Settings → MCP / AI shows an administrator the same steps, filled in with the instance's own
hostnames, whenever the connector is disabled, not running, or not reachable from the browser.

## Connections

Paste `https://gym-mcp.example.com/mcp` (shown in Settings → MCP / AI) into the client. It
registers itself, opens the consent page, and the user approves read-only (the default) or
read-and-write access.

- A connection belongs to the user who approved it and only ever reads or writes that user's
  profile. There is no way to grant a connection another account, administrators included.
- Deleting tools (`delete_workout`, `delete_routine`, …) do not run straight away: the call is
  queued and runs once the user approves it in Settings, within 10 minutes.
- Revoking a connection in Settings, disabling the account, or "sign out everywhere" invalidates
  its tokens.
- The in-progress workout, passkeys, push subscriptions and admin operations are not reachable
  through any tool.

OAuth state lives in `./data/mcp-oauth/oauth.json` (tokens stored hashed). It is covered by the
usual `./data` backup.

## Concurrent writes

With `MCP_INTERNAL_URL` set, the api (`PUT /api/data`) and the MCP write tools update
`state-<uid>.json` through `api/state-store.js`: an exclusive lock file next to it, and a
compare-and-swap on the document's `_rev` — the revision the app already sends as `baseRev`.
Whichever side wrote from a stale copy gets a conflict instead of overwriting the other.

The lock is held only for the synchronous read-modify-write and is never taken over by age. If a
process dies in that instant, writes to that one profile answer "busy" until the lock is gone:
stop both `api` and `mcp`, delete `data/state-<uid>.json.lock`, start them again.

## Check it

```bash
curl -i https://gym-mcp.example.com/mcp        # 401 — expected without a token
curl -fsS https://gym-mcp.example.com/health
curl -fsS https://gym-mcp.example.com/.well-known/oauth-authorization-server
```

From a checkout, `node mcp/scripts/smoke.mjs` starts the api and the MCP server on throwaway
data and runs the whole flow: consent, PKCE, reads and writes, a conflicting browser write,
approval of a deletion, revocation and a read-only connection.
