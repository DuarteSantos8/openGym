# Architecture — hosted IronVane

```
browser ──HTTPS──► Vercel (project `opengym`, root `frontend/`, Vite static build, CDN)
                     │  /api/*  external rewrite (no CDN caching, x-vercel-enable-rewrite-caching: 0)
                     ▼
                  API  ── today: Render `ironvane-api` (disk /data)
                       ── target: Railway `ironvane-api` (volume /data, 1 replica)
                     ▲  private network (http://ironvane-api.railway.internal:3000)
MCP clients ─HTTPS─► MCP  ── Render `ironvane-mcp` / Railway `ironvane-mcp`
Supabase `ironvane` ── Cloud accounts (email) and the OAuth server the API signs in through (OIDC)
```

## Decisions

| Decision | Chosen | Why | Rejected alternative |
|---|---|---|---|
| Where the API runs | Railway service with a volume | File storage under `/data` needs a persistent disk and one writer | Vercel Functions: no persistent filesystem, many concurrent instances |
| How the browser reaches the API | Vercel external rewrite `/api/*` | Same origin: session cookies and the passkey RP stay unchanged. Note: the hosted build sends no Content-Security-Policy (`frontend/vercel.json` sets only `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`); the self-hosted nginx image sends one (`web/Dockerfile:133`). Porting it is a follow-up | Direct cross-origin calls: needs CORS and cookie changes in the API |
| SPA fallback rewrite | None | The app uses `HashRouter`; every route is `/#/…` and `/` always exists | — |
| API replicas | 1 | `db.json` is held in memory and rewritten whole on each save | More replicas would lose writes |
| Railway `ironvane-web` (nginx) | Keep until its replacement passes the acceptance list below | It is the only place serving `/mcp` and OAuth discovery on one origin with the app today. Its health was repaired (`NGINX_PORT=3000`) | Remove now: would drop the only working Railway endpoint for MCP OAuth discovery before a replacement exists |

## MCP and OAuth discovery without `ironvane-web` (review of merged PR #147, 2026-11-27)

Recommendation: **one public origin, the production Vercel domain**, with `frontend/vercel.json`
external rewrites for `/mcp` and `/mcp/health` (→ MCP service) and
`/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-protected-resource`,
`/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration` (→ API), placed
before the `/api/:path*` rule, each with `x-vercel-enable-rewrite-caching: 0`. Leave
`MCP_PUBLIC_ORIGIN` unset so issuer, resource (`<origin>/mcp`) and the consent page share the origin.

Evidence and constraints:

- Vercel reserves only `/.well-known/acme-challenge`; other `/.well-known` paths can be rewritten.
  `docs/MCP_REMOTE.md:362-363` says otherwise and needs correcting.
- External rewrites time out at 120 s, equal to nginx's `/mcp` limit and the MCP `requestTimeout`.
  The transport is stateless JSON (`mcp/src/http.js:159`), so SSE through Vercel is not needed.
- Neither API nor MCP reads `Host`/`X-Forwarded-Host`; the issuer comes from `ORIGIN`.
- **Hard condition:** connector sign-ins and authorization codes live in API process memory
  (`api/server.js:2428-2429`). `/api/*`, `/.well-known/*` and the MCP service's `OPENGYM_API_URL`
  must reach the same single API process. Today they do not (Vercel `/api` → Render with MCP off;
  Railway MCP → Railway API), so connectors are switched on only at cutover, with the final domain.
- A separate connector origin (PR #147 option) cannot be the MCP service domain alone: that serves
  only `/mcp`, while discovery and `/api/oauth/*` live on the API. It still needs a router.

Acceptance before removing `ironvane-web`: discovery documents return the final domain as issuer
and are not cached; unauthenticated `POST /mcp` → 401 with the right `resource_metadata`;
`GET /mcp` → 405; dynamic registration 201; a full authorize → consent → token → `tools/list` →
scoped read and write flow, write refused on a read-only grant, refresh, revoke; a real Claude and
ChatGPT connector; a near-1 MB `/mcp` body passes and an oversized one gets the MCP's own 413; web
sign-in and a near-5 MB sync on the same domain; a rollback rehearsal to `ironvane-web`.

## Preview isolation

Preview deployments must not write production data. The `next/cloud-preview` build is the Cloud
edition (`VITE_EDITION=cloud`, Supabase URL and publishable key scoped to that branch only). Its
`/api` rewrite is the same file as production, so until a separate staging API exists, a preview
that signs in writes to the production API. Mitigation when previews multiply: a staging Railway
environment and a preview-only rewrite target.
