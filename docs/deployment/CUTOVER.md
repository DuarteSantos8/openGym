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

## Promotion model — a merge never moves traffic

Traffic moves only when an approved operator promotes one named deployment. A merge to `main`
builds artifacts and changes nothing users see:

- Vercel: **Auto-assign Custom Production Domains is off**. A push to `main` builds a production
  deployment without domains. The domains move only through `vercel promote <deployment>` (cutover) or
  `vercel promote <rollback target>` (rollback; `vercel rollback` only accepts a deployment that
  has been production before, and the rollback target has not). Both are instant and rebuild
  nothing. Both must be **Production** builds: promoting a Preview build creates a new production
  deployment instead. After either, read back `autoAssignCustomDomains` (step 5).
- Railway: **no deploy triggers** on any service. A service deploys only when an operator deploys
  a named commit.
- Render: Blueprint Auto Sync off and auto-deploy off (G9).
- `main` is protected: a passing `tests-ok`, an approving review by someone other than the author
  (admins included), no force-push, no auto-merge.
- The approval to cut over names the **deployment id** to promote, the **commit SHA** it was built
  from, and the **production deployment id it replaces**. A merged PR, a green check or a READY build is
  not that approval.

These settings change by themselves: an instant rollback turns automatic domain assignment off,
and **any later promote turns it back on** (the 27 Nov promote did, which is why the 28 Nov merge of
the routing PR moved traffic). So they are read back, not assumed, by the **settings check** P0:

| # | Check | Evidence required |
|---|---|---|
| P0 | Vercel project `autoAssignCustomDomains` is `false`; no Railway service has a deploy trigger; Render Blueprint Auto Sync off and both services auto-deploy off; no Vercel production build is queued or building | Vercel project read-back (`GET /v9/projects/<project>`); Railway service list; Render read-back |

Run P0 **immediately before** the G14 rollback-target redeploy, again immediately before the G5
merge, and again immediately before each `vercel promote`. If any check fails, stop: do not build,
merge or promote. To set the Vercel value: Project → Settings → Environments → Production →
Branch Tracking (turn off automatic domain assignment), or `PATCH /v9/projects/<project>` with
`{"autoAssignCustomDomains": false}`. The CLI has no command for it. Read it back afterwards.

**Release freeze.** From the G5 merge until the promotion (or the reviewed revert of G5 after an
abort), `main` holds routing that production does not, so no `main` build may be promoted. That
is a freeze on production releases. Keep it short: merge G5 at most a day before the window, and
if the window does not happen within two days, revert G5 under review and merge it again later.

**Watch.** Every 5 minutes, an operator job compares the Vercel production deployment id with the
approved one (private record) and `autoAssignCustomDomains` with `false`, and alerts the owner on
any difference (Monitoring).

A deployment can be promoted only once. To retry a cutover with a candidate that was promoted and
then rolled back from, use `vercel rollback <candidate>` (it has been production) or build the
same commit again and record the new id.

## Gates — all must be true before the window

| # | Gate | Evidence required |
|---|---|---|
| G1 | Owner approves the cutover and the window | written approval |
| G2 | Permanent domain `<domain>` chosen, added to the Vercel project, DNS and HTTPS verified | Vercel domain `verified: true`; `https://<domain>/` 200 |
| G3 | Supabase OAuth app (Authentication → OAuth Apps) lists `https://<domain>/api/oidc/callback`; Redirect URLs include `https://<domain>/**`; functions `APP_ORIGIN=https://<domain>`. Keep only callbacks on hosts the owner controls: **remove the old team-scoped branch alias** (another Vercel account now holds that host, so a code sent there could be captured by it) | authorize probe with the new `redirect_uri` → 302, with the old alias → 400. The **Site URL** (where Supabase shows the consent page) moves to `https://<domain>` in step 5, once the production build serves the account page (G14); until then it stays on the protected preview |
| G4 | Hosted sign-in proven on Railway before cutover (Railway domain callback): sign-in, consent, callback, session restore, sign-out, user isolation | test record in the readiness report |
| G5 | P0 passes immediately before the merge. Cutover PR reviewed and approved under branch protection, then merged (traffic does not move: see the promotion model). Its production build is the **candidate**: record its deployment id and commit SHA. Before the window, check it through the protection bypass: `/api/*`, `/mcp` and discovery are answered by Railway, and the cloud sign-in renders (G14). The routing in the PR: `frontend/vercel.json` `/api/*` → Railway API; `/mcp`, `/mcp/health`, the four discovery paths with `x-vercel-enable-rewrite-caching: 0`, ordered before `/api/:path*`; contract test in `frontend/scripts/vercel.test.mjs` | CI green on the PR |
| G6 | Railway variables staged with `--skip-deploys` before the window (with no deploy triggers they apply only at the first deploy after staging: the step 3 `railway redeploy` of `ironvane-api`, and the step 4 deploy of `ironvane-mcp`): API `ORIGIN=https://<domain>`, `RP_ID=<domain host>`, `MCP=on`; MCP `ORIGIN=https://<domain>`; `MCP_PUBLIC_ORIGIN` unset | `railway variables --json` (names and non-secret values) |
| G7 | No merge to `main` during the window. Railway has no deploy triggers and Vercel does not assign domains, so a stray merge cannot move traffic. The freeze keeps the candidate and the recorded ids unambiguous | Railway services list no triggers; Vercel `autoAssignCustomDomains` is `false` |
| G9 | Render can no longer change by itself. The Render Blueprint `ironvane` (`render.yaml`, Auto Sync on `main`, covering `ironvane-api` and `ironvane-mcp`) is set to Auto Sync **No**, and auto-deploy is **off** on both services. Otherwise a merge touching `render.yaml` re-applies Blueprint defaults (it has no `maintenanceMode`) and can switch maintenance mode off while Railway is live, and a merge touching `api/**` redeploys Render | Render dashboard screenshots or API read-back: Blueprint `autoSync: false`, both services `autoDeploy: no` |
| G10 | Supabase cannot act on pushes to `main`: branching is disabled on the auth project and the Supabase–Vercel integration no longer has access to `opengym` (`ARCHITECTURE.md`, integrations section) | Supabase shows no branches; after the next deploy Vercel env holds only the three `VITE_*` Preview variables (branch `next/cloud-preview`) and, once G14 is staged, the same three on Production: nothing the integration added |
| G11 | Render's rollback configuration is staged: Render `ORIGIN=https://<domain>`, `RP_ID=<domain host>` are set while Render is in maintenance mode (step 1), followed by a Manual Deploy of the live commit. Without this, a rollback would send `<domain>` users to a Render that signs them in on the preview host and refuses their writes as cross-origin | `ironvane-api.onrender.com/api/config` over SSH or the private network shows `webOrigin` `https://<domain>` |
| G8 | Fresh backups: Render `/data` and Railway `/data` archived to the private backup directory | manifests saved beside the archives |
| G12 | The Coach's provider has quota for the window and after it. The provider's own usage endpoint shows interval **and** weekly allowance remaining, and one real Coach question is answered on the preview. The Coach's credential is not shared with operator or agent tooling: a shared Token Plan is spent by whichever uses it first | provider usage read-back; one answered question |
| G13 | `<domain>` is held for the long term: registrar auto-renew on, expiry well past the rollback window. When its DNS is on Cloudflare, the Vercel record is **DNS only** (not proxied), so Vercel can issue the certificate and no second CDN caches `/api` or `/mcp` | registrar read-back; `dig` shows Vercel's address, not Cloudflare's |
| G14 | The production build is the cloud edition, so `<domain>` can show Supabase's consent page and the cloud sign-in. Vercel env on the **Production** target: `VITE_EDITION=cloud`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (the publishable key, never a secret key). Staged **before the G5 merge**, so the candidate build carries them. Then run P0 and build the **rollback target**: redeploy the current Render-routed production commit (still before the G5 merge) so that build carries them too, and check it through the protection bypass: `/api/health` shows the Render headers and the cloud sign-in renders. Record its id in step 0. It is a production build without domains until promoted. With domains not auto-assigned, a build that has them does not reach users until it is promoted. Vercel Deployment Protection stays "all except custom domains": `<domain>` is public, the preview alias keeps its Vercel login | `vercel env ls` shows the three on Production; after step 5, the production bundle contains the Supabase project address and `https://<domain>/#/account` shows the sign-in form with no Vercel login, while the preview alias still redirects to Vercel's login |

## Window (about 20 minutes; the app keeps working offline and retries its pushes)

0. **Record the previous values.** This runs before the gates that stage anything (G6, G11, G14),
   so before the window; the private record, not the repo, holds:
   - the current Vercel production deployment id and the project's `autoAssignCustomDomains`;
   - the **rollback target** id. It is a Render-routed production build that already carries the
     G14 variables, built under G14 after they are staged; add its id then. The current
     production build is not a cloud build, so rolling back to it would leave the Site URL on
     `<domain>` with no account page there;
   - the non-secret Railway variables of `ironvane-api` and `ironvane-mcp` (`ORIGIN`, `RP_ID`,
     `MCP`, `OPENGYM_API_URL`, `MCP_PUBLIC_ORIGIN`), noting which are unset;
   - Render `ironvane-api` `ORIGIN` and `RP_ID` with the live commit;
   - the Vercel variables per target (names, and which existed on Production);
   - the Supabase Site URL (the authorize probe's consent destination).

   Every rollback below restores these values; it does not delete what it staged.
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
   `/data` (rehearsal and probe data only), stream the Render archive in over it (`tar xzf -`), and
   `railway redeploy -s ironvane-api`: one deploy applies the staged G6 variables and loads
   the data. Manifest Railway `/data` and `--compare` with the final Render manifest. Exit 0 is
   required; any changed file means something wrote during the copy: find what, close it, repeat
   this step. (No file is rewritten by the API at start: the persistence rehearsal compared equal
   after a restart and a redeploy.)
   The `--compare` must also list **no extra files**: extracting over `/data` keeps files the archive
   does not have. Remove each extra one by name and compare again. The Railway CLI's `restart` and
   `redeploy` can hang after the platform has already acted; judge by the API process's age inside
   the container (younger than the restore), not by the CLI's exit status.
4. **Reopen Railway.** Deploy the candidate's commit SHA explicitly to `ironvane-api` and
   `ironvane-mcp` (the API's G6 variables are already live from the step 3 redeploy; this deploy
   applies the MCP's). Give `ironvane-api` its public
   domain back if the Vercel rewrite targets it. Re-run the step 3 `--compare`: still exit 0.
   `ironvane-web` stays without a domain: nothing should reach the API through it any more.
5. **Switch traffic.** With the owner's approval naming the candidate deployment id and the
   production deployment id it replaces, run P0, then `vercel promote <candidate>`. Read back the
   project's production target (the candidate) and both domains (`/api/health` answered by
   Railway). Check G14 on the promoted build, then set the Supabase **Site URL** to
   `https://<domain>` (G3) and repeat the authorize probe: the consent page is now on `<domain>`.
   Then read back the project's `autoAssignCustomDomains`: `vercel promote` after an instant
   rollback turns automatic domain assignment back on. If it reads `true`, set it to `false` (P0) before
   the freeze is lifted (otherwise the next merge moves traffic without approval), read it back
   again, and record the value in the cutover notes. Update the watch's approved deployment id
   to the candidate.
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
   - The Coach answers one question for the owner (G12), and the provider's usage endpoint shows
     the request counted.
   - The same screens at phone size (about 390 × 844) and desktop size (1440 × 900): no blank
     page, no sideways scrolling, no errors in the console.
   - After a Railway redeploy of `ironvane-api` (no data change), the new workout is still there
     and `/data` compares equal to the manifest taken before the redeploy.
7. **Lift the freeze for users only.** Render **stays in maintenance mode** with Blueprint sync and
   auto-deploy off (G9): it is the rollback copy and must never take writes again while Railway is
   live (no dual writer). Manifest Render once more: it must still equal the final backup, the
   proof that Render took no write after the freeze.

## Rehearsal record

The data steps were rehearsed against the Railway candidate without freezing production: a Render
backup with equal manifests before and after the copy (about 25 s for a 20-file `/data`), the Railway
archive and restore (a few seconds), and an API restart (about a minute), then `--compare` equal
with no extra, changed or missing files. Hosted sign-in, saving, isolation, MCP tools and token
revocation were verified on Railway with a standard test account (readiness report, private).
Allow about 20 minutes for the window; most of it is the verification in step 6.

## Monitoring after cutover

| Check | Every | Healthy | Action when not |
|---|---|---|---|
| Vercel production deployment id and `autoAssignCustomDomains` | 5 min | the approved id; `false` | page the owner; promote the approved id again only with approval |
| `GET https://<domain>/api/health` | 5 min | 200, `writable: true` | Railway logs; volume full or read-only → stop writes, page owner |
| `POST https://<domain>/mcp` (no token) | 15 min | 401 with `resource_metadata` on `<domain>` | MCP service down or ORIGIN drift |
| Discovery issuer | daily, and after every deploy | `https://<domain>` | revert the offending change |
| Railway volume usage | daily | < 80 % of the volume | grow the volume (owner, cost) |
| Railway / Vercel deployment status | every deploy | SUCCESS / READY | roll back the deploy in the platform |
| `/data` backup (manifest + archive to the private backup directory) | daily | `--compare` against the previous day lists only expected files | investigate missing or changed files |
| Railway spend vs a soft limit | weekly | under the limit | review usage; no hard limit is set today |
| The Coach provider's weekly allowance (provider usage endpoint) | daily | allowance left for the rest of the week | Coach answers "plan used up"; the owner adds quota or waits for the reset |

## Rollback

| Situation | Steps | Data impact |
|---|---|---|
| Before step 5 (traffic not switched) | Restore the step 0 values (staged values would otherwise take effect at the next explicit deploy or build): set each G6 Railway variable back to its recorded value with `--skip-deploys` and unset only those recorded as unset; set each G14 Production variable back to its recorded value, and remove only those that did not exist before. If G11 was applied, set Render `ORIGIN`/`RP_ID` back to the recorded values (the frontend users sign in on today), Manual Deploy the recorded live commit while still in maintenance mode, and check `/api/config` shows the recorded `webOrigin` and the manifest is unchanged. Then turn Render maintenance mode off and run one sign-in on that frontend. Production never changed. If G5 was merged, revert it under review afterwards, so `main` routes to Render again and ordinary releases can resume (the release freeze ends) | none: Railway took no user writes |
| After step 5, problem found before users wrote to Railway | First freeze Railway writes as in the next row (remove the public domains of `ironvane-api` and `ironvane-web`, stop `ironvane-mcp`): requests fail briefly instead of a write landing only on Railway. Manifest Railway `/data` and `--compare` it with the step 3 manifest; any difference means users did write, so use the next row instead. Exit 2 (the compare could not run: a missing or unreadable manifest) counts as different: fix the inputs and compare again before switching. Then `vercel promote <rollback target>` (the Render-routed cloud build) (instant, no build; `/api` → Render), then read back the production target, both domains and `autoAssignCustomDomains` (set it back to `false` if the promote turned it on). Turn Render maintenance mode off **now**: until then every user gets 503. Then restore the G6 Railway variables to their step 0 values, and revert the G5 PR under review, so `main` matches production. Keep the Site URL on `<domain>` only because the rollback target is itself a cloud build, verified through the bypass before the window (G14), and Render already serves `<domain>` (G11), so it keeps signing in there. Only if the cloud build itself is the problem: remove the G14 Production variables, redeploy the Render-routed commit, check the new build through the bypass (Render headers), `vercel promote` it (a redeploy alone moves no domain), read back the production target, both domains and `autoAssignCustomDomains` (set it back to `false` if the promote turned it on, and read it again), and only then move the Site URL back to the preview | none |
| After users wrote to Railway | Freeze Railway without stopping the API (SSH needs a running deployment): remove the public domains of `ironvane-api` and `ironvane-web` and stop `ironvane-mcp`. Back up Railway `/data` with two manifests (equal = nothing wrote during the copy). Copy it to Render `/data` over SSH while Render is still in maintenance mode, Manual Deploy (G11 already points Render at `<domain>`), `--compare` Render against the Railway manifest. Only when it is equal: turn Render maintenance mode off, then **switch traffic** with `vercel promote <rollback target>` (merges do not move traffic), and read back the production target, both domains and `autoAssignCustomDomains` (back to `false` if needed): `/api/health` shows the Render headers and the `users` count. Then stop the Railway API, restore the G6 Railway variables to their step 0 values, and revert the G5 PR under review so `main` matches production. If the cloud build itself is the problem, finish the data copy and switch as above, then follow the previous row's "cloud build itself is the problem" steps | none if the compare is equal; otherwise stop and keep both copies |
| Auth broken on `<domain>` | Check Supabase lists `https://<domain>/api/oidc/callback` and Railway `ORIGIN` is exactly `https://<domain>` (no trailing slash); fix and redeploy, or roll back as above | none |

**Known limitation of every rollback:** the rollback target routes only `/api/*` to Render.
`<domain>/mcp` and the `/.well-known/oauth-*` and `openid-configuration` documents are then
answered by the app, not by a server, so AI-assistant connectors stop working until the next
cutover, including clients and tokens copied to Render in the post-write row. Render
`ironvane-mcp` is not moved to `<domain>` (G11 covers only `ironvane-api`). Tell connector users
when rolling back. The read-backs check `/api/health` only.

Rollback is `vercel promote` of the recorded rollback target, not a revert merge (`vercel rollback` would refuse a build that has never had the production domains). On 28 Nov
(`ROLLBACK.md`, change log) a `vercel rollback` to the previous production build took 3 s, both domains back on
Render, no data copied; that build had been production, which is why rollback accepted it. Rehearse it before the
window by checking the recorded rollback target through the bypass: `/api/health` shows the Render
headers **and** the cloud sign-in renders (a non-cloud target would strand the Site URL on `<domain>`).
That check proves the target build, not the promotion. `vercel promote` is the same operation as
step 5, and the recovery rows repeat step 5's read-back (production target, both domains,
`autoAssignCustomDomains`). A full promotion can only be rehearsed by moving the domains, so it is
not rehearsed on production.

## After the rollback window (owner decisions, not part of the cutover)

- Retire Railway `ironvane-web` once the acceptance list in `ARCHITECTURE.md` passed on `<domain>`.
- Remove the old Supabase callbacks (the preview and Railway-host ones) once `<domain>` sign-in has
  worked for the whole rollback window.
- Remove the migration SSH keys (Render account key, Railway key) and revoke the preview
  automation-bypass secret if previews no longer need automated tests.
- Decide whether and when Render is suspended; it is never deleted without approval.
- Point `opengym-sage.vercel.app` at `<domain>` with a redirect: its sign-in and passkeys no longer
  match the API's `ORIGIN`/`RP_ID`.
- Port the self-hosted Content-Security-Policy (`web/Dockerfile`) into `frontend/vercel.json`.
- Remove the public Railway API domain once only Vercel calls it, and choose a client-address header
  for rate limits (with `TRUST_PROXY` unset every visitor shares one bucket behind the proxies).
