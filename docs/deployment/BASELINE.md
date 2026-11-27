# Deployment baseline — 2026-11-27

> Snapshot at audit start. Later platform changes (Vercel project, Render `ORIGIN`, Railway
> variables, data restore) are logged with their reverts in `ROLLBACK.md`, which supersedes
> the state described here.

Evidence gathered read-only by Hermes from a clean clone, the platform CLIs and public HTTP
probes. No secret values are recorded here: variables are listed by name only.

## Repository

| Item | Value |
|---|---|
| Fork | `sorensadrgit-art/openGym` (public), upstream `DuarteSantos8/openGym` |
| `main` at audit start | `a3beaa89e` (two Railway commits pushed directly, no PR) |
| `main` now | `14f2e67da` (PR #154 and #149 merged 14:42–14:47 UTC) |
| Fork vs upstream | 676 commits ahead, 0 behind |
| `next/cloud-preview` | `7c3695325`, 55 behind / 38 ahead of `main` |
| Node | API image `node:26-alpine`, MCP image `node:22.23.4-alpine`; no `engines` field |
| Lockfiles | `package-lock.json` in root, `api/`, `mcp/`, `frontend/`; `npm ci` succeeds in all four |
| CI | `.github/workflows/test.yml` (path-filtered jobs, `tests-ok` gate), plus audit, docker-publish, pages, release-check, mirror, CLA, iOS |

## Hosting inventory

| Layer | Platform | Identifier | State at audit |
|---|---|---|---|
| Frontend | Vercel Pro team `<vercel-team>` | project `opengym` | **Missing.** API returns `404 Project not found`; team lists zero projects. `next/cloud-preview` alias returns `DEPLOYMENT_NOT_FOUND`. |
| Frontend (stray) | Vercel scope `soren-37388cd1` | `opengym` | Deployment for `a3beaa89e` returns `410 Gone`. Not canonical (owner decision). |
| API (live) | Render `ironvane-api` `<render-api-service-id>` | starter, virginia, 1 instance, disk `ironvane-data` 1 GB at `/data`, health `/api/health` | Healthy, `users: 3`, writable |
| MCP (live) | Render `ironvane-mcp` `<render-mcp-service-id>` | starter, virginia, health `/mcp/health` | Healthy, v0.2.0; rejects missing and malformed tokens with 401 |
| API (candidate) | Railway `renewed-freedom` / production, `ironvane-api` | volume `ironvane-api-ironvane-data` 500 MB at `/data` | Healthy, `users: 0`, volume 0 MB used |
| MCP (candidate) | Railway `ironvane-mcp` | `OPENGYM_API_URL=http://ironvane-api.railway.internal:3000` | Healthy |
| Web (candidate) | Railway `ironvane-web` (nginx image) | `ironvane-web-production.up.railway.app` | Failed health checks for `a3beaa89e`, `9ff0bd11b`, `14f2e67da`; repaired, see below |
| Auth | Supabase `ironvane` `<supabase-project-ref>` (us-east-1) | 5 auth users, 5 `profiles` rows, 1 public OAuth client | Active. Only redirect URI is the missing Vercel cloud-preview alias. |

Other Render services in the workspace (`soren`, `cam-tracker`) are unrelated and untouched.

## Environment variable names

| Service | Render | Railway |
|---|---|---|
| API | `ADMIN_UIDS DATA_DIR OIDC_CLIENT_ID OIDC_ISSUER OIDC_LABEL OIDC_ONLY ORIGIN PORT RP_ID` | `DATA_DIR MCP OIDC_LABEL OIDC_ONLY ORIGIN PORT RP_ID` |
| MCP | `MCP_PORT` | `MCP_PORT OPENGYM_API_URL ORIGIN PORT` |
| Web | — | `BACKEND MCP_BACKEND MCP_PORT NGINX_PORT PORT` |

Railway's API has `OIDC_ONLY=1` but no `OIDC_ISSUER` / `OIDC_CLIENT_ID`, so nobody can sign in
there yet. Render's `ORIGIN`/`RP_ID` name the missing Vercel cloud-preview host, so hosted sign-in
is broken until that host is restored.

## Persistence

The API keeps everything as files under `DATA_DIR` (`db.json`, `state-<uid>.json`,
`watch-<uid>.json`, `secret`, `vapid.json`, `org.json`, `coach.json`, `audit.log`, `uploads/`,
`shared/`, `share/`, `integrations/`). `secret` encrypts Coach keys and webhook secrets, so it must
travel with the data. The documented backup is an archive of the whole directory
(`docs/SELF_HOSTING.md` §6). One writer only: keep one replica.

## Local verification on `main`

| Check | Result |
|---|---|
| `npm ci` (root, api, mcp, frontend) | PASS |
| `frontend: npm run build` | PASS (chunk-size warnings only) |
| `api: npm test` (full, parallel, host load ~7–19) | 1343 tests: 1334 pass, 6 fail, 3 skipped |
| The 6 API failures rerun alone (6 files) | 118/118 PASS — all six were 20 s timeouts under load |
| `mcp: npm test` under the same load | 4 files failed on hook timeouts |
| `mcp: vitest run --maxWorkers=4` | 155 pass, 1 skipped, 0 fail |
| `frontend: vitest run` (full) | 11240 tests: 11239 pass, 1 timeout (`media-sync.test.js`) |
| `media-sync.test.js` rerun ×3 | 31/31 PASS each time |

## Defects found

1. `a3beaa89e` (pushed to `main` without PR) sourced a Railway hook under `set -u`; a plain Docker
   run exited before nginx listened. Fixed by PR #154 (`384d7b732`), merged.
2. Railway `ironvane-web` listened on `NGINX_PORT=8080` while Railway health-checked and routed
   `PORT=3000`. Repaired in platform settings (see `docs/deployment/ROLLBACK.md` for the revert).
3. The Vercel project the hosted sign-in depends on no longer exists.
4. Railway API lacks the OIDC settings that Render has.
