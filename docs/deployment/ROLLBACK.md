# Rollback — Render → Railway / Vercel migration

Platform identifiers (team, project, service, deployment and domain ids) appear here as
`<placeholders>`; the operator keeps the unredacted record privately with the backups.

Render stays the authoritative API and MCP until the owner accepts the migration. Nothing in this
plan deletes Render, its disk, the Supabase project, auth users or the OAuth client.

## Platform changes made so far (newest last)

| When (UTC) | Change | Revert |
|---|---|---|
| 2026-11-27 14:52 | Railway `ironvane-web`: `NGINX_PORT` 8080 → 3000 | `railway variables -s ironvane-web --set NGINX_PORT=8080` |
| 2026-11-27 14:54 | Railway `ironvane-web` service domain `<railway-web-domain-id>` target port 8080 → 3000 | `railway domain update <railway-web-domain-id> -s ironvane-web --port 8080` |
| 2026-11-27 15:29 | Vercel Pro team: project `opengym` (`<vercel-project-id>`) recreated, root `frontend`, git-linked, production branch `main`; 3 Preview variables scoped to `next/cloud-preview` | Remove the variables in Project → Settings → Environment Variables. Deleting the project is not a rollback: production `opengym-sage.vercel.app` runs on it |
| 2026-11-27 15:38 | `next/cloud-preview` fast-forward merge of `main` (`f9e6b6068`), normal push | Earlier branch head `7c3695325` is its parent; redeploy that commit from Vercel if needed. No force-push |
| 2026-11-27 15:40 | Vercel domain `ironvane-cloud-preview.vercel.app` added, git branch `next/cloud-preview` (the old branch alias is held by another Vercel account, 409) | Project → Domains → remove |
| 2026-11-27 15:44 | Railway SSH key `hermes-vps-ironvane-railway` registered; Render SSH key `hermes-vps-ironvane-backup` (owner-added) | `railway ssh keys remove`; Render Account Settings → SSH Public Keys |
| 2026-11-27 15:48 | Railway `ironvane-api` `/data`: Render copy restored over the empty volume, then restart + redeploy | Stream the pre-restore Railway archive (private backup directory) back after emptying `/data` (it holds only the empty instance's `secret` and `vapid.json`), restart |
| 2026-11-27 15:57 | Vercel "Protection Bypass for Automation" secret created (Preview protection stays on); value only in the VPS Hermes `.env` | Project → Settings → Deployment Protection → revoke |
| 2026-11-27 15:58 | Render `ironvane-api` (owner-chosen sign-in origin): `ORIGIN` the old team-scoped branch alias → `https://ironvane-cloud-preview.vercel.app`; `RP_ID` same host change; redeployed the already-live commit `da96e4002` (deploy `<render-deploy-id>`, live 16:00), no new code. `/data` manifest equal before and after | Set both back in Render → Environment, then Manual Deploy → the same commit. No passkeys or connector tokens existed on the old host (`creds 0`, `apiTokens 0`) |
| 2026-11-27 16:20 | Railway `ironvane-api`: set `OIDC_ISSUER` (the existing Supabase project), `OIDC_CLIENT_ID` (the existing public client), `ADMIN_UIDS` (same account id as Render). Deployment `<railway-deploy-id>` SUCCESS; `/data` manifest still equal to the Render backup. Sign-in needs the owner to add `https://ironvane-web-production.up.railway.app/api/oidc/callback` to the client | `railway variables -s ironvane-api` → delete the three (with `OIDC_ONLY=1` still set, nobody can sign in again) |
| 2026-11-27 ~17:00–17:28 | Vercel `opengym`: removed the 18 Production variables the Supabase integration (`<supabase-integration>`, all projects) added at 16:21 (`POSTGRES_*`, `SUPABASE_*` incl. service-role, secret and JWT secret, `NEXT_PUBLIC_SUPABASE_*`). The project has no functions and Vite bundles only `VITE_*`; the two production builds made while they existed (`54e966c17`, `44b70444a`) were checked: no secret-shaped value in their build logs or served JS. The three `VITE_*` Preview variables for `next/cloud-preview` are kept | Re-sync from the Supabase integration (Vercel → Integrations → Supabase → project access). Values are not lost: they live in Supabase |
| 2026-11-27 21:23 → ~23:02 | Production Vercel: #159 (cutover routing, do-not-merge) was merged; production sent `/api` and MCP to the Railway candidate. Rolled back with `vercel rollback` to the last pre-#159 production deployment; `/api` answered from Render again. No data diverged (Railway logged no request in the window). #160 reverted #159 on `main` | Already reverted. Re-apply only as cutover step G5 |
| 2026-11-27 23:4x | Vercel: promoted the `main` build after #160 (same files as the rolled-back-to deployment, `/api` → Render). An instant rollback pauses automatic production promotion; a promote resumes it | `vercel rollback` to the previous production deployment (it has been production, so it cannot be promoted again) |
| 2026-11-27 23:41 | Render `ironvane-mcp`: `OPENGYM_API_URL` set to the API's private address (`http://<render-api-service>:10000`). It was unset, so the image default `http://api:3000` (a Compose name) applied and every authenticated MCP call answered 502. Redeployed the already-live commit, no new code; the API was not restarted | Delete `OPENGYM_API_URL` on the MCP service, then Manual Deploy → the same commit |
| 2026-11-27 23:52–00:00 | Railway `ironvane-api` `/data`: fresh consistent Render backup (manifest before = after = archive) extracted over it, API restarted; manifest equal to the backup. Railway is still only a candidate | Stream the pre-restore Railway archive (private backup directory) back, restart |
| 2026-11-28 02:50 → 03:33 | Production incident: #164 (cutover routing, do-not-merge) was merged by an automated agent on the owner's account, and #167 and #168 followed; automatic domain assignment was on (the 27 Nov promote had resumed it), so production sent `/api`, MCP and discovery to the Railway candidate. Railway took only test writes, no user writes. Railway frozen (deploy triggers removed, public domains pointed at a closed port; nothing deleted); `vercel rollback` to the last Render-routed production deployment (3 s), which also turned automatic domain assignment off. #169 reverted #164 on `main` (04:43); its build was not promoted. `main` branch protection added | Already reverted. Railway reopens only in cutover step 4; the cutover now moves traffic only by `vercel promote` (`CUTOVER.md`, promotion model) |

The two 14:52–14:54 rows affect only the Railway candidate stack, which serves no real users. The
Vercel project (15:29) and the Render `ORIGIN`/`RP_ID` change (15:58) touch production.

## Frontend

- After a cutover, first freeze Railway and reconcile its data into Render (API data, steps 1-2),
  then move traffic: otherwise users can write to both sides or see stale data.
- Traffic moves only on Vercel (below), never by a merge: production domains are not
  auto-assigned. Afterwards, revert the PR that touched `frontend/vercel.json` under review so
  `main` matches production again.
- Vercel: `vercel rollback <deployment>` returns the domains to a deployment that was production
  before (instant, and it turns automatic domain assignment off). A deployment that was never
  production is moved with `vercel promote <deployment>` instead; a deployment can be promoted
  only once. Before either, cancel any queued or building production build (a promote turns
  auto-assignment on, and that build would take the domains when it finishes). After either, read back the project's `autoAssignCustomDomains` and set it to `false`
  (`CUTOVER.md`, settings check P0). Every deployment stays addressable by its own URL.

## API data (when a cutover has happened)

1. Freeze writes on the side being abandoned. While its `/data` still has to be copied, keep the
   Railway API running (SSH needs a running deployment) and cut every path to it: point the public
   domain of `ironvane-api` at a closed port (`ironvane-web`'s has stayed there since CUTOVER step 3) and stop `ironvane-mcp`
   (`CUTOVER.md`, rollback table). Nothing weaker freezes it:
   `INVITE_ONLY=1` only gates new sign-ups, and the MCP service reaches the API over the private
   network (`ironvane-api.railway.internal`) whatever the frontend rewrite says.
   Then drain: requests accepted before the domains closed can still write (an OIDC callback waits
   up to 10 s on the provider), so wait until `netstat -tn` in the container shows no established
   client connection on the API port, then 30 s more. Background jobs write without a client, so
   the final manifest in step 2 is the proof.
2. With Render still in maintenance mode, archive Railway `/data` the same way as the Render
   backup and diff it against the cutover manifest. Anything newer than the cutover is user data
   created on Railway: reconcile it into Render. Never overwrite the newer file with the older one.
   Right before the switch, manifest Railway `/data` once more: it must still equal the archive
   (otherwise drain and repeat). Only then may Render take writes again; stop the Railway API
   right after the switch.
3. Move traffic with `vercel promote <rollback target>` or `vercel rollback <deployment>` (Frontend,
   above; a redeploy alone moves no domain). Read back the production deployment and
   `autoAssignCustomDomains`, check that `/api/health` on both domains shows the **Render** headers,
   then run a sign-in. Revert the routing PR under review afterwards.

## Auth

- Supabase redirect URIs are only ever added during migration; old ones are removed after the
  replacement is verified. Rolling back is re-adding the previous URI to the OAuth client and the
  Auth → URL configuration allow-list.

## Known hazards found in hosted QA

- **The Supabase–Vercel integration rewrites the Supabase Site URL** on production deployments of
  a project it covers (seen after the 21:23 and 23:35 deployments). The OAuth consent step is only
  accepted from the Site URL's origin (`400 validation_failed: unauthorized request origin`), so a
  rewritten Site URL breaks every hosted sign-in, on Render and Railway alike. Remove the app's
  Vercel project from the integration's project access, then set the Site URL back.
- **Vercel instant rollback pauses automatic promotion.** New `main` builds stay unpromoted until a
  deployment is promoted by hand; check Project → Deployments after any rollback.
- **The MCP service needs `OPENGYM_API_URL`.** Without it the container talks to `http://api:3000`.
  Check with a well-formed fake `ogt_` token: 401 "did not accept this token" means the API was
  reached; 502 "could not be reached" means it was not.
