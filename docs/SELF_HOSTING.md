# Self-hosting openGym

openGym is two small containers (a web server and an API) plus a folder of your data.
This guide takes you from "just cloned it" to "using it from my phone over the internet".

## 1. Run it locally (5 minutes)

Requirements: [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

```bash
git clone https://github.com/DuarteSantos8/openGym   # or https://gitlab.com/DuarteSantos8/opengym — same repo
cd openGym
cp .env.example .env
docker compose pull   # prebuilt images from GitLab's registry (amd64 + arm64; the same images are on ghcr.io) — or skip and build from source
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

(You can still open it over LAN in **guest mode**, which stores data only in that browser — or
turn on **password sign-in**, see [§4](#password-sign-in-optional).)

The standalone mobile app (`docs/MOBILE.md`) sidesteps this entirely for its "connect to my
server" mode: instead of a passkey ceremony (impossible from inside its WebView, which never
runs at your real hostname), it pairs by redeeming a short one-time code — minted from
Settings → "Pair the mobile app" in an already signed-in browser tab — for a bearer token
sent as an `Authorization` header rather than a cookie. Two consequences worth knowing if
you're poking at the API directly:

- `POST /api/pair/create` (needs a session) and `POST /api/pair/redeem` (doesn't) implement
  this — see `api/server.js`. The returned token is the exact same signed value a cookie
  carries, so "sign out everywhere" invalidates it too — and a phone has no passkey to sign
  back in with, so every paired phone has to be **paired again** afterwards. The phone says
  so ("Your server no longer accepts this phone") and keeps its data until it is.
- The token lasts `SESSION_DAYS` like a cookie, but renews itself: `GET /api/me`, which the
  app calls on every start, answers a bearer token past half its lifetime with a fresh
  `token` carrying the account's current session version. Revocation is unaffected.
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
openGym only needs the browser to reach it over `https://gym.example.com`. If that proxy caps
request bodies (nginx does, at 1 MiB by default), allow at least 5 MiB on `/api/` — the app syncs
its whole history in one PUT; the bundled web image already allows 5 MiB, matching the API. The
photos and videos people attach to their own exercises need more room and more time on
`/api/media/` — see [Photos and videos of custom exercises](#photos-and-videos-of-custom-exercises).

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

Register your own passkey profile first, then copy your id from **Settings → Account → Account
ID** (tap it to copy; it is also in `./data/db.json` under `users[].id`) and put it in
`ADMIN_UIDS`. The same row is how anyone on your instance tells you which account is theirs when
they need help. You'll get an **Admin dashboard** link in Settings: who's training
right now, each user's workout history and body weight, the ability to disable an account (signed
out and locked out everywhere until you re-enable it), and — with `INVITE_ONLY=1` — generating and
revoking invite codes. Existing accounts keep working when you switch invite-only on. Admin access
is gated by your passkey and enforced server-side, so it needs no separate login.

### Default language

An instance whose people share a language can start everyone in it:

```bash
DEFAULT_LANG=pt-BR         # any code from Settings → Language: de, es, fr, pt-BR, …
```

The sign-in and create-profile screens open in that language, and so does every profile that
has never picked one in **Settings → Language**. Anyone's own choice there always wins, and
profiles that existed before this setting keep the language they have — the app cannot tell an
old profile that chose English from one that never looked, so it leaves them alone. Without
`DEFAULT_LANG`, a new visitor starts in their browser's language when openGym has it, else
English. A code the app has no translation for is ignored. The phone app in local mode has no
server to ask and is unaffected.

Until someone picks a language, it is worked out on each device and not saved with the profile:
without `DEFAULT_LANG`, the same profile can show in German on one phone and in English on a
laptop, and the Coach answers in whichever the app is showing. A scheduled review, which no app
asks for, is written in `DEFAULT_LANG` when it is set.

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

Behind an auth proxy, let three files through without a login: `/icon-180.png`, `/icon-512.png`
and `/manifest.json` — the app's icon and its manifest, nothing personal in them. iOS fetches the
Home Screen icon outside the page, without your session cookie, so a gated icon comes back as the
proxy's login page and iOS 26 draws a letter tile instead of the dumbbell (observed on iOS 26.6
behind Teleport; Authelia users know the same from favicons and manifests). Authelia: a `bypass`
rule for those paths; Authentik: unauthenticated paths; Cloudflare Access: a bypass policy;
oauth2-proxy: `skip_auth_routes`. A proxy that cannot exempt a path (Teleport) has to serve the
icons inline as `data:` URLs instead — Safari 26 accepts those, older iOS does not, which is why
that is not the default here.

### Password sign-in (optional)

Passkeys are the default and stay the recommended way in. Some people cannot use them: a browser
on a plain `http://` LAN address (passkeys need HTTPS or `localhost`), a Firefox setup that only
offers a hardware key, a passkey on a phone that will not move to the desktop. For them there is
an optional name-and-password sign-in, off unless you ask for it:

```bash
PASSWORD_LOGIN=1
```

What changes when it is on:

- The sign-in screen offers **Sign in with password**, and **Create new profile** can use a
  password instead of a passkey — in browsers without passkey support too. With `INVITE_ONLY=1`
  it asks for the invite code exactly like passkey signup does.
- Settings → Account gets a **Password** row. Nobody has a password until they set one there.
  Setting a first password asks for the profile's passkey; changing it asks for the current
  password (or the passkey, if it was forgotten). Either signs the profile out everywhere else,
  and paired phones have to be paired again. Removing it asks for the password or the passkey
  too — a session on its own may be a copied cookie.
- People sign in with their **profile name** — case and surrounding spaces do not matter — and the
  password. Two profiles with a password cannot share a name; Settings says so when a name is
  already taken that way.
- Optionally with an **e-mail address** instead of the name: see *Signing in with an e-mail*
  below.
- A password cannot be removed while it is the profile's only way in (a profile made with a
  password has no passkey).
- The password also confirms the changes that need proof — adding or removing a passkey, making
  a code for another device — but only while `PASSWORD_LOGIN=1`.

**Switching it off again** turns every password route off, and a password kept from before no
longer confirms anything either: an old or reused one must not be enough to add a passkey. A
profile that only has a password can then neither sign in nor add a passkey, even from a
browser that is still signed in. Before you switch it off, have those profiles add a passkey
(**Settings → Account → Passkeys → Add a passkey**, confirmed with their password); the admin
dashboard marks every profile that has a password.

**Signing in with an e-mail.** Settings → Account also gets a **Sign-in e-mail** row, right under
the password, and **Create new profile** with a password has an optional e-mail field. Whoever
adds an address can type it at **Sign in with password** instead of their profile name (case and
spaces do not matter). openGym has no mail server and **never sends anything** to it: there is no
verification mail and no reset mail — a forgotten password is still reset with the admin's code
below, which can be redeemed with the name or the e-mail. So the address is not proven to belong
to anyone; it is only a second name that points at the account, and the password still opens it.

- Adding, changing and removing it asks for the same proof as setting a password (the current
  password or a passkey of the profile) — a session on its own may be a copied cookie.
- An address belongs to one profile only, and can never be another password profile's name.
  Taking one that is in use is refused ("Another profile already uses this e-mail address") — see
  *What an e-mail gives away* below for what that says and how it is limited.
- Wrong passwords count against the **account**, whether it was named by its name or its e-mail,
  so switching between the two does not get around the pause.
- Only the owner (in Settings) and admins (the user list and the user's page in the admin
  dashboard) ever see the address. It is not written to the activity log (entries show it masked,
  `a…@e…`) or the container log, is not part of what the Coach, the MCP server or plan sharing
  see, and is not in `/api/me`. It is stored in `db.json` as `email` on the user, lower-cased.
- With `PASSWORD_LOGIN` off, the row and the field are hidden and the address is not used; it
  stays in `db.json` for when the flag comes back.

**What an e-mail gives away.** A profile trying to take an address already in use is told so,
which says "some profile on this instance uses this address" — never which one. The alternative,
accepting it silently, would leave someone who typed their address on a second profile believing
it worked. So the answer is made expensive instead: in Settings it comes only after the proof (a
passkey prompt or a password check per try). Signing up with a password needs no proof, so there
the answer costs less: it comes after the new password is hashed and, with `INVITE_ONLY=1`, only
to someone with a valid invite code (a refusal leaves the code unused); on an open instance
anyone can ask. Every such refusal — in Settings or on signup — counts against the visitor's
address (and in Settings the account): 20 are free, then a pause of 30 seconds doubling to 15
minutes. That leaves a few tries an hour, comparable to what the
name-taken answer already says about names. The other thing to know: once someone has paused an
account by wrong passwords under its name, trying a guessed address shows the same pause, which
ties that address to that name — the price of not letting a switch to the e-mail skip the pause.

**Resetting a password.** There is no e-mail. In the admin dashboard open the user and choose
**Reset password**. You get a one-time code such as `K7WQ-2MZP-4HXA` to hand over in person or
by message: it is shown once, works once, is valid for 24 hours and is stored only as a hash.
Issuing it removes their current password and signs them out everywhere at once — their passkeys
keep working. They enter their name (or their sign-in e-mail), the code and a new password under **Sign in with password →
Have a reset code?**. The same code gets someone back in who lost their only passkey (#219).
Admin accounts cannot be reset from the dashboard, so one admin cannot take over another's login;
an admin sets their own password in Settings. Every step is in the activity log
(`admin.password.reset`, `auth.password.reset`, `auth.password.ok` / `fail` / `locked`, and
`auth.email.set` / `change` / `remove` / `fail` for the sign-in e-mail).

**On a plain-HTTP LAN**, set `ORIGIN` to exactly the address people type, for example
`ORIGIN=http://192.168.1.20:8080`. Browsers do not send `Sec-Fetch-Site` to plain-http addresses,
so the API compares the request's `Origin` with `ORIGIN` instead and refuses sign-ins (and syncs)
that come from anywhere else. Know what you are trading: without TLS the password and the session
cookie (which cannot be `Secure` over http) cross your network in the clear. For a certificate on
a LAN-only address, see [SELF_HOSTING_HTTPS.md](./SELF_HOSTING_HTTPS.md).

**What a password gives up compared with a passkey:**

- A passkey cannot be phished, reused or guessed — it is bound to your hostname and never leaves
  the device. A password can be all three, which is why passkeys stay the default everywhere.
- `db.json` holds a scrypt hash of each password (N=2^15, r=8, p=1, 16-byte random salt). Someone
  with a copy of `./data` can try guesses offline, slowly; a passkey's public key gives them
  nothing to try.
- Guessing online is throttled. Five wrong passwords for an account — named by its name or its
  e-mail — pause password sign-in for that account for a minute, doubling up to an hour, whoever
  sends them — names and addresses that do not exist pause the same way, so a pause reveals
  nothing about whether they exist. Twenty wrong answers from one address pause that
  address for 30 seconds, doubling up to 15 minutes, and every address gets 60 requests a minute
  to the password routes. Guesses sent all at once count the same as guesses sent one by one.
  Passkey sign-in, passkey signup and phone pairing are not throttled at all, so they are never
  paused. The counters live in memory, so a restart clears them.
- The flip side: anyone who knows a name can keep that name's *password* sign-in paused. The
  activity log shows it (`auth.password.locked`), and passkeys still work. A reset code is not
  paused per name — it is 60 random bits and lives a day — so nobody can keep a real code from
  working by sending wrong ones.
- A pending reset code keeps its profile's name: until it is used or expires, nobody else can
  register that name with a password or set a first password on another profile of that name.
- Passwords need 10 to 256 characters and may not be one of a short built-in list of the
  passwords guessing scripts try first (`Password123!`, `qwerty…`, the profile's own name with
  digits). A long passphrase is the point.

**Which address counts as one visitor.** The throttle needs the visitor's address. With the
bundled `docker-compose.yml` it reads the one the web container passes on: the compose file sets
`TRUST_PROXY=1` for the api, because the API is reachable only through that container, which
overwrites `X-Forwarded-For`. If you put another reverse proxy in front of the web container, every
visitor may arrive as that proxy — then the per-address limits apply to everyone together: one
client sending wrong passwords can pause password sign-in for everybody for up to 15 minutes at a
time (passkeys keep working), and the per-name pause is what protects the passwords. Behind
Cloudflare, `CF_CONNECTING_IP` (see the activity log above) passes the real visitor on. Running
the API without the web container, leave `TRUST_PROXY` off unless whatever is in front overwrites
(not appends to) `X-Forwarded-For`.

**Switching it off again** hides all of it and makes every password route answer 404. The stored
hashes stay in `db.json` and work again if you switch it back on — but while it is off, a profile
that only has a password cannot sign in.

The mobile app keeps pairing: someone with a password signs in to the website with it and pairs
from Settings → "Pair the mobile app", as with a passkey.

## 5. Fitting it into an existing stack

Running Kubernetes? Example manifests (Deployment, PVCs, Service, Gateway API route) are in
`kubernetes/`, described in [SELF_HOSTING_KUBERNETES.md](SELF_HOSTING_KUBERNETES.md).

The defaults assume openGym is the only thing here: a service called `api` on port 3000, and nginx
on port 80 inside its container. If you are merging this into a compose file that already has an
`api`, or you put the web container behind your own reverse proxy on a different port, four
settings in `.env` move those without editing any config file:

```bash
WEB_PORT=8080              # host port — what you browse to
NGINX_PORT=80              # port the web container listens on, inside the container
BACKEND=api                # name of the API service that /api is proxied to
PORT=3000                  # port the API listens on; web proxies to the same value
RESOLVER=127.0.0.11        # DNS nginx resolves BACKEND with — Docker's, unless you are not on Docker
BASE_PATH=                 # subpath openGym is served under, e.g. /gym — see below; empty = site root
SESSION_DAYS=90            # how long a sign-in lasts
```

`RESOLVER` only matters off Docker. nginx re-resolves `BACKEND` on every `/api` request so a
recreated API container does not leave it proxying to a dead IP, and `127.0.0.11` is where
Docker answers those lookups. Nothing listens there on another runtime, and an unreachable
resolver does not fail fast — every `/api` request hangs until it times out. On Kubernetes set
it to the cluster DNS service address (`kubectl -n kube-system get svc kube-dns`, commonly
`10.96.0.10`); under Podman, to whatever its network provides.

`SESSION_DAYS` is how long a browser sign-in and a phone pairing last, counted from when they
were issued; lowering it never cuts an existing session short. A browser renews its session by
signing in; a paired phone renews its token by itself whenever it starts past half of that
time, so only a phone left unopened for longer than `SESSION_DAYS` has to be paired again.

The web image renders its nginx config from these when the container starts, so they take effect
on a **prebuilt image** — no rebuild. `BACKEND` and `PORT` together are what `/api` is proxied to,
so they have to name a service the web container can actually reach on your compose network.

Note the difference from `VITE_IMG_BASE` / `VITE_GIF_BASE` (see Troubleshooting): those are
build-time values baked into the frontend bundle, and setting them next to `docker compose` does
nothing to an image you pulled.

### Serving openGym under a subpath

openGym can live at `https://example.com/gym/` rather than on a host of its own. Which of the two
setups below you need depends on one thing: whether your reverse proxy strips the prefix before
the container sees the request.

**The proxy strips the prefix** (Caddy's `handle_path`, Traefik's `StripPrefix` middleware,
nginx `proxy_pass` with a trailing slash). Nothing to configure. The app's assets are relative
and it asks its own address for the API, so everything stays inside the prefix on its own:

```caddy
example.com {
    handle_path /gym/* {
        reverse_proxy opengym-web:80
    }
}
```

**The proxy passes the prefix through.** Tell the web container what it is, without a trailing
slash:

```bash
BASE_PATH=/gym
```

That is a start-up setting like the others above, so it works on a prebuilt image. Forward only
the prefix to the container — openGym does not serve itself at the site root as well, and a copy
reached there would look for an API that is not on that path.

Either way, keep `ORIGIN` and `RP_ID` pointing at the address in the browser's bar
(`ORIGIN=https://example.com`, `RP_ID=example.com`). Passkeys key on the host, not the path, so a
subpath changes nothing about section 2 — but it does mean two instances under one hostname share
a passkey scope and can see each other's credentials. Give each its own hostname if that matters.

### Photos and videos of custom exercises

Anyone signed in can give an exercise they made one photo, GIF or short video (and, separately,
a link, which the server never fetches), and attach up to six photos or videos to a logged
workout — a progress photo, a form-check clip. Both kinds share one quota and one set of limits.
The file is uploaded to this server and stored under
`./data/uploads/<profile id>/`, named by its SHA-256. Only its owner can download it again — no
admin route, no Coach and no shared plan reads it. It is on by default, with these limits, all
set in `.env`:

| Variable | Default | Meaning |
|---|---|---|
| `MEDIA_UPLOADS` | `1` | `0` removes the upload routes; the app then offers the link field only |
| `MEDIA_QUOTA_MB` | `200` | space per profile; `0` = no cap |
| `MEDIA_IMAGE_MAX_MB` | `2` | a photo after the app shrank it to 1600 px, and every thumbnail |
| `MEDIA_GIF_MAX_MB` | `8` | an animated GIF |
| `MEDIA_VIDEO_MAX_MB` | `40` | a video, as recorded — the app does not re-encode videos |
| `MEDIA_VIDEO_MAX_SEC` | `60` | a video's length |
| `MEDIA_GC_GRACE_DAYS` | `14` | how long a file nobody uses any more is kept |
| `MEDIA_UPLOADS_PER_HOUR` | `600` | uploads per profile per hour; at most two run at once |
| `MEDIA_MIN_FREE_MB` | `512` | uploads are refused while the disk under `./data` has less free; `0` = no floor |
| `MEDIA_UPLOAD_MAX` | `48m` | the web container's body limit on `/api/media/` (nginx syntax); keep it above `MEDIA_VIDEO_MAX_MB` |

Every MB here is 1024 × 1024 bytes. The API reads the `MEDIA_*` caps; the app gets them from
`/api/config` and refuses a file the server would refuse before uploading it.

**Disk.** The worst case is `MEDIA_QUOTA_MB` times the number of profiles. On an instance with
open signup, lower the quota. `MEDIA_MIN_FREE_MB` stops uploads before they fill the disk — a
full disk is also a state save that cannot land, for everybody.

**A reverse proxy in front** has to let the uploads through, or they fail with a 413 or a
timeout the app can only report as "The server refused the file as too large":

- **Body size**: at least `MEDIA_VIDEO_MAX_MB` on `/api/media/`. nginx allows 1 MiB unless told
  otherwise (`client_max_body_size`); Cloudflare's free plan caps a request at 100 MB.
- **Timeouts**: a 40 MB video over a slow mobile uplink takes minutes. Traefik v3 cuts a request
  whose body is still arriving after its entryPoint's `readTimeout`, 60 s by default — raise
  `entryPoints.<name>.transport.respondingTimeouts.readTimeout` (`600s`, say). nginx's
  `client_body_timeout` counts the gap between two reads, so its default of 60 s is fine. The
  API itself gives a request 30 minutes and drops one that sends nothing for 60 s.
- **Content-Security-Policy**: if the proxy adds one, it must allow `blob:` in `img-src` and
  `media-src`. The app shows the files from its own verified local copy through `blob:` URLs.

**What is removed, and when.** A file goes when its owner's stored state has not used it for
`MEDIA_GC_GRACE_DAYS` (checked every hour), after one hour unused when the owner's quota is full,
at once when the owner uses "Reset everything", and with the profile when an admin deletes it.
Nothing is deleted because a state file does not parse or a profile is missing from `db.json`: a
folder whose profile is not in `db.json` is left alone and logged once. A device that still has a
file the server removed uploads it again.

**Privacy.** The app re-encodes photos on the device, so no EXIF or GPS data survives, and blanks
the metadata boxes and the GPS/telemetry tracks of MP4 and MOV videos (a fragmented MP4 that
carries such a track is refused rather than uploaded with it). WebM videos are uploaded as
recorded. The server never decodes or changes a file. Like everything else in `./data`, the files
are not encrypted at rest — whoever can read that folder can see them.

## 6. Backups

Everything is in `./data`:

```bash
tar czf opengym-backup-$(date +%F).tar.gz data/
```

That archive contains all profiles, passkeys and workout history — and, if the activity log is
on, `audit.log` with everyone's sign-in times. Worth knowing before you ship the archive to a
backup service you don't run. Restore by unpacking it back into the project folder. (Individual
users can also export their own data as JSON from Settings.)

The photos and videos of custom exercises are in `data/uploads/`, and they are most of what makes
the archive large. To leave them out:

```bash
tar czf opengym-backup-$(date +%F).tar.gz --exclude=data/uploads data/
```

Restored without them, every profile is intact, and an exercise whose file is gone shows a
placeholder until one of its owner's devices — each keeps its own copy — uploads it again. When
you move openGym to another server, copy the whole `data/`, `uploads/` included; each person can
also carry their own through Settings → *Export with photos & videos* and import it there.

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

Where it works: any desktop browser, Android Chrome, and on iOS only the app **added to the Home
Screen** (Safari in a tab has no Web Push). The Android APK's day reminder is a local
notification. Its rest timer is a local alarm: the notification shade shows the time left as a
shrinking bar, and the end alert still fires with the screen off. The lock screen shows that
notification only when notifications are enabled and the system is set to show them there. A paired account still gets the server push if that alarm
cannot be scheduled. A reminder that was due while the server was down or
restarting is still sent up to 15 minutes late, once; the browser re-registers its subscription
with the server on every signed-in start, so a subscription the server lost heals itself.

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

## Which passkey providers work

openGym asks for a passkey and nothing more specific: no particular kind of device, no platform
authenticator, no attestation, and sign-in lets the browser offer any passkey it can find for
your hostname. So whatever stores passkeys on your device works, and which one you get is
decided by your operating system and browser, not by openGym. The common questions:

**Can I keep my passkey in Bitwarden, 1Password, Proton Pass or another password manager on
Android?** Yes, on Android 14 or later. Switch the app on as a passkey provider in the system
settings (*Passwords, passkeys & accounts*, or *Passwords & accounts*; the name varies by
manufacturer). The system then offers that app when openGym asks to create or use a passkey. If
Chrome keeps offering only Google Password Manager, look under *Autofill services* in Chrome's
own settings for the option to use another service. On Android 13 and earlier, passkeys can only
be stored in Google Password Manager. (#101)

**Firefox on Windows 10 does not offer a QR code to sign in with my phone.** Firefox on Windows
hands passkeys to Windows' own dialog, and the Windows 10 dialog has no *use a phone* option;
Windows 11 added it. On Windows 10, sign in with Chrome or Edge, which show their own QR code, or
keep the passkey in a password manager that has a Firefox extension — or give that PC a passkey
of its own (Windows Hello works in Firefox) with a code from your phone, below. (#103)

**Can one profile have more than one passkey?** Yes. **Settings → Account → Passkeys** lists
them — a name, when each was added and last used — and adds, renames or removes one. Adding one
from there is for anything this browser can reach: another password manager, a security key, or
your phone through the browser's own QR prompt. For a second device that can open openGym itself
(a phone, a work laptop), use **Settings → Account → Add another device**: it shows a code of 12
characters and a QR code of a link that carries it. Scan it with the other device, or type the
code there under **Use a code from your other device** on the sign-in screen; the other device
then creates a passkey of its own and is signed in by it. So a Windows Hello passkey on a PC and
the phone's own passkey can sign in to the same profile, instead of the phone ending up with a
second, empty one. (#95)

Both ways ask you to confirm first — with a passkey the profile already has, or its password
while `PASSWORD_LOGIN=1` — because each adds a lasting way in: a session on its own may be a
copied cookie. Removing a passkey asks for the same, since a copied cookie could otherwise pick
which of your passkeys is left. The code works
once, for ten minutes, and is stored only as a hash; making a new one, signing out everywhere or
changing the password voids it. Wrong codes count toward a per-address pause of code redemption,
like wrong reset codes, and every passkey added or removed and every code made or used is in the
activity log (`auth.passkey.*`, `auth.link.*`).

The last way into a profile cannot be removed: its only passkey stays unless a password can sign
in instead, which counts only while `PASSWORD_LOGIN=1`. Removing a passkey stops it signing in,
but it does not end a session it already opened — sessions are not tied to one passkey. If the
device is lost, remove its passkey *and* use **Sign out everywhere**.

**Where does my passkey live?** Where you created it, and wherever that store syncs: Google
Password Manager to Chrome on your other devices signed in to the same Google account, iCloud
Keychain to your Apple devices, a password manager to every device it runs on. A passkey kept
only on one phone (or on a hardware key) goes with that phone.

**I lost my passkey.** If the profile has another passkey, sign in with that one and remove the
lost one under **Settings → Account → Passkeys**, confirming with the passkey you signed in
with (then **Sign out everywhere**). A browser that is still signed in can give a new device a
passkey with **Add another device** only if the profile also has a password and
`PASSWORD_LOGIN=1`: making the code asks for a passkey or the current password first,
because a session on its own may be a stolen cookie. Otherwise there is no self-service recovery: with `PASSWORD_LOGIN=1` an admin can issue a reset code, and without
it the only way back is a backup (**Settings → Export backup (JSON)**, from any device still
signed in) imported into a new profile. When you ask your admin for help, the id under
**Settings → Account → Account ID** tells them exactly which account is yours. Adding a second
passkey early is what keeps one lost phone from being a lost profile.

The phone app never uses a passkey at all: it pairs with a one-time code from a signed-in
browser (see section 2).

## Troubleshooting

| Symptom | Fix |
|---|---|
| No passkey prompt on my phone | You're on `http://` or an IP, not HTTPS. Set up a domain (section 3). |
| "verification failed" on login | `RP_ID`/`ORIGIN` don't match the URL in the address bar. See the section above — start with what the server logged on startup. |
| Media didn't download | `docker compose logs media`. Re-run `docker compose up -d`, or run `./scripts/fetch-media.sh`. |
| Port 8080 already used | Set `WEB_PORT=9090` in `.env` (and update `ORIGIN` for local testing). |
| A photo or video will not upload ("refused as too large", or it stops partway) | A proxy in front caps the body or cuts the request off: see [Photos and videos](#photos-and-videos-of-custom-exercises) for the body size and timeouts it needs. |
| No "Notifications" option in Settings | Requires a signed-in profile and HTTPS (or `localhost`) — guest mode and plain HTTP over LAN can't subscribe. |
| Day reminder fires at the wrong time | Toggle it off and on in Settings so it re-detects your browser's timezone (also happens automatically on every app load — see section 7). |
| Notifications switch is off although I turned it on | The server no longer holds the subscription (rebuilt `data/db.json`, regenerated `vapid.json`); the app re-registers on the next start, or switch it on again. On iOS, push only works from the Home Screen icon. |
| Want to reset a stuck login | Delete the cookie in your browser; sessions are just signed cookies. |
| The app says "Your server no longer accepts this phone" (or "this browser") | The server answered 401. Usual causes: "sign out everywhere" was used, the account was disabled, `data/secret` was lost or replaced when the stack was moved (every session and pairing dies with it), or a proxy with its own login rejects requests that carry `Authorization: Bearer`. Nothing on the device is lost: pair the phone again (browser: Settings → "Pair the mobile app"), or sign in again in the browser, and what the device kept is merged into the account. |
| The app says the server "answered with something other than openGym (HTTP 200)" | Something other than the API answered `/api/*` with a success page — an auth proxy's sign-in page, or a catch-all route serving `index.html`. Every API answer is JSON; forward `/api/*` to the API unchanged. |
| The app says "Your server answered with an error (HTTP …)" | The code is what the server or its proxy sent: 502/504 usually means the API container is down or unreachable from `web`, 413 that the proxy's upload limit is too small. Changes stay on the device and go through once the server answers. |
| `docker compose pull` fails with "denied" / "unauthorized" | The prebuilt images aren't published yet, or need to be, or the GHCR package is still private — build from source instead (`docker compose up -d --build`). |
| Exercise images/GIFs blank when a routine is open | Fixed in current images (issue #79). On an older build, see the note below. |
| An exercise shows a plain tile instead of its animation when offline | The web app installed on the home screen keeps the media of every exercise in your plan and your current workout, fetched in the background once the app has settled (not on a cellular or Data Saver connection, where the browser says so), plus everything it has shown you, up to 150 MB, across updates. In an ordinary browser tab nothing is fetched ahead: only what it has shown you is kept. An exercise outside your plan that was never shown while online has nothing to show offline. The phone app loads media from a CDN and is not covered by this. |

### `VITE_IMG_BASE` / `VITE_GIF_BASE` are build-time, not run-time

These two are read by Vite when the frontend is **compiled**, so their values are baked into
the shipped JavaScript bundle. Setting them in the `.env` next to `docker compose` has no
effect on an already-built image — the bundle has already made up its mind.

They are only useful if you build the frontend yourself (`docker compose up -d --build`, or a
`npm run build` with the variables exported). If you need to redirect media on a prebuilt
image, do it in your reverse proxy instead.
