# The hosted server (Ironvane Cloud)

Status: prepared 2026-11-23, not deployed yet. This is the runbook for putting the app's own
server (`api/`) online for the Cloud edition. Self-hosters do not need any of it:
`docker-compose.yml` and `docs/SELF_HOSTING.md` are theirs.

## Why a server at all

The Cloud edition's account lives in Supabase (ADR 0010). Three things need the app's own server
on top of that, and all three are switched off on the preview until it exists:

- **Training tied to the account**, so it follows the person across devices. Today it is stored
  on the device only.
- **The AI Coach** (`docs/AI_COACH.md`): a chat that designs and revises plans, on a model
  provider's API key held by the server.
- **MCP for Claude and ChatGPT** (`docs/MCP_REMOTE.md`): the assistant apps people already use,
  reading and changing their own plans through a connector.

## Shape

| Part | Where | Notes |
|---|---|---|
| Web app (Cloud build) | Vercel | as today |
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

Not checked, because it needs the real service: the Docker build on Render, the disk's
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

- **Deleting an account must delete the training too.** The account screen's Delete removes the
  hosted account; the profile on this server is a separate thing. Where that profile is open in
  the same browser the app now refuses to delete the account until the training is deleted
  first. But an account deleted from a device where the server profile is not open leaves the
  profile, and the training in it, on the server, with nobody able to sign in to it; and if the
  same address signs up again the server may refuse the new identity because the old profile
  still holds it (found in review of #78). Closing this needs the two systems to talk: the
  account's delete has to remove the server profile for that identity, or the server has to
  accept proof from the hosted account. That is a design decision and its own piece of work.
- **The two sessions end together** (`frontend/src/lib/cloud/server-link.js`). Check it once on
  the real service: sign out of the account, and `/api/me` no longer answers. And once with two
  tabs: one left open signed out, the other signing in; the first must not end the profile.
  Known wart: an admin who opened their own profile through the account, signed out, and within
  two minutes uses their passkey on that same profile is signed out once and has to try again.
- Backups, below. Sign-in throttling, above.

## Backups

Everything is under `/data`. Before real users: confirm Render's disk snapshots are on for the
disk and try one restore, or turn on the app's own WebDAV backup (`docs/WEBDAV_BACKUP.md`).
Neither has been tried here yet.

## Rollback

The server is additive. To back out: remove the `/api/*` rewrite (the Cloud build then behaves
as it does today, with training on the device), suspend the Render service, and keep the disk
until its data is no longer wanted.

## Cost

A Starter instance plus a 1 GB disk, at Render's published prices. Check the pricing page on the
day: prices change. The Coach is billed separately by the model provider, per token.
