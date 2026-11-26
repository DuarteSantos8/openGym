# The hosted server (Ironvane Cloud)

Status on November 26, 2026. The cloud preview uses the hosted API on Render. Linked sign-in and
the AI Coach have been verified on that preview. A production-domain cutover and external MCP
connector verification are still pending. The observations below identify the build and account
used for each check. For self-hosting, see `docker-compose.yml` and `docs/SELF_HOSTING.md`.

## Why a server at all

Supabase holds the hosted account (ADR 0010). The app's API serves three features:

- **Training tied to the account.** A linked server profile stores training on the API disk.
  A device profile keeps its training on the device.
- **The AI Coach** (`docs/AI_COACH.md`) uses the server's provider connection to propose workouts
  and plans. The preview was tested with MiniMax.
- **MCP for Claude and ChatGPT** (`docs/MCP_REMOTE.md`) lets an authorized connector read and
  change plans. The MCP service has been provisioned. External read and write checks remain open.

## Shape

| Part | Where | Notes |
|---|---|---|
| Web app (Cloud build) | Vercel | cloud preview |
| Server (`api/`) | Render, one Docker web service, `render.yaml` | Starter instance |
| Data | a 1 GB Render disk mounted at `/data` | the server keeps everything in files (`docs/ARCHITECTURE.md`) |
| Sign-in | the server's own OIDC, with the Supabase project as provider | ADR 0013: configuration, no new server code |
| `/api/*` from the browser | a rewrite in `frontend/vercel.json` to the Render address | same origin for the browser, so cookies and passkeys work unchanged |

The server is one process with file storage, so it runs as a single instance. A disk on Render
pins the service to one instance and gives a short pause on each deploy; that matches what this
server is. It is the right size for a beta and early customers, not for thousands of people: at
that point the data belongs in Postgres, which is a separate piece of work.

If the server is down, training still works: the app is offline-first. Sync, the Coach and MCP
wait until it is back.

## Settings

Committed in `render.yaml` (no secrets, nothing project-specific):

| Setting | Value | Why |
|---|---|---|
| `DATA_DIR` | `/data` | the disk |
| `PORT` | `10000` | Render's port for a web service |
| `OIDC_ONLY` | `1` | the hosted account is the only way to get a profile: no sign-up straight on the server |
| `OIDC_LABEL` | `Ironvane` | the button reads "Sign in with Ironvane" |

Typed into Render's dashboard when the blueprint is created, never committed (the repository is
public):

| Setting | Value |
|---|---|
| `ORIGIN` | the app's public address, no trailing slash |
| `RP_ID` | its host name alone |
| `OIDC_ISSUER` | `https://<project-ref>.supabase.co/auth/v1` |
| `OIDC_CLIENT_ID` | the public client registered in the project's OAuth server |
| `ADMIN_UIDS` | the owner's Account ID on this server, added after their first sign-in (below). Empty until then |

Left out on purpose:

- `FIRST_USER_ADMIN`. It makes the first profile the admin, and here anyone can make a hosted
  account: once the address is public, whoever signs in first would own the server (found in
  review of #76). The admin is named by id in `ADMIN_UIDS` instead.
- `TRUST_PROXY`. See "Known limit: sign-in throttling" below.
- `OIDC_EMAIL_LINKING`. A fresh server has no profiles to link to.
- Any model provider key. The Coach's key is pasted by the admin into the app's admin dashboard
  and stored encrypted on the disk (`docs/AI_COACH.md`, "Where a credential lives").

The server writes its own session secret and push keys into `/data` on first start, so there is
no secret to generate or pass around.

## Bring-up

Owner's steps (accounts, cards and keys are the owner's):

1. Create a Render account, signing in with GitHub, and give Render access to this repository.
2. Add a payment method (the Starter instance and the disk are paid).

Then, in order:

3. Supabase dashboard: switch on the OAuth 2.1 server, point its authorization path at the
   Cloud build's consent page (`#/account`; how the dashboard wants a hash route written is
   still to be confirmed there), and register a public client (PKCE, no secret) with the
   redirect address `<ORIGIN>/api/oidc/callback`. Note the client id.
4. Render dashboard: New, Blueprint, this repository, branch `main`. Fill the four settings
   above when asked. Wait for the first deploy to be healthy (`/api/health` answers
   `{"ok":true,…}`).
5. Point the `/api/*` rewrite in `frontend/vercel.json` at the Render address (a pull request).
6. The owner opens the app, signs in to the hosted account, and goes through "Sign in with
   Ironvane" once. That makes an ordinary profile. They copy its Account ID from Settings,
   Account, and put it in `ADMIN_UIDS` in Render's dashboard; the service restarts and the
   admin dashboard appears. Nobody becomes the admin by arriving first.
7. Check ADR 0013's two open items on the real thing: the `iss` of a real ID token equals the
   discovery `issuer`, and the round trip completes on the web.
8. Coach: Settings, Account, Admin dashboard, AI Coach, Set up the Coach. Pick a provider, paste
   an API key, set the daily limit. Set a monthly spend limit at the provider as well.
   The app side of step 6 is in place: where the server signs people in with the account, the
   account's Continue goes through that sign-in (`frontend/src/lib/cloud/enter-app.js`), walked
   end to end in the Cloud E2E against a real API with a stand-in provider.
9. MCP comes after: it is a second small service (`docs/MCP_REMOTE.md`) and `MCP=on` here.

## Checked before any of this was deployed

- `api/test/render-blueprint.test.js`: the blueprint builds the `api` image, is health-checked
  on a route the server has, mounts its disk where `DATA_DIR` points, sets only settings the
  server reads, and commits no project address or id.
- The server was started locally with these settings (a made-up origin and issuer): it listened,
  `/api/health` answered `{"ok":true,"users":0,"writable":true}`, `/api/config` listed the
  Ironvane sign-in, and it wrote its own secret into the data directory.

Outside the scope of that local check: the Docker build on Render, the disk's
permissions for the Coach's unprivileged user, the sign-in round trip, and the Coach with a real
provider.

## Known limit: sign-in throttling

Found in review of #76 and confirmed in the code. The server limits sign-in attempts per
address: 30 requests a minute on the OIDC routes (`OIDC_BURST` in `api/server.js`), plus a pause
after wrong states or codes. Behind the Vercel rewrite the server does not see the visitor's
address. With `TRUST_PROXY` off it counts the connecting socket; with it on it reads
`CF-Connecting-IP` or the last `X-Forwarded-For` entry (`limitAddress`), and both of those are
the proxy in front of it, not the person. Either way everyone shares a few buckets.

What that means: fine for a beta (a sign-in is two requests, so roughly fifteen a minute per
bucket), but a busy day or someone hammering the sign-in route can make other people wait a
minute. Which headers really arrive is to be read off the live service at bring-up. The real
fix is for the server to be reached without a second proxy in between: its own subdomain, or
the web container in front of it as in `docker-compose.yml`. That is a decision for before
launch, not for the beta.

## Before real users

Not needed for the owner's own bring-up, required before anyone else is let in.

- **Linked deletion: verified once on the hosted service (2026-11-24).**
  [ADR 0014](adr/0014-hosted-account-deletion.md) has what was seen and what was not tried: a
  deletion after an old sign-in, signing up again with the deleted address, and a browser
  with workouts of its own. Cloud builds without a training server must explicitly set
  `VITE_CLOUD_SERVER=off`.
- **Signing in a second time** works on the hosted service since #91 (three sign-ins on
  2026-11-24 went through with no consent step, as the hosted project's log shows).
- **Hosted account checks (A1), November 26, 2026.** On the preview, a disposable linked
  profile showed no Admin dashboard in Settings > Account. Opening `GET /api/admin/oidc`
  returned `{"error":"forbidden"}`. Choosing Sign out on the account screen brought back
  Sign in. Opening `GET /api/me` in that same browser returned `{"error":"not signed in"}`.
  The preview browser did not expose either HTTP status. Confirm the expected 403 and 401
  from the preview response headers. The Render request-log query found no matching entries
  at the time of the check.
- **Direct API check.** A separate anonymous curl to the live Render service's `/api/me`
  returned HTTP 401 with `{"error":"not signed in"}`.
- **Two-tab sign-in verified on the hosted preview, November 26, 2026.** Both tabs started
  signed out. The owner signed in and chose Continue in the second tab. After selecting
  the first tab in the browser tab strip, Settings showed the signed-in account.
  Opening `GET /api/me` in each existing tab returned an authenticated user with the
  same nonempty account ID. The numeric HTTP statuses were not recorded. The first
  tab was returned to Settings and the second to Home.
- **Owner Admin dashboard verified on November 26, 2026.** On the restored preview after a
  successful Vercel deployment, the owner opened Settings > Account > Admin dashboard.
  The **ADMIN** screen showed Invite codes, Identity provider, Users and Activity log.
  `GET /api/admin/oidc` returned a configuration with `enabled: true` and `reachable: true`.
  The browser did not expose the HTTP status. `GET /api/health` returned
  `{"ok":true,"writable":true}`.
- Known wart: an admin who opened their own profile through the account, signed out, and within
  two minutes uses their passkey on that same profile is signed out once and has to try again.
- Backups, below. Sign-in throttling, above.

## The Coach

On November 25, 2026, the hosted test account received a chat reply. Its first full-plan
attempt failed with the output limit set to 16,000. Retrying the same plan at 32,000 succeeded.

In the MiniMax console, open **M Plan > Plan Usage > Usage details** and select **Search**.
For November 26, 01:00 to 02:00 UTC (November 25, 8 to 9 p.m. Eastern), the active
Monthly M Plan Explore showed one hourly row for `MiniMax-M3.1-Flash`:

| Input tokens | Output tokens | Cache read tokens | Cache write tokens |
| ---: | ---: | ---: | ---: |
| 20,637 | 36,590 | 384 | 0 |

The row covers the test hour. MiniMax grouped usage by model and hour, so individual runs,
their token counts and dollar costs cannot be identified. The row also did not split included
quota from purchased credits. **API > API Usage**, the separate pay-as-you-go and resource-pack
ledger, showed no entry for the test window when checked. MiniMax updates that ledger daily.

### Live schedule check after #99

On November 25, 2026, the test profile on the cloud preview asked twice, “Add a push day on Tuesday
and a pull day on Wednesday.”
Before the first run, the owner raised **Per user, per day** from 3 to 5 under **Admin dashboard >
AI Coach > Advanced**.
After a reload the test profile showed **3 of 5 Coach runs used today**.

| Observed on the test profile | Before | After importing the first proposal | After the second reply and reload |
| --- | --- | --- | --- |
| Monday | Bodyweight Back Strength, 7 exercises | Same | Same |
| Tuesday | Rest day | Push Day, 5 exercises | Same |
| Wednesday | Bodyweight Back Strength, 7 exercises | Same, used as the pull day | Same |
| Total routines | 2 | 3 | 3 |

The starting list contained two Bodyweight Back Strength routines, one with five exercises and one
with seven. Only the seven-exercise routine was scheduled.
The first proposal added one Push Day. On the repeat the Coach recognized both scheduled days and
replied “No changes are needed.” There was no second Import button. The local test in #99 covers a
repeat that does require a second confirmation.

After the check, the owner setting read **3** again.
Reloading Coach on the test profile showed **5 of 3 Coach runs used today**.

### Live Coach checks after #102

On November 25–26, 2026 (Eastern time), the cloud preview at commit `1175a32af` ran both checks
against the hosted Coach with MiniMax. **Plan > Routines** initially showed “No routines yet.”

**Three-day intake, two requested days.** From beginner Home, select “Add a push day on Tuesday
and a pull day on Wednesday.” Intake showed three days a week, with Monday, Wednesday and Friday
selected, and a 30-minute session. The first request ended with “The server restarted while the
Coach was thinking.” On retry the Coach offered two routines. After **Import this plan**, the
chat showed “scheduled on 2 days.” **Plan > Routines** listed exactly `Push 3 exercises · Tu` and
`Pull 3 exercises · We`.

**French no-weights request.** With equipment unrestricted in intake, send “Prépare-moi une séance de dos sans poids”.
MiniMax offered a one-off “Bodyweight Back” workout with three exercises. The catalogue
instructions confirmed that each movement can be performed without equipment:

| Exercise | What its catalogue entry specifies |
| --- | --- |
| [elbow lift - reverse push-up](../../catalogue/exercises/1772.json) | Lie on the floor and press through the palms. |
| [alternating superman](../../catalogue/exercises/4702.json) | Lie face down and raise the opposite arm and leg. |
| [mid back elbow squeeze](../../catalogue/exercises/8585.json) | Stand tall and draw the elbows back and down. |

This one-off workout offered zero substitutes and was left unstarted. The counter showed
**3 of 3 Coach runs used today** after the French reply. The daily limit stayed at three.

#### French full plan with substitutes

On November 26, 2026, the owner approved raising the daily limit from 3 to 5 for this test.
The test profile showed **3 of 5** before requesting a full plan and **4 of 5** after that request.
The tester then submitted this refinement:

> Prépare-moi un programme complet de trois jours sans poids ni matériel. Pour chaque exercice, indique dans le programme un exercice de remplacement distinct, lui aussi sans matériel, réalisable debout ou au sol. Remplis le champ des substitutions de chaque exercice avec son identifiant du catalogue.

The counter showed **5 of 5**. While the refinement was running, the limit was restored from
5 to 3 and the test profile showed **5 of 3**. MiniMax-M3.1-Flash proposed “Bodyweight Push–Pull–Legs Starter”
with one distinct substitute per exercise. The tester checked the instructions for all 18 catalogue
entries. Each movement can be performed standing or on the floor without apparatus.

| Routine | Proposed exercise | Substitute |
| --- | --- | --- |
| Push | [2921 pike push up](../../catalogue/exercises/2921.json) | [0258 clock push-up](../../catalogue/exercises/0258.json) |
| Push | [0662 push-up](../../catalogue/exercises/0662.json) | [3211 kneeling push-up (male)](../../catalogue/exercises/3211.json) |
| Push | [2398 close-grip push-up (on knees)](../../catalogue/exercises/2398.json) | [0259 close-grip push-up](../../catalogue/exercises/0259.json) |
| Pull | [1772 elbow lift - reverse push-up](../../catalogue/exercises/1772.json) | [4117 kneeling scapular push up](../../catalogue/exercises/4117.json) |
| Pull | [4702 alternating superman](../../catalogue/exercises/4702.json) | [4715 alternating superman v. 2](../../catalogue/exercises/4715.json) |
| Pull | [5041 lying prone t](../../catalogue/exercises/5041.json) | [5042 lying prone w](../../catalogue/exercises/5042.json) |
| Legs & Core | [1686 squat to overhead reach with twist](../../catalogue/exercises/1686.json) | [3948 air squat](../../catalogue/exercises/3948.json) |
| Legs & Core | [3013 low glute bridge on floor](../../catalogue/exercises/3013.json) | [3561 glute bridge march](../../catalogue/exercises/3561.json) |
| Legs & Core | [0001 3/4 sit-up](../../catalogue/exercises/0001.json) | [0262 cross body crunch](../../catalogue/exercises/0262.json) |

The tester left the proposal unimported.

## Backups

On November 26, 2026, the **Disk** page for `ironvane-api` listed one snapshot of the 1 GB disk
mounted at `/data`. Its timestamp popover showed November 24, 2026 at 7:33:05 PM EST
(November 25 at 00:33:05 UTC).

**Restore test blocked on the owner's decision.** No restore was attempted. Restoring a snapshot
overwrites current disk data. Run the test only with the owner's approval while the data is
disposable, then verify a later test routine is gone and `/api/health` succeeds.

For a device profile, Settings > Integrations > WebDAV backup writes a JSON backup to a
folder the person controls. Choose **Back up now**, or enable daily backups while the app is
open. **Restore from a backup** lets the person pick a date and merge or replace their device
data. It excludes photos and videos. See the [WebDAV backup guide](../WEBDAV_BACKUP.md).

## Rollback

To roll back the hosted API, remove the `/api/*` rewrite and suspend the Render service. Device
profiles can still train locally. Keep the disk to preserve linked profiles and their training.

## Cost

A Starter instance plus a 1 GB disk, at Render's published prices. Check the pricing page on the
day: prices change. For the hosted Coach's subscription usage, see [The Coach](#the-coach).
