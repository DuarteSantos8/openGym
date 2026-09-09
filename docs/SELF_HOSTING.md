# Self-hosting openGym

openGym is two small containers (a web server and an API) plus a folder of your data.
This guide takes you from "just cloned it" to "using it from my phone over the internet".

## 1. Run it locally (5 minutes)

Requirements: [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

```bash
git clone https://gitlab.com/DuarteSantos8/opengym
cd openGym
cp .env.example .env
docker compose pull   # prebuilt images from GitLab (amd64 + arm64) — or skip and build from source
docker compose up -d
```

- First start downloads the exercise images/GIFs (~140 MB) once into `media/img` and `media/gif`.
- Open **http://localhost:8080** and create a profile with a passkey.
- Rather build from source than pull prebuilt images? Skip `docker compose pull` and run
  `docker compose up -d --build` instead — no Node needed locally either way.

Check it's healthy:

```bash
docker compose ps
curl http://localhost:8080/api/health      # {"ok":true,...}
```

Logs: `docker compose logs -f`. Stop: `docker compose down`.

## 2. Understand the passkey requirement (important)

openGym signs you in with **passkeys** (WebAuthn). Browsers enforce two rules:

1. Passkeys are bound to an exact **hostname** (`RP_ID`).
2. They only work over **HTTPS** — with one exception: `http://localhost`.

So `http://localhost:8080` works on the machine running Docker, but **another device (your
phone) cannot use `http://<your-LAN-ip>:8080`** — that's neither localhost nor HTTPS, so the
passkey prompt won't appear. To use openGym from your phone you need a real HTTPS hostname.

(You can still open it over LAN in **guest mode**, which stores data only in that browser.)

The standalone mobile app (`docs/MOBILE.md`) sidesteps this entirely for its "connect to my
server" mode: instead of a passkey ceremony (impossible from inside its WebView, which never
runs at your real hostname), it pairs by redeeming a short one-time code — minted from
Settings → "Pair the mobile app" in an already signed-in browser tab — for a bearer token
sent as an `Authorization` header rather than a cookie. Two consequences worth knowing if
you're poking at the API directly:

- `POST /api/pair/create` (needs a session) and `POST /api/pair/redeem` (doesn't) implement
  this — see `api/server.js`. The returned token is the exact same signed value a cookie
  carries, so "sign out everywhere" invalidates it too.
- The server reflects `Access-Control-Allow-Origin` for any request that sends an `Origin`
  header, so the app's own WebView origin can call the API cross-origin. It never sends
  `Access-Control-Allow-Credentials`, so this doesn't let a browser read your cookie session
  from another origin — only bearer-token requests benefit from it.

## 3. Expose it over HTTPS on your own domain

> Want HTTPS **without** exposing anything to the internet — a valid certificate on a LAN-only address? See [SELF_HOSTING_HTTPS.md](./SELF_HOSTING_HTTPS.md) (wildcard cert via a DNS challenge, Caddy in front).

Put openGym behind something that terminates TLS for a hostname you control, then point it at
the `web` container. Pick whichever you already run:

### Option A — Cloudflare Tunnel (no open ports)

1. Create a tunnel and route `gym.example.com` → `http://<docker-host>:8080`.
2. Cloudflare gives you HTTPS automatically.

### Option B — Caddy (automatic Let's Encrypt)

```caddy
gym.example.com {
    reverse_proxy localhost:8080
}
```

### Option C — Traefik / nginx / Nginx Proxy Manager

Route `gym.example.com` (HTTPS) → `web:80` (or `<docker-host>:8080`). Any reverse proxy works —
openGym only needs the browser to reach it over `https://gym.example.com`.

Then set your domain in `.env` and restart:

```bash
# .env
RP_ID=gym.example.com
ORIGIN=https://gym.example.com
WEB_PORT=8080
RP_NAME=openGym
```

```bash
docker compose up -d
```

Visit `https://gym.example.com`, create your profile, and add it to your home screen
(iOS: Share → Add to Home Screen · Android: ⋮ → Add to Home screen).

> Changing `RP_ID` later invalidates existing passkeys (they were bound to the old hostname).
> Pick your domain before people register.

## 4. Multiple users

Anyone who can reach the URL can create their own profile — each gets isolated data. That's the
default: open signup, no admin.

If you'd rather control who gets in, three optional settings in `.env` turn that around:

```bash
ADMIN_UIDS=youruserid      # comma-separated; these users get the admin dashboard
INVITE_ONLY=1              # new profiles need an invite code
ALLOW_GUEST=0              # remove "Continue without account"
```

Register your own passkey profile first, then find your id in `./data/db.json` under `users[].id`
and put it in `ADMIN_UIDS`. You'll get an **Admin dashboard** link in Settings: who's training
right now, each user's workout history and body weight, the ability to disable an account (signed
out and locked out everywhere until you re-enable it), and — with `INVITE_ONLY=1` — generating and
revoking invite codes. Existing accounts keep working when you switch invite-only on. Admin access
is gated by your passkey and enforced server-side, so it needs no separate login.

### The activity log

The dashboard also keeps an **activity log**: sign-ins, sign-outs, failed attempts, refused
signups, and every admin action (disabling an account, creating or revoking an invite code). It
lives in `./data/audit.log` as one JSON object per line, so `tail -f data/audit.log` and `jq`
work on it directly, and the dashboard reads the same file.

It is on by default and keeps the last 5,000 events or 90 days, whichever comes first
(`AUDIT_LOG=0` turns it off entirely; `AUDIT_MAX` and `AUDIT_DAYS` change the caps). **IP
addresses are not recorded** unless you set `AUDIT_IP=net` (network only, e.g. `203.0.113.0/24`)
or `AUDIT_IP=full`. Neither the browser's user-agent nor the passkey id of a failed sign-in is
ever stored: the first is a fingerprint, and the second would let you follow an unknown device
from one attempt to the next.

Two things worth expecting. **Guests never appear** — guest mode never talks to the server, so
there is nothing to log, exactly as there is nothing for the rest of the dashboard to show. And
**a disabled account goes quiet**: a disabled user is refused at the session check, so their only
entries are the failed sign-ins they keep making.

Clearing the log from the dashboard records the clear itself, and the event ids keep counting, so
a gap is always visible.

`INVITE_ONLY=1` and `ALLOW_GUEST=0` answer different questions and are usually set together.
Invite-only controls who may *create a profile*; it says nothing about the **Continue without
account** button, which never creates one. Guest mode keeps everything in that browser and never
talks to the server — there is no account, no sync and nothing for the admin dashboard to show —
so on an instance meant for a known set of people it is a door that leads nowhere useful. With
`ALLOW_GUEST=0` the button is gone, and anyone already using the app as a guest is returned to the
login screen on their next visit. Their data is not deleted: it stays in that browser and comes
back if you ever switch guests on again, or moves into a real profile if they create one on the
same device.

Prefer to keep the whole thing off the open internet? A VPN or an auth proxy (Authelia, Cloudflare
Access…) in front still works, and composes with the above.

## 5. Fitting it into an existing stack

The defaults assume openGym is the only thing here: a service called `api` on port 3000, and nginx
on port 80 inside its container. If you are merging this into a compose file that already has an
`api`, or you put the web container behind your own reverse proxy on a different port, four
settings in `.env` move those without editing any config file:

```bash
WEB_PORT=8080              # host port — what you browse to
NGINX_PORT=80              # port the web container listens on, inside the container
BACKEND=api                # name of the API service that /api is proxied to
PORT=3000                  # port the API listens on; web proxies to the same value
SESSION_DAYS=90            # how long a sign-in lasts
```

The web image renders its nginx config from these when the container starts, so they take effect
on a **prebuilt image** — no rebuild. `BACKEND` and `PORT` together are what `/api` is proxied to,
so they have to name a service the web container can actually reach on your compose network.

Note the difference from `VITE_IMG_BASE` / `VITE_GIF_BASE` (see Troubleshooting): those are
build-time values baked into the frontend bundle, and setting them next to `docker compose` does
nothing to an image you pulled.

## 6. Backups

Everything is in `./data`:

```bash
tar czf opengym-backup-$(date +%F).tar.gz data/
```

That archive contains all profiles, passkeys and workout history — and, if the activity log is
on, `audit.log` with everyone's sign-in times. Worth knowing before you ship the archive to a
backup service you don't run. Restore by unpacking it back into the project folder. (Individual
users can also export their own data as JSON from Settings.)

If you enabled the AI Coach with the Codex provider, note what this archive deliberately does
**not** contain: `./coach-auth`, where that provider keeps its refreshable sign-in. It is a
sibling of `./data` rather than a folder inside it precisely so that a live credential does not
end up in every backup you are told to make — an archive like this gets copied to laptops and
cloud drives, and a refresh token keeps working wherever it lands. Nothing in `./coach-auth`
needs backing up: if you lose it, sign the provider in again.

API keys for the HTTPS providers (Anthropic, OpenAI, Gemini, a compatible endpoint) are the
other way round: they are in `./data/coach.json`, encrypted with `./data/secret`, so they *are*
in this archive — and unreadable without the secret next to them, like everything else in it.

## 7. Notifications

openGym can push two kinds of alert to your phone/desktop, even when the app isn't open:
rest-timer-over, and a reminder on days you have a workout planned but haven't logged one yet.
Turn it on per-profile in **Settings → Notifications** (requires a signed-in passkey profile and
HTTPS — see section 3).

No setup needed server-side, and nothing to configure per timezone: VAPID keys are generated on
first run and saved to `./data/vapid.json`, and each user's browser reports its own timezone
automatically when they turn the reminder on — it fires at their local time, and follows them if
they travel, regardless of what timezone the server itself runs in.

**Keep screen awake** (Settings → *During a workout*) has the same transport requirement: the
Wake Lock API is only available over HTTPS or on `http://localhost`, so on a plain-LAN-IP
instance the switch shows as unsupported. Nothing to configure server-side either way, and iOS
refuses the lock while the phone is in Low Power Mode.

Push services like a contact address for whoever runs the server, in case they ever need to reach
you about your pushes. openGym sends your `ORIGIN` by default; set `VAPID_SUBJECT=mailto:you@example.com`
in `.env` if you would rather they had an inbox.

## 8. Updating

Running prebuilt images:

```bash
git pull                    # picks up compose/config changes
docker compose pull
docker compose up -d
```

Building from source instead:

```bash
git pull
docker compose up -d --build
```

The app shell is versioned (`?v=N`) so clients pick up changes on next load. Your `./data` and the
downloaded media are untouched.

## Passkeys fail even though `RP_ID` looks right

The most common support question, and the values are usually *nearly* correct. Work through
these in order — the first two account for most of it.

**1. Ask the server what it actually loaded.** It prints both values on startup:

```
docker compose logs api | grep 'gym-api on'
# gym-api on :3000 (rpID=gym.example.com, origin=https://gym.example.com)
```

If that disagrees with your `.env`, the container is still running the old environment.
`docker compose restart` does **not** re-read `.env` — use `docker compose up -d`.

**2. Check the exact shape of each value.** They are not the same kind of string:

| | Correct | Wrong |
|---|---|---|
| `RP_ID` | `gym.example.com` | `https://gym.example.com`, `gym.example.com:8080`, `gym.example.com/` |
| `ORIGIN` | `https://gym.example.com` | `gym.example.com`, `https://gym.example.com/` |

`RP_ID` is a bare hostname: no scheme, no port, no trailing slash. `ORIGIN` is the full origin
*with* the scheme and *without* a trailing slash. Both must match your address bar exactly.

**3. Behind a tunnel or reverse proxy, use the public hostname.** With Cloudflare Tunnel,
Traefik, nginx or Caddy in front, the browser only ever sees the public name — so that is what
both values must be. Not the container name, not the LAN IP, not the internal port:

```env
RP_ID=gym.example.com
ORIGIN=https://gym.example.com
```

The tunnel's own route may point wherever it likes (`http://localhost:8080` is fine). It is the
browser-facing name that has to appear here.

**4. `www.` is a different host.** A passkey registered on `gym.example.com` will not work on
`www.gym.example.com`. Pick one and redirect the other.

**5. Changing the hostname invalidates existing passkeys.** They were bound to the old one, so
everybody registers again — which is why it pays to settle the domain before others join.

> On a LAN without certificates there is nothing to configure that makes passkeys work over
> plain `http://192.168.x.x`: browsers only allow WebAuthn on HTTPS (or `localhost`). Use guest
> mode, the standalone mobile app (`docs/MOBILE.md`), or put a certificate in front of it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No passkey prompt on my phone | You're on `http://` or an IP, not HTTPS. Set up a domain (section 3). |
| "verification failed" on login | `RP_ID`/`ORIGIN` don't match the URL in the address bar. See the section above — start with what the server logged on startup. |
| Media didn't download | `docker compose logs media`. Re-run `docker compose up -d`, or run `./scripts/fetch-media.sh`. |
| Port 8080 already used | Set `WEB_PORT=9090` in `.env` (and update `ORIGIN` for local testing). |
| No "Notifications" option in Settings | Requires a signed-in profile and HTTPS (or `localhost`) — guest mode and plain HTTP over LAN can't subscribe. |
| Day reminder fires at the wrong time | Toggle it off and on in Settings so it re-detects your browser's timezone (also happens automatically on every app load — see section 7). |
| Want to reset a stuck login | Delete the cookie in your browser; sessions are just signed cookies. |
| `docker compose pull` fails with "denied" / "unauthorized" | The prebuilt images aren't published yet, or need to be, or the GHCR package is still private — build from source instead (`docker compose up -d --build`). |
| Exercise images/GIFs blank when a routine is open | Fixed in current images (issue #79). On an older build, see the note below. |

### `VITE_IMG_BASE` / `VITE_GIF_BASE` are build-time, not run-time

These two are read by Vite when the frontend is **compiled**, so their values are baked into
the shipped JavaScript bundle. Setting them in the `.env` next to `docker compose` has no
effect on an already-built image — the bundle has already made up its mind.

They are only useful if you build the frontend yourself (`docker compose up -d --build`, or a
`npm run build` with the variables exported). If you need to redirect media on a prebuilt
image, do it in your reverse proxy instead.
