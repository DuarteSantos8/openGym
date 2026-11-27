# Production cutover — Render → Railway, behind the Vercel frontend

Status: **prepared, not executed.** Nothing here runs without the owner's explicit approval.
Platform ids are `<placeholders>`; the operator holds the real values privately.

## Target

```
browser / AI assistant ──HTTPS──► <domain>  (Vercel project opengym, production)
   /                      static app (CDN)
   /api/*                 external rewrite ─► Railway ironvane-api (one replica, volume /data)
   /mcp, /mcp/health      external rewrite ─► Railway ironvane-mcp ─private net─► same API
   /.well-known/oauth-*   external rewrite ─► Railway ironvane-api
   /.well-known/openid-configuration ─────► Railway ironvane-api
Supabase (auth project) ── OIDC sign-in for the API; OAuth app callback <domain>/api/oidc/callback
Render ironvane-api ── kept running in maintenance mode, unchanged, as the rollback copy
```

One public origin, one API process: `/api/*`, the discovery documents and the MCP service's
`OPENGYM_API_URL` all reach the same Railway API, because pending connector sign-ins and
authorization codes live in that process's memory (`ARCHITECTURE.md`).

## Gates — all must be true before the window

| # | Gate | Evidence required |
|---|---|---|
| G1 | Owner approves the cutover and the window | written approval |
| G2 | Permanent domain `<domain>` chosen, added to the Vercel project, DNS and HTTPS verified | Vercel domain `verified: true`; `https://<domain>/` 200 |
| G3 | Supabase OAuth app (Authentication → OAuth Apps) lists `https://<domain>/api/oidc/callback`; Site URL `https://<domain>`; Redirect URLs include `https://<domain>/**`; functions `APP_ORIGIN=https://<domain>`. Old entries kept until G-post | authorize probe with that `redirect_uri` → 302, not 400 |
| G4 | Hosted sign-in proven on Railway before cutover (Railway domain callback): sign-in, consent, callback, session restore, sign-out, user isolation | test record in the readiness report |
| G5 | Cutover PR ready and reviewed, **not merged**: `frontend/vercel.json` `/api/*` → Railway API; `/mcp`, `/mcp/health`, the four discovery paths with `x-vercel-enable-rewrite-caching: 0`, ordered before `/api/:path*`; contract test in `frontend/scripts/vercel.test.mjs` | CI green on the PR |
| G6 | Railway variables staged with `--skip-deploys`: API `ORIGIN=https://<domain>`, `RP_ID=<domain host>`, `MCP=on`; MCP `ORIGIN=https://<domain>`; `MCP_PUBLIC_ORIGIN` unset | `railway variables --json` (names and non-secret values) |
| G7 | No merge to `main` planned during the window (Render auto-deploys `api/**` and `render.yaml`; Railway auto-deploys `main`) | announced freeze on merges |
| G8 | Fresh backups: Render `/data` and Railway `/data` archived to the private backup directory | manifests saved beside the archives |

## Window (about 20 minutes; the app keeps working offline and retries its pushes)

1. **Freeze Render writes.** Render → `ironvane-api` → Settings → Maintenance Mode → on.
   Check: `https://ironvane-api.onrender.com/api/health` → 503 and the production app's
   `/api/health` → 503. SSH to the instance still works (Render keeps it running).
2. **Final Render backup.** `DATA_MIGRATION.md` steps 1–4: manifest, archive, second manifest
   (`--compare` exit 0 = nothing was written during the copy), extract and compare, sha256.
3. **Replace Railway `/data`.** Archive Railway's current `/data` first (it holds rehearsal and
   probe data only). Empty `/data` except `lost+found`, stream the Render archive in, then
   `railway redeploy -s ironvane-api` — one deploy applies the staged G6 variables and loads the
   data. Manifest Railway `/data`; `--compare` with the Render manifest must exit 0.
4. **Redeploy MCP** (`railway redeploy -s ironvane-mcp`) so it picks up its `ORIGIN`.
5. **Switch traffic.** Merge the G5 PR. Wait for the Vercel production deployment to be READY on
   `<domain>`; record its deployment id and commit SHA.
6. **Verify** (each with recorded output):
   - `https://<domain>/api/health` → 200, `writable: true`, `users` equal to the Render count, and
     **no** `rndr-id` / `x-render-origin-server` header (the answer comes from Railway).
   - `/api/config` → `oidc.webOrigin` = `https://<domain>`.
   - Discovery documents → issuer `https://<domain>`, resource `https://<domain>/mcp`, `no-store`,
     no `x-vercel-cache: HIT` on a repeat.
   - `POST /mcp` without a token → 401 with `resource_metadata` on `<domain>`; `GET /mcp` → 405.
   - Owner signs in on desktop and phone: existing workouts and settings appear; one new workout
     saves and reappears after reload and on the second device.
   - One AI-assistant connector: connect, list tools, one read, one write; a read-only grant
     refuses the write.
7. **Lift the freeze for users only.** Render **stays in maintenance mode**: it is the rollback copy
   and must never take writes again while Railway is live (no dual writer).

## Monitoring after cutover

| Check | Every | Healthy | Action when not |
|---|---|---|---|
| `GET https://<domain>/api/health` | 5 min | 200, `writable: true` | Railway logs; volume full or read-only → stop writes, page owner |
| `POST https://<domain>/mcp` (no token) | 15 min | 401 with `resource_metadata` on `<domain>` | MCP service down or ORIGIN drift |
| Discovery issuer | daily, and after every deploy | `https://<domain>` | revert the offending change |
| Railway volume usage | daily | < 80 % of the volume | grow the volume (owner, cost) |
| Railway / Vercel deployment status | every deploy | SUCCESS / READY | roll back the deploy in the platform |
| `/data` backup (manifest + archive to the private backup directory) | daily | `--compare` against the previous day lists only expected files | investigate missing or changed files |
| Railway spend vs a soft limit | weekly | under the limit | review usage; no hard limit is set today |

## Rollback

| Situation | Steps | Data impact |
|---|---|---|
| Before step 5 (traffic not switched) | Revert nothing in git; turn Render maintenance mode off | none: Railway took no user writes |
| After step 5, problem found before users wrote to Railway | Revert the G5 PR (Vercel redeploys `/api` → Render); Render maintenance mode off | none |
| After users wrote to Railway | Stop the Railway API process (only this freezes writes; `ROLLBACK.md`). Back up Railway `/data` with manifests. Copy it to Render `/data` over SSH while Render is still in maintenance mode, restart Render, `--compare` Render against the Railway manifest, then revert the G5 PR and turn Render maintenance mode off | none if the compare is equal; otherwise stop and keep both copies |
| Auth broken on `<domain>` | Supabase still lists the previous callback (G3 keeps old entries); point Railway `ORIGIN` back and redeploy, or roll back as above | none |

Rollback is rehearsed on the preview before the window: revert the vercel.json change on a branch
and confirm `/api/health` shows the Render headers again.

## After the rollback window (owner decisions, not part of the cutover)

- Retire Railway `ironvane-web` once the acceptance list in `ARCHITECTURE.md` passed on `<domain>`.
- Remove the old Supabase callbacks and the temporary preview Site URL.
- Remove the migration SSH keys (Render account key, Railway key) and revoke the preview
  automation-bypass secret if previews no longer need automated tests.
- Decide whether and when Render is suspended; it is never deleted without approval.
