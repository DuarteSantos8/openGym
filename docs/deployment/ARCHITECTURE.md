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
| How the browser reaches the API | Vercel external rewrite `/api/*` | Same origin: session cookies, CSP `connect-src 'self'` and passkey RP stay unchanged | Direct cross-origin calls: needs CORS and cookie changes in the API |
| SPA fallback rewrite | None | The app uses `HashRouter`; every route is `/#/…` and `/` always exists | — |
| API replicas | 1 | `db.json` is held in memory and rewritten whole on each save | More replicas would lose writes |
| Railway `ironvane-web` (nginx) | Keep for now, not in the browser path | It is the only place serving `/mcp` and OAuth discovery on one origin with the app; the MCP connector origin (open PR #147, `MCP_PUBLIC_ORIGIN`) decides whether it is needed. Its health was repaired (`NGINX_PORT=3000`) | Remove now: would drop the only working Railway endpoint for MCP OAuth discovery before a replacement exists |

## Preview isolation

Preview deployments must not write production data. The `next/cloud-preview` build is the Cloud
edition (`VITE_EDITION=cloud`, Supabase URL and publishable key scoped to that branch only). Its
`/api` rewrite is the same file as production, so until a separate staging API exists, a preview
that signs in writes to the production API. Mitigation when previews multiply: a staging Railway
environment and a preview-only rewrite target.
