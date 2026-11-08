# Routines service

`server.mjs` runs behind `opengym.ch/routines/api/`. It is the only moving part of the routines
library; the pages themselves are static files from `node scripts/routines/build.mjs`.

| Route | What it does |
|---|---|
| `POST api/preview` | `{ link }` or `{ plan }`: reads an openGym routine link or plan file and returns the days with exercise names, or the problems |
| `POST api/submit` | the submit form: plan + title, description, credit, language, tags, optional cover photo (base64). Checked with `checkRoutine` (the CI validator), stored in `pending/`, sent to Telegram |
| `POST api/copy` | `{ id }`: one "Copy to openGym" (counted once per visitor per routine per day) |
| `GET api/stats` | `{ copies: { id: n } }`, what "Most copied" sorts by |
| `GET api/health` | `{ ok: true }` |

With `SITE_DIR` set it also serves the built site under `SITE_BASE` (staging and local runs): no
directory listings, `index.json` with `Access-Control-Allow-Origin: *`, exercise stills only for
pages on the same site (referer check, `noimageindex`), everything `noindex` when `ENV_LABEL` is set.

## Abuse and privacy

- Limits: submit 4 an hour per visitor and 60 a day in total, preview 40 per 10 minutes, bodies
  capped (1 KB, 300 KB, ~11 MB with the photo), photo 8 MB before and 600 KB after re-encoding.
- A hidden `website` field and a minimum of 4 seconds on the page: bots get `{ ok: true }` and
  nothing is stored or sent.
- Photos: the type is read from the bytes (jpg/png/webp only), the browser redraws it on a canvas
  (that drops EXIF and applies the rotation), then `cwebp -metadata none` re-encodes it to at most
  1600 px. Nothing of the original file is kept.
- The counter stores `{ routine id: number }` and nothing else. Visitors are told apart by an HMAC
  of their address with a random key that is replaced every day and never written down. No cookies.

## Moderation

Every submission arrives in the owner's Telegram chat (the crash-notify bot): the cover photo if
there is one, then a message with the whole routine and two buttons.

- **✅ Approve**: with a GitHub token, the routine (and cover) is committed to the `routines-inbox`
  branch as `routines/community/<name>.json` and the message links the commit. Open a pull request
  from `routines-inbox` to `main` (CI validates it again), merge, deploy the site. Without a token,
  the file is saved on the server in `<DATA_DIR>/approved/` and the message says where.
- **❌ Reject**: the submission and its photo are deleted.

Only presses from `TELEGRAM_CHAT_ID` count. The buttons carry the environment (`staging`/`prod`),
so a staging message can't approve on production. The service long-polls `getUpdates` for button
presses only (`allowed_updates: ["callback_query"]`); **only one process may poll a bot**, so stop
the staging container before production polls the same bot, or give production its own bot.

### The GitHub token (owner, once)

1. github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** →
   Generate new token.
2. Name `opengym-routines-inbox`, expiration up to a year, resource owner **DuarteSantos8**.
3. Repository access: **Only select repositories** → `DuarteSantos8/openGym`.
4. Repository permissions: **Contents: Read and write** (Metadata: Read-only is added by itself).
   Nothing else.
5. Generate, copy, and put it on the VM without it ever showing up in a terminal log:
   `ssh root@192.168.1.159 'umask 077; cat >> /opt/homelab/docker-apps/apps/routines-staging/telegram.env'`,
   paste `GITHUB_TOKEN=github_pat_…`, Enter, Ctrl-D. Then restart the container
   (`docker compose -p routines-staging -f apps/routines-staging/docker-compose.yml up -d`).
6. Optional: protect `main` as usual; the token can only write branches, and the routines only
   reach `main` through a reviewed pull request.

## Environment

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `SITE_BASE` | `/routines/` | the public prefix; the API is `<SITE_BASE>api/` |
| `SITE_DIR` | none | serve the built site from here (staging) |
| `DATA_DIR` | `/data` | `pending/`, `approved/`, `counts.json` |
| `CATALOGUE` | `/app/catalogue-lite.json` | written by `build.mjs --lite` |
| `ENV_LABEL` | none | `STAGING`: marks Telegram messages and noindexes everything |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | none | moderation; without them submissions just wait in `pending/` |
| `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH` | `DuarteSantos8/openGym`, `routines-inbox` | see above |

## Deploying (VM 192.168.1.159, Docker only there)

```bash
# On pve, in the repo: the site and the image's build context
export PATH=/opt/node22/bin:$PATH
B=/routines-preview-7kq3m/            # production: /routines/
node scripts/routines/build.mjs --out /tmp/rt/site --base $B --staging --lite /tmp/rt/ctx/catalogue-lite.json
mkdir -p /tmp/rt/ctx/scripts/routines/service
cp scripts/routines/lib.mjs /tmp/rt/ctx/scripts/routines/
cp scripts/routines/service/server.mjs scripts/routines/service/Dockerfile /tmp/rt/ctx/scripts/routines/service/

# To the VM, by tar (targeted: nothing else in docker-apps is touched)
ssh root@192.168.1.159 'mkdir -p /opt/homelab/docker-apps/{apps/routines-staging/build,sites/routines-staging,data/routines-staging}'
tar -C /tmp/rt/ctx -cz . | ssh root@192.168.1.159 'tar -C /opt/homelab/docker-apps/apps/routines-staging/build -xz'
tar -C /tmp/rt/site -cz . | ssh root@192.168.1.159 'rm -rf /opt/homelab/docker-apps/sites/routines-staging/* && tar -C /opt/homelab/docker-apps/sites/routines-staging -xz'

# The Telegram secret: copied file to file, never printed
scp /etc/crash-notify.env root@192.168.1.159:/opt/homelab/docker-apps/apps/routines-staging/telegram.env
ssh root@192.168.1.159 'chmod 600 /opt/homelab/docker-apps/apps/routines-staging/telegram.env; chown 1000:1000 /opt/homelab/docker-apps/data/routines-staging'

ssh root@192.168.1.159 'cd /opt/homelab/docker-apps && docker compose -p routines-staging -f apps/routines-staging/docker-compose.yml up -d --build'
```

`apps/routines-staging/docker-compose.yml` (kept in the homelab repo) runs the container on the
`homelab-proxy` network with a Traefik router for `Host(opengym.ch) && PathPrefix(<base>)`, so the
live site and its nginx are never touched.

### Going live

1. Merge the routines branch, build with `--base /routines/` (no `--staging`) into
   `docker-apps/sites/opengym/dist/routines/` (targeted rsync/tar of that folder only).
2. Add to `config/nginx/opengym.conf` (then `docker exec docker-apps-opengym-1 nginx -s reload`):
   ```nginx
   location /routines/ { try_files $uri $uri/ =404; }
   # The pages load ES modules (filter.mjs, qr.mjs): nginx must send them as JavaScript, or browsers refuse them.
   location ~* \.mjs$ { types { } default_type application/javascript; }
   location = /routines/index.json { add_header Access-Control-Allow-Origin "*" always; add_header Cache-Control "public, max-age=3600"; }
   location ^~ /routines/plans/ { add_header Content-Disposition "attachment"; }
   location ^~ /routines/media/ {
       valid_referers none blocked server_names opengym.ch;
       if ($invalid_referer) { return 403; }
       add_header Cross-Origin-Resource-Policy "same-origin" always;
       add_header X-Robots-Tag "noindex, noimageindex" always;
       add_header Cache-Control "public, max-age=604800";
   }
   ```
3. Run the service as `routines` with `SITE_BASE=/routines/`, no `SITE_DIR`, no `ENV_LABEL`, and a
   Traefik router `Host(opengym.ch) && PathPrefix(/routines/api/)` (priority above the site's).
   Stop the staging container first (one Telegram poller per bot).
4. `website/robots.txt` already lists `https://opengym.ch/routines/sitemap.xml`; the site header
   gets its Routines link from the same deploy (website/*.html).
