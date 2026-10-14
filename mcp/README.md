# openGym MCP server

Two entrances share the same tool registration and training handlers:

- **Local stdio:** the original nine read-only training tools, using `OPENGYM_DATA` and `OPENGYM_UID`.
- **Remote Streamable HTTP:** opt-in `/mcp` inside the existing Node API, with OAuth delegation and seven Nutrition API tools. No fourth image, new account system or published internal port.

Training statistics still use the pure functions in `frontend/src/lib/`. Remote calls obtain the verified user's snapshot through Node's existing state reader, not an AI-supplied user ID. State is scoped to one request; custom exercise names cannot leak through a global registry. Nutrition uses its existing HTTP API, historical snapshots, decimal totals and retry rules. MCP never opens SQLite or calculates nutrients.

## Local stdio (unchanged configuration)

```sh
cd mcp
npm ci
OPENGYM_DATA=/absolute/path/to/openGym/data OPENGYM_UID=<your-user-id> node src/index.js
```

`OPENGYM_UID` can be omitted for one profile. Client configuration remains:

```json
{
  "mcpServers": {
    "opengym": {
      "command": "node",
      "args": ["/absolute/path/to/openGym/mcp/src/index.js"],
      "env": {
        "OPENGYM_DATA": "/absolute/path/to/openGym/data",
        "OPENGYM_UID": "<your-user-id>"
      }
    }
  }
}
```

Only nine training tools are exposed over stdio. Do not give a remote client filesystem access or an OpenGym browser session.

## Enable a private remote connection

Remote MCP is **disabled by default**. For source use, install both packages (`npm ci --omit=optional` in `api`, `npm ci` in `mcp`). The Dockerfile installs them automatically. API builds now use the repository root:

```sh
docker build -f api/Dockerfile .
```

Administrators can now configure MCP in **Settings → MCP → MCP server settings**:
enable remote MCP, set its public URL, add predefined OAuth clients and paste exact
callback URLs. Save, then restart the API container. The page distinguishes current
settings from saved changes pending restart; it does not restart the service for you.
Only administrators can save; all signed-in users can copy connection details and
inspect/revoke their own connections. The page also explains permissions, dates and
safe Nutrition workflows. New UI copy is localized for English, Russian and German;
other languages use the English fallback.

GUI settings are written atomically to `data/mcp-settings.json` and override MCP
environment defaults on the next API start. Include this file in the normal data
backup. It contains public client configuration, never OAuth tokens or client secrets.
The server refuses corrupt saved settings instead of silently reverting to `.env`.

Without saved GUI configuration, the existing deployment's `.env` bootstraps MCP:

```dotenv
ORIGIN=https://gym.example.com
MCP_ENABLED=1
MCP_PUBLIC_URL=https://gym.example.com/mcp
MCP_OAUTH_CLIENTS=[{"client_id":"opengym-chatgpt","client_name":"ChatGPT","redirect_uris":["https://chatgpt.com/connector/oauth/REPLACE_WITH_YOUR_CALLBACK_ID"]}]
TZ=Europe/Berlin
```

The callback above is a placeholder. In ChatGPT's private plugin/custom MCP connection settings, choose OAuth with a predefined public client, enter the configured `client_id`, leave the client secret empty, and copy **the exact callback shown by that client** into `redirect_uris`. If authentication method selection is available, use `none`. Restart API after changing clients. Use only trusted exact callbacks, no wildcards. Other OAuth-capable MCP clients can have separate predefined IDs. This private-first release has no dynamic client registration (DCR) or client metadata document fetching (CIMD).

Connect to `MCP_PUBLIC_URL`, sign in to OpenGym with the existing login, then approve requested scopes. An already signed-in browser still gets explicit consent. When not signed in, the page links to OpenGym in another tab; reload consent after signing in. No app password or browser token is sent to ChatGPT.

`oidc-provider` handles authorization code + mandatory PKCE S256, exact redirect matching, opaque access tokens (10 minutes), rotating refresh tokens and grants with a maximum 30-day lifetime. Clients request `offline_access` for refresh. Refresh does not extend the grant indefinitely. The `resource` is the exact MCP URL.

| Scope | Access |
|---|---|
| `training.read` | Nine training tools |
| `nutrition.read` | Personal products, entries and daily totals |
| `nutrition.write` | Single-entry create, update and confirmed delete |

Every request/tool checks current account, session version, resource, grant and scope. Disabled/deleted users, revoked grants and **sign out all devices** lose access and refresh rights. Ordinary OpenGym sessions cannot authorize `/mcp`; MCP tokens cannot authorize ordinary `/api/*` operations. Tool scope errors carry `mcp/www_authenticate` for reauthorization; missing HTTP authorization returns `401` with discovery. Host/Origin checks, a 64 KiB body limit and per-user request budgets protect MCP; OAuth endpoints have a per-address budget.

### Inspect and revoke connections

Use the normal OpenGym authenticated API:

- `GET /api/mcp/connections` lists **your** grant/client IDs, scopes and creation times, never access/refresh tokens.
- `POST /api/mcp/connections/revoke` with JSON `{ "grantId": "<id-from-your-list>" }` revokes that grant and its linked artifacts. Normal same-origin CSRF checks apply. Another user's grant returns `404`.

**Settings → MCP → Your MCP connections** lists owned grants and asks for confirmation
before revoking one. The management endpoints remain available while remote MCP is
disabled. Disabling removes remote entrances only after API restart and does not erase
grants; revoke separately if they must remain invalid after re-enabling. **Sign out all
devices** is still the account-wide revoke option.

## Tools

Original names and calculation behavior are preserved:

| Tool | Purpose |
|---|---|
| `list_routines` | Saved routines and exercise counts |
| `get_routine` | Stored sets/reps/weight/rest |
| `preview_session` | Actual prescription after progression and history |
| `get_week_plan` | Next seven days, coach week and weekday plan |
| `list_workouts` | Recent sessions, volume, duration and PRs |
| `get_workout` | Full session by ID/date; ambiguous date returns IDs to choose from |
| `get_bodyweight` | Latest weight, goal and deltas |
| `estimate_1rm` | Best 1RM/trend or the PR table |
| `muscle_balance` | Trained and neglected muscles |

Ask `preview_session` before advising a weight: stored routine weight may differ from the opening prescription. JSON is returned as text and `structuredContent`. Training “today” uses the **process timezone**, not each user's timezone. Set `TZ`; explicit dates avoid ambiguity.

Remote-only Nutrition tools:

| Tool | Input / behavior |
|---|---|
| `nutrition_search_products` | Optional `search`, `offset`; paginated **personal** catalog |
| `nutrition_get_product` | `product_id` from catalog results |
| `nutrition_get_diary` | Explicit local `date` (`YYYY-MM-DD`); entries and service-computed totals |
| `nutrition_get_entry` | `entry_id`; inspect before edit/delete |
| `nutrition_create_entry` | New UUID `entry_id`, `product_id`, `quantity_grams`, `date`, optional `time` (`HH:mm` or null) |
| `nutrition_update_entry` | `entry_id`, complete quantity/date/time; optional intentional product replacement |
| `nutrition_delete_entry` | Exact `entry_id` and `confirmed: true` after confirmation |

Products contain values per 100 grams, not serving/piece weights. For “I ate 200 grams of buckwheat and two eggs,” search the user's catalog, clarify raw/cooked/brand ambiguity and obtain grams for eggs. Do not invent products or piece-to-grams conversions. A fully specified “record 200 g of this product on this date” needs no redundant confirmation. Each product is a separate write, so partly successful meals must be reported as partial, not atomic.

Generate one entry UUID before creation; retain the **identical UUID and payload** for retries. Nutrition returns the original entry for identical retries, `409 idempotency_conflict` for a different payload and `410 entry_deleted` after deletion. Timeout/network/malformed/upstream-error responses return `nutrition_unavailable`; writes include `outcome: "unknown"` and `retry_same_id: true`. Inspect the diary or retry the identical operation, never a fresh UUID. This prevents protocol retry duplicates, not a later independently generated duplicate natural-language command.

Updating without `product_id` retains historical nutrition even after product deletion; intentional replacement takes a new snapshot. Edits retain the existing last-write-wins contract, without optimistic concurrency. Delete confirmation is a client/user workflow guard, not cryptographic proof of user intent.

## Deployment and security boundary

Existing `web → api → nutrition` remains intact. nginx proxies `/mcp` without SSE buffering/caching, `/oauth/*`, and root `/.well-known/*` to Node. For prefix hosting use `BASE_PATH=/gym` and `MCP_PUBLIC_URL=https://gym.example.com/gym/mcp`; discovery stays at the origin root, including path-specific aliases. OAuth external scheme/host come from configuration, not forwarded input. MCP and `ORIGIN` must share one HTTPS origin; HTTP is allowed only for loopback development.

Reuse Cloudflare HTTPS. Do not cache dynamic routes or put interactive Access/challenge pages in front of MCP/token/discovery. Keep API/Nutrition ports internal. Cloudflare Tunnel can carry the same origin without extra origin ports. OpenAI Secure MCP Tunnel is not configured here; adding it later is a connectivity choice, not a different tool implementation.

Nutrition receives a 60-second HMAC-signed internal credential bound to user, grant, session version, HTTP method and path. It revalidates with Node and compares the delegated method/path. No broad browser session is manufactured or forwarded; product-catalog writes are not MCP tools.

Artifacts/signing keys are stored separately in `data/mcp-oauth.json`, AES-256-GCM encrypted with a key derived from existing `data/secret`. Back up and restore **both together**; protect backups as credentials. Corruption/mismatched secret fails startup closed. Do not delete this file as a “repair”; old backups can resurrect grants and need deliberate revoke-all/session-version reset. OAuth assumes **one Node writer**, like current JSON storage; replace the adapter with transactional shared storage before multiple replicas. Expired rows are swept on writes and capacity is bounded.

GHCR still publishes three application images after successful main CI. `dev` validates but does not deploy production. CI adds a disposable OAuth + real Nutrition smoke; deployment readiness optionally probes discovery and unauthenticated MCP through nginx without data mutations. Install the updated deployment script separately when releasing; this checkout does not modify Proxmox.

## Verification

```sh
cd mcp
npm test
npm run check:node-loadable
cd ../api
node --test test/mcp-oauth-store.test.js test/mcp-nutrition.test.js test/server-mcp.test.js test/server-nutrition.test.js
```

CI runs Nutrition tests and `scripts/ci/mcp-smoke.mjs http://localhost:8080 --disposable` on fresh containers only. The smoke creates accounts/products and must **never** target production. Tests cover isolation, real consent/PKCE/resource/scopes, HTTPS prefixes, persistence/rotation/revocation, storage failure rollback, uncertain writes and Nutrition retry/delete rules.

References: [OpenAI OAuth integration](https://developers.openai.com/plugins/build/auth), [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [oidc-provider](https://github.com/panva/node-oidc-provider).

Future tools can use the same registration path with explicit scopes and existing module/API rules. Atomic batches, workout/plan/bodyweight writes, per-user timezone, DCR/CIMD and publication review are outside v1. Live ChatGPT/Cloudflare behavior still needs integration validation; protocol tests alone are not that evidence.

AGPL-3.0-or-later, same as openGym.
