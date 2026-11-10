# openGym on Cloudflare (Workers + D1)

This folder runs the whole app (sign-in, sync, coach) on Cloudflare. It is not the `cloudflare/`
folder at the repo root: that one is upstream's static fallback for opengym.ch, and deploying it
would replace this app. Every command here runs from `contrib/cloudflare`.

The frontend is served as static assets. The api runs unchanged inside one Durable Object, which
loads `DATA_DIR` at start (D1 for the JSON files, R2 for `uploads/`) and writes back whatever
changed after every request.

## Deploy

```bash
npm i -g wrangler
wrangler login
wrangler d1 create opengym
wrangler r2 bucket create opengym-media
```

Copy the `database_id` it prints into `wrangler.toml` (replace `PASTE_ID` with it):

```bash
perl -pi -e 's/REPLACE_WITH_D1_ID/PASTE_ID/' contrib/cloudflare/wrangler.toml
wrangler d1 execute opengym --remote --file contrib/cloudflare/schema.sql --config contrib/cloudflare/wrangler.toml
node contrib/cloudflare/build.mjs
cd contrib/cloudflare && wrangler deploy
```

`custom_domain = true` creates the DNS record for gym.petervaleria.com, as long as
petervaleria.com is a zone on the same account. Open the site and create your profile first:
`FIRST_USER_ADMIN=1` makes it the admin. Then lock signups in `wrangler.toml` `[vars]`
(`INVITE_ONLY = "1"`, `ALLOW_GUEST = "0"`) and run `wrangler deploy` again.

## Back up

Three layers, newest first:

- **D1 Time Travel** (built in, last 30 days): `wrangler d1 time-travel restore opengym --timestamp=2026-11-10T08:00:00Z`
  rewinds the whole database to that moment. First choice for "something went wrong yesterday".
- **Daily copy in R2** (`backup.js`, the 03:00 UTC cron run): `backups/YYYY-MM-DD.json` in the
  `opengym-media` bucket, kept 30 days. It survives a deleted database. To restore one:

  ```bash
  wrangler r2 object get opengym-media/backups/2026-11-10.json --file backup.json --remote
  node backup.js backup.json restore.sql
  wrangler d1 execute opengym --remote --file restore.sql
  ```

  `restore.sql` empties the `files` table first. Then redeploy (or wait for the object to sleep)
  so the Durable Object reloads from D1 instead of writing its memory back over the restore.
- **By hand**: `wrangler d1 export opengym --remote --output opengym-backup.sql`.

Uploads (photos, videos) live only in R2 and are not in any of these.

## Worker name

The Worker is `opengym-pv`, not `opengym`: upstream's root `cloudflare/` folder deploys a Worker
called `opengym`, and sharing the name meant a deploy from the wrong folder replaced this app.
The data is in D1 and R2, so the name can change without losing anything. The one-time move:

```bash
wrangler deploy          # creates opengym-pv; answer yes if it asks to move gym.petervaleria.com
wrangler delete --name opengym   # the old Worker; D1 and R2 are separate and stay
```

## Limits of this setup

- Uploads live in R2 but are held in the object's memory (128 MB), so `wrangler.toml` caps them:
  50 MB per profile, 20 MB per video, 6 MB per GIF.
- Timers (workout-day reminders, media sweeps) only run while the object is awake, so scheduled
  reminders are not reliable here. Push itself is untested on Workers.
- The locked-out-admin recovery (`node api/recover.js`) needs a local socket and does not work here.

## Local test

```bash
cd contrib/cloudflare
wrangler d1 execute opengym --local --file schema.sql
wrangler dev --var ORIGIN:http://gym.petervaleria.com
```

`wrangler dev` sends requests to the api under the route's host name, so ORIGIN has to say so.

## Deploy on every push to main

`.github/workflows/cloudflare.yml` runs the build and `wrangler deploy` when `main` changes
`contrib/cloudflare/`, `api/`, `frontend/` or `catalogue/`. Add two repository secrets once
(Settings, Secrets and variables, Actions): `CLOUDFLARE_ACCOUNT_ID` (dashboard sidebar, Workers
& Pages) and `CLOUDFLARE_API_TOKEN` (My Profile, API Tokens, Create Token, template "Edit
Cloudflare Workers", then add Account / D1 / Edit and Account / Workers R2 Storage / Edit).
Do the manual deploy once first: the D1 id in `wrangler.toml` must be committed before the
workflow can deploy.

## Garmin Connect

`garmin.js` reads each account's own Garmin data with that person's Personal API key
(connect.garmin.com/app/settings/personalApiToken): sleep, HRV, body battery, steps, calories,
stress and activities. Paste the key in the app under Settings, Integrations, Garmin Connect. It is
kept sealed in `DATA_DIR/garmin/<account>.json` (so in D1 with the rest) and the cron pulls the
last 3 days once an hour. Nothing to configure here. Tests: `node --test contrib/cloudflare/garmin.test.mjs`.

## Cycle tracking

`cycle.js` keeps each account's own cycle log (periods, flow, symptoms, mood, notes) in
`DATA_DIR/cycle/<account>.json`, sealed per account like the Garmin key, so D1 and the nightly
backup hold only ciphertext. It is not part of the synced profile, so the Coach, the MCP server and
the export never see it. Switch it on per account under Settings, Modules, Cycle tracking. Sharing
is per account and off by default: the owner picks any other account and a level (the phase, or the
phase plus the expected next period). Notes, symptoms and fertile days are never shared. The cron
sends one plain reminder the morning before an expected period (opt-in). Predictions are estimates
from the person's own logs, not contraception. Nothing to configure here. Tests:
`node --test contrib/cloudflare/cycle.test.mjs`.
