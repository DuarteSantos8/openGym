# openGym on Cloudflare (Workers + D1)

The frontend is served as static assets. The api runs unchanged inside one Durable Object, which
loads `DATA_DIR` from D1 at start and writes back whatever changed after every request.

## Deploy

```bash
npm i -g wrangler
wrangler login
wrangler d1 create opengym
```

Copy the `database_id` it prints into `wrangler.toml` (replace `PASTE_ID` with it):

```bash
perl -pi -e 's/REPLACE_WITH_D1_ID/PASTE_ID/' cloudflare/wrangler.toml
wrangler d1 execute opengym --remote --file cloudflare/schema.sql --config cloudflare/wrangler.toml
./cloudflare/build.sh
cd cloudflare && wrangler deploy
```

`custom_domain = true` creates the DNS record for gym.petervaleria.com, as long as
petervaleria.com is a zone on the same account. Open the site and create your profile first:
`FIRST_USER_ADMIN=1` makes it the admin. Then lock signups in `wrangler.toml` `[vars]`
(`INVITE_ONLY = "1"`, `ALLOW_GUEST = "0"`) and run `wrangler deploy` again.

## Back up

```bash
wrangler d1 export opengym --remote --output opengym-backup.sql --config cloudflare/wrangler.toml
```

## Limits of this setup

- Photo and video uploads are off (`MEDIA_UPLOADS = "0"`): a D1 row holds at most 2 MB.
- Timers (workout-day reminders, media sweeps) only run while the object is awake, so scheduled
  reminders are not reliable here. Push itself is untested on Workers.
- The locked-out-admin recovery (`node api/recover.js`) needs a local socket and does not work here.

## Local test

```bash
cd cloudflare
wrangler d1 execute opengym --local --file schema.sql
wrangler dev --var ORIGIN:http://gym.petervaleria.com
```

`wrangler dev` sends requests to the api under the route's host name, so ORIGIN has to say so.
