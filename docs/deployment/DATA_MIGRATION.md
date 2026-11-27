# Data migration — Render `ironvane-api` → Railway `ironvane-api`

Render is the authoritative copy until the owner accepts the migration. Every step below reads
Render or writes Railway; none writes Render.

## What is migrated

Everything under the API's `DATA_DIR` (`/data`): `db.json` (+ `.bak`), `state-<uid>.json`,
`watch-<uid>.json`, `secret`, `vapid.json`, `org.json`, `coach.json`, `audit.log`, `uploads/`,
`shared/`, `share/`, `integrations/`. `secret` must travel with the rest: it decrypts Coach keys and
webhook secrets. Supabase is not migrated; it stays the same project.

## Why Railway has 0 users and Render 3

Railway's volume was created empty (0 MB used) and has never received a copy; its API also lacks
`OIDC_ISSUER`/`OIDC_CLIENT_ID`, so with `OIDC_ONLY=1` nobody can create a profile there. Nothing was
lost: the users are on Render's disk.

## 3 API users vs 5 Supabase accounts

Supabase (counts only, 2026-11-27): 5 confirmed email accounts, 0 deleted, 3 with a live
(unrevoked) OAuth consent for the app's client. An API profile is created the first time a Supabase
account signs in to the training server through that client, so 3 consents ↔ 3 API users; the
other two accounts exist only in Supabase (Cloud account without a linked training profile). To be
confirmed against the backup's `db.json` link count before cutover.

## Procedure

1. **Manifest live Render** — pipe `api/scripts/data-manifest.mjs` into the running container
   (`node --input-type=module - /data`). Hashes and counts, no names or contents, but file paths
   carry account ids (`state-<id>.json`, `uploads/<id>/`): keep manifests and `--compare` output
   in the 0700 backup directory with the archive and quote only counts and `equal`. Exit codes:
   0 equal, 1 differ, 2 could not tell.
2. **Archive** — `tar -C /data -czf - .` streamed over `render ssh` to the VPS backup directory
   (a private backup directory on the operator VPS, mode 0700, root only, never committed).
3. **Consistency** — every API write is temp-file + fsync + rename (`api/durable.js`), so each file
   in the archive is whole. Cross-file consistency: take a second manifest after the archive; if
   both manifests are equal, no write happened during the copy. If not, repeat (3 users, low rate).
4. **Verify the archive** — extract to a scratch directory, manifest it, `--compare` against the
   live manifest: must be `equal: true`. Record `sha256sum` of the archive itself.
5. **Restore test** — start the API image locally on the extracted copy (`DATA_DIR` = scratch,
   loopback only): `/api/health` must report the same `users` count and `writable: true`.
6. **Copy to Railway** — scale nothing down on Render. Stream the archive into the Railway API
   container's `/data` (empty volume), restart the service, then manifest Railway's `/data` and
   compare with step 4. The API re-reads `db.json` only at start, hence the restart.
7. **Persistence** — redeploy Railway API, manifest again: must still be equal (apart from
   files the server legitimately rewrites on start, which are listed if they differ).

## Final sync at cutover (owner-approved only)

Writes keep landing on Render until cutover. The Step 6 copy is a rehearsal; at cutover: write
freeze (maintenance notice, or point the frontend rewrite at nothing for the copy window), repeat
steps 1–7, switch `frontend/vercel.json` `/api` to Railway, verify, lift the freeze. Render stays
running and untouched as the rollback target (`ROLLBACK.md`).

## Status

| Step | State | Evidence / blocker |
|---|---|---|
| Manifest tool | DONE | `api/test/data-manifest.test.js` 5/5 |
| 1–5 Render backup | DONE 2026-11-27 15:42Z | manifest before == after the archive (no write during copy); archive extracted == live (`--compare` equal); independent `sha256sum` (Render coreutils vs VPS) match; archive sha256 `9a26a73e…0e9d59`, 22,752 B; counts users 3, state files 3, upload files 2, files 17, creds/subs/invites 0 |
| 5 Restore test (local) | DONE | API started on a scratch copy, loopback only: `/api/health` `{"ok":true,"users":3,"writable":true}`; copy unchanged afterwards (`--compare` equal); scratch removed |
| Reconciliation | DONE | all 3 API profiles carry an `oidc` link with one issuer; their 3 `sub`s are 3 Supabase accounts, each with a profile row and a live OAuth consent. The other 2 accounts never signed in to this API. No orphan state or upload files |
| 6 Railway restore (rehearsal) | DONE 2026-11-27 15:48Z | Railway's empty-instance `secret`/`vapid.json` archived to the VPS first; archive streamed in over `railway ssh`; Railway `/data` manifest == Render manifest; after `railway restart` `/api/health` users 0 → 3 |
| 7 Persistence | DONE 2026-11-27 15:52Z | `railway redeploy` (deployment `<railway-deploy-id>`, SUCCESS): manifest still equal, `/api/health` users 3. Render unchanged: users 3 |
| Render origin switch | DONE 2026-11-27 16:00Z | Render `/data` manifest equal to the 15:42 backup before and after the redeploy; `/api/health` users 3 |

| Railway test-data change | 2026-11-27 19:55Z | MCP acceptance probe: one dynamic client registration (`hermes-acceptance-probe`, redirect `https://claude.ai/api/mcp/auth_callback`) through `ironvane-web`. Railway `db.json`/`db.json.bak` now differ from the Render copy; nothing else does. Render still equal to the 15:42 backup. The cutover sync replaces Railway `/data` whole, so the probe client does not survive it |

Railway is now a point-in-time copy. Render keeps taking writes, so the copy goes stale; the
cutover sync above repeats steps 1–7 under a write freeze. Until then nobody can sign in to
Railway (its OIDC settings are unset), so the copy cannot diverge by use.
