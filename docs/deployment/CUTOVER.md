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
| G3 | Supabase OAuth app (Authentication → OAuth Apps) lists `https://<domain>/api/oidc/callback`; Site URL `https://<domain>`; Redirect URLs include `https://<domain>/**`; functions `APP_ORIGIN=https://<domain>`. Keep only callbacks on hosts the owner controls: **remove the old team-scoped branch alias** (another Vercel account now holds that host, so a code sent there could be captured by it) | authorize probe with the new `redirect_uri` → 302, with the old alias → 400 |
| G4 | Hosted sign-in proven on Railway before cutover (Railway domain callback): sign-in, consent, callback, session restore, sign-out, user isolation | test record in the readiness report |
| G5 | Cutover PR ready and reviewed, **not merged**: `frontend/vercel.json` `/api/*` → Railway API; `/mcp`, `/mcp/health`, the four discovery paths with `x-vercel-enable-rewrite-caching: 0`, ordered before `/api/:path*`; contract test in `frontend/scripts/vercel.test.mjs` | CI green on the PR |
| G6 | Railway variables staged with `--skip-deploys` **immediately before the window** (an unrelated merge to `main` would apply them early): API `ORIGIN=https://<domain>`, `RP_ID=<domain host>`, `MCP=on`; MCP `ORIGIN=https://<domain>`; `MCP_PUBLIC_ORIGIN` unset | `railway variables --json` (names and non-secret values) |
| G7 | No merge to `main` during the window except the G5 PR. Railway redeploys all three services on every push to `main` (no watch paths are configured), so the G5 merge triggers a Railway deploy too: wait for it before verifying (step 5). Optional: Railway watch paths mirroring Render's build filter | announced freeze on merges |
| G9 | Render can no longer change by itself. The Render Blueprint `ironvane` (`render.yaml`, Auto Sync on `main`, covering `ironvane-api` and `ironvane-mcp`) is set to Auto Sync **No**, and auto-deploy is **off** on both services. Otherwise a merge touching `render.yaml` re-applies Blueprint defaults (it has no `maintenanceMode`) and can switch maintenance mode off while Railway is live, and a merge touching `api/**` redeploys Render | Render dashboard screenshots or API read-back: Blueprint `autoSync: false`, both services `autoDeploy: no` |
| G10 | Supabase cannot act on pushes to `main`: branching is disabled on the auth project and the Supabase–Vercel integration no longer has access to `opengym` (`ARCHITECTURE.md`, integrations section) | Supabase shows no branches; after the next deploy Vercel env holds only the three `VITE_*` Preview variables |
| G11 | Render's rollback configuration is staged: Render `ORIGIN=https://<domain>`, `RP_ID=<domain host>` are set while Render is in maintenance mode (step 1), followed by a Manual Deploy of the live commit. Without this, a rollback would send `<domain>` users to a Render that signs them in on the preview host and refuses their writes as cross-origin | `ironvane-api.onrender.com/api/config` over SSH or the private network shows `webOrigin` `https://<domain>` |
| G8 | Fresh backups: Render `/data` and Railway `/data` archived to the private backup directory | manifests saved beside the archives |

## Window (about 20 minutes; the app keeps working offline and retries its pushes)

1. **Freeze Render writes.** Render → `ironvane-api` → Settings → Maintenance Mode → on, and the
   same for `ironvane-mcp` (it reaches the API over Render's private network). Check:
   `https://ironvane-api.onrender.com/api/health` → 503 and the production app's `/api/health` →
   503. SSH to the instance still works (Render keeps it running). Apply G11 now (set Render
   `ORIGIN`/`RP_ID` to `<domain>`, Manual Deploy of the live commit) and confirm the manifest is
   unchanged afterwards.
2. **Final Render backup.** `DATA_MIGRATION.md` steps 1–4: manifest, archive, second manifest
   (`--compare` exit 0 = nothing was written during the copy), extract and compare, sha256.
3. **Isolate Railway, then replace its `/data`.** The running Railway API holds its own database in
   memory and rewrites `db.json` whole on any write; dynamic client registration is open to anyone,
   and the MCP service reaches it privately. So first close every way in: remove the public domains
   of `ironvane-api` and `ironvane-web` (record them to restore), and stop `ironvane-mcp` (remove
   its active deployment). Check the old domains no longer answer. Then archive Railway's current
   `/data` (rehearsal and probe data only), empty it except `lost+found`, stream the Render archive
   in, and `railway redeploy -s ironvane-api`: one deploy applies the staged G6 variables and loads
   the data. Manifest Railway `/data` and `--compare` with the final Render manifest. Exit 0 is
   required; any changed file means something wrote during the copy: find what, close it, repeat
   this step. (No file is rewritten by the API at start: the persistence rehearsal compared equal
   after a restart and a redeploy.)
4. **Reopen Railway.** Give `ironvane-api` its public domain back if the Vercel rewrite targets it
   (or attach a new one), and redeploy `ironvane-mcp` so it starts with its `ORIGIN`.
   `ironvane-web` stays without a domain: nothing should reach the API through it any more.
5. **Switch traffic.** Merge the G5 PR. Wait for the Vercel production deployment to be READY on
   `<domain>`, and for the Railway deployments the same push triggers (G7) to be SUCCESS. Record
   the deployment ids and the commit SHA. Re-run the step 3 `--compare` after the Railway deploy:
   still exit 0.
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
7. **Lift the freeze for users only.** Render **stays in maintenance mode** with Blueprint sync and
   auto-deploy off (G9): it is the rollback copy and must never take writes again while Railway is
   live (no dual writer). Manifest Render once more: it must still equal the final backup, the
   proof that Render took no write after the freeze.

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
| After users wrote to Railway | Freeze Railway without stopping the API (SSH needs a running deployment): remove the public domains of `ironvane-api` and `ironvane-web` and stop `ironvane-mcp`. Back up Railway `/data` with two manifests (equal = nothing wrote during the copy). Copy it to Render `/data` over SSH while Render is still in maintenance mode, Manual Deploy (G11 already points Render at `<domain>`), `--compare` Render against the Railway manifest. Then stop the Railway API, revert the G5 PR and turn Render maintenance mode off | none if the compare is equal; otherwise stop and keep both copies |
| Auth broken on `<domain>` | Check Supabase lists `https://<domain>/api/oidc/callback` and Railway `ORIGIN` is exactly `https://<domain>` (no trailing slash); fix and redeploy, or roll back as above | none |

Rollback is rehearsed on the preview before the window: revert the vercel.json change on a branch
and confirm `/api/health` shows the Render headers again.

## After the rollback window (owner decisions, not part of the cutover)

- Retire Railway `ironvane-web` once the acceptance list in `ARCHITECTURE.md` passed on `<domain>`.
- Remove the old Supabase callbacks and the temporary preview Site URL.
- Remove the migration SSH keys (Render account key, Railway key) and revoke the preview
  automation-bypass secret if previews no longer need automated tests.
- Decide whether and when Render is suspended; it is never deleted without approval.
- Point `opengym-sage.vercel.app` at `<domain>` with a redirect: its sign-in and passkeys no longer
  match the API's `ORIGIN`/`RP_ID`.
- Port the self-hosted Content-Security-Policy (`web/Dockerfile`) into `frontend/vercel.json`.
- Remove the public Railway API domain once only Vercel calls it, and choose a client-address header
  for rate limits (with `TRUST_PROXY` unset every visitor shares one bucket behind the proxies).
