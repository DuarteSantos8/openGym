# Rollback — Render → Railway / Vercel migration

Render stays the authoritative API and MCP until the owner accepts the migration. Nothing in this
plan deletes Render, its disk, the Supabase project, auth users or the OAuth client.

## Platform changes made so far (newest last)

| When (UTC) | Change | Revert |
|---|---|---|
| 2026-11-27 14:52 | Railway `ironvane-web`: `NGINX_PORT` 8080 → 3000 | `railway variables -s ironvane-web --set NGINX_PORT=8080` |
| 2026-11-27 14:54 | Railway `ironvane-web` service domain `c5a1b502…` target port 8080 → 3000 | `railway domain update c5a1b502-597a-4450-982c-bd028caf1dcc -s ironvane-web --port 8080` |
| 2026-11-27 15:29 | Vercel Pro team: project `opengym` (`prj_cAY5SKDfpjnLdsOemSMTgvCzOGdZ`) recreated, root `frontend`, git-linked, production branch `main`; 3 Preview variables scoped to `next/cloud-preview` | Remove the variables in Project → Settings → Environment Variables. Deleting the project is not a rollback: production `opengym-sage.vercel.app` runs on it |
| 2026-11-27 15:38 | `next/cloud-preview` fast-forward merge of `main` (`f9e6b6068`), normal push | Earlier branch head `7c3695325` is its parent; redeploy that commit from Vercel if needed. No force-push |
| 2026-11-27 15:40 | Vercel domain `ironvane-cloud-preview.vercel.app` added, git branch `next/cloud-preview` (the old branch alias is held by another Vercel account, 409) | Project → Domains → remove |
| 2026-11-27 15:44 | Railway SSH key `hermes-vps-ironvane-railway` registered; Render SSH key `hermes-vps-ironvane-backup` (owner-added) | `railway ssh keys remove`; Render Account Settings → SSH Public Keys |
| 2026-11-27 15:48 | Railway `ironvane-api` `/data`: Render copy restored over the empty volume, then restart + redeploy | Stream `/root/backups/ironvane/railway-pre-restore-*/data.tar.gz` back after emptying `/data` (it holds only the empty instance's `secret` and `vapid.json`), restart |
| 2026-11-27 15:57 | Vercel "Protection Bypass for Automation" secret created (Preview protection stays on); value only in the VPS Hermes `.env` | Project → Settings → Deployment Protection → revoke |
| 2026-11-27 15:58 | Render `ironvane-api` (owner-chosen sign-in origin): `ORIGIN` `https://opengym-git-next-cloud-preview-sorensadr-gmailcoms-projects.vercel.app` → `https://ironvane-cloud-preview.vercel.app`; `RP_ID` same host change; redeployed the already-live commit `da96e4002` (deploy `dep-dc4qhdlg1s2s73fes2ig`, live 16:00), no new code. `/data` manifest equal before and after | Set both back in Render → Environment, then Manual Deploy → the same commit. No passkeys or connector tokens existed on the old host (`creds 0`, `apiTokens 0`) |
| 2026-11-27 16:20 | Railway `ironvane-api`: set `OIDC_ISSUER` (the existing Supabase project), `OIDC_CLIENT_ID` (the existing public client), `ADMIN_UIDS` (same account id as Render). Deployment `5e36e1fc` SUCCESS; `/data` manifest still equal to the Render backup. Sign-in needs the owner to add `https://ironvane-web-production.up.railway.app/api/oidc/callback` to the client | `railway variables -s ironvane-api` → delete the three (with `OIDC_ONLY=1` still set, nobody can sign in again) |

Both affect only the Railway candidate stack, which serves no real users.

## Frontend

- Repository change: revert the PR that touched `frontend/vercel.json`. The `/api` rewrite still
  targets `ironvane-api.onrender.com`, so the frontend keeps using Render.
- Vercel: promote the previous production deployment (`vercel promote <deployment-url>` or
  Dashboard → Deployments → Promote). Every deployment stays addressable by its own URL.

## API data (when a cutover has happened)

1. Freeze writes on the side being abandoned (scale Railway API to 0 or set `INVITE_ONLY=1` and
   stop the frontend rewrite).
2. Archive Railway `/data` the same way as the Render backup and diff it against the cutover
   manifest. Anything newer than the cutover is user data created on Railway: reconcile it into
   Render before Render takes writes again. Never overwrite the newer file with the older one.
3. Point `frontend/vercel.json` back at Render, redeploy, verify `/api/health` and a sign-in.

## Auth

- Supabase redirect URIs are only ever added during migration; old ones are removed after the
  replacement is verified. Rolling back is re-adding the previous URI to the OAuth client and the
  Auth → URL configuration allow-list.
