# Self-hosting openGym

openGym is two small containers (a web server and an API) plus a folder of your data.
This guide takes you from "just cloned it" to "using it from my phone over the internet".

## 1. Run it locally (5 minutes)

Requirements: [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

```bash
git clone https://github.com/DuarteSantos8/gym-app opengym
cd opengym
cp .env.example .env
docker compose pull   # prebuilt images from ghcr.io (amd64 + arm64) — or skip and build from source
docker compose up -d
```

- First start downloads the exercise images/GIFs (~140 MB) once into `app/img` and `app/gif`.
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

## 3. Expose it over HTTPS on your own domain

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

Anyone who can reach the URL can create their own profile — each gets isolated data. There's no
admin/invite system by design; if you want it private, keep it behind your VPN, an auth proxy
(Authelia, Cloudflare Access…), or just don't share the URL.

## 5. Backups

Everything is in `./data`:

```bash
tar czf opengym-backup-$(date +%F).tar.gz data/
```

That archive contains all profiles, passkeys and workout history. Restore by unpacking it back
into the project folder. (Individual users can also export their own data as JSON from Settings.)

## 6. Notifications

openGym can push two kinds of alert to your phone/desktop, even when the app isn't open:
rest-timer-over, and a reminder on days you have a workout planned but haven't logged one yet.
Turn it on per-profile in **Settings → Notifications** (requires a signed-in passkey profile and
HTTPS — see section 3).

No setup needed server-side: VAPID keys are generated on first run and saved to `./data/vapid.json`.
The one thing worth setting is your timezone, so the day reminder fires at the time you actually
picked rather than UTC:

```bash
# .env
TZ=Europe/Zurich
```

## 7. Updating

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

## Troubleshooting

| Symptom | Fix |
|---|---|
| No passkey prompt on my phone | You're on `http://` or an IP, not HTTPS. Set up a domain (section 3). |
| "verification failed" on login | `RP_ID`/`ORIGIN` don't match the URL in the address bar. Make them exact, restart. |
| Media didn't download | `docker compose logs media`. Re-run `docker compose up -d`, or run `./scripts/fetch-media.sh`. |
| Port 8080 already used | Set `WEB_PORT=9090` in `.env` (and update `ORIGIN` for local testing). |
| No "Notifications" option in Settings | Requires a signed-in profile and HTTPS (or `localhost`) — guest mode and plain HTTP over LAN can't subscribe. |
| Day reminder fires at the wrong time | Set `TZ=Continent/City` in `.env` and restart (see section 6). Defaults to UTC. |
| Want to reset a stuck login | Delete the cookie in your browser; sessions are just signed cookies. |
| `docker compose pull` fails with "denied" / "unauthorized" | The prebuilt images aren't published yet, or need to be, or the GHCR package is still private — build from source instead (`docker compose up -d --build`). |
