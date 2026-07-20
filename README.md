<div align="center">

# 🏋️ openGym

**A self-hosted gym & body-weight tracker you actually own.**

Plan your week, run guided workouts, track every set and your body weight over time —
on your phone, synced across devices, behind your own passkey login. No account on someone
else's server, no subscription, no ads. Just `docker compose up`.

Mobile-first PWA · passkey (Face ID / fingerprint) login · works on iOS & Android · MIT licensed

</div>

---

## Why

Most workout apps lock your data behind a login on their servers, nag you to upgrade, or
disappear when the startup does. openGym is the opposite: **it runs on your box, your data
stays in a folder you control, and it's yours to fork.** It still feels modern — installable
as a home-screen app, passkey sign-in, offline support, sync across your phone and laptop.

## Features

- **Dashboard** — week overview, today's workout, body-weight curve with a goal line, streak & volume tiles
- **Weekly plan** — assign a routine to each weekday, plus a routine editor over a library of **1,324 exercises** (searchable, with animated demos)
- **Reschedule any day** — sick, missed a session, or fewer gym days this week? Move a workout to another day without touching your weekly plan
- **Guided workouts** — it knows what day it is and starts today's session; asks your body weight first, pre-fills your weights from last time, checks off sets, rest timer, PR detection, per-exercise weight tracking that auto-sets your next default
- **Body-weight tracking** — interactive chart with month/kg axes, drag to read any day, set a target weight drawn right through the graph
- **Activity heatmap** — a GitHub-style year view, shaded by time spent training
- **Passkeys, not passwords** — WebAuthn login with Face ID / Touch ID / fingerprint; each profile keeps its own data, synced across devices
- **Themes** — light/dark + 8 accent colors, saved to your profile
- **Yours to keep** — one-tap JSON export/import, guest mode, no telemetry

## Quick start (self-host)

You need [Docker](https://docs.docker.com/get-docker/) with Compose.

```bash
git clone https://github.com/DuarteSantos8/gym-app opengym
cd opengym
cp .env.example .env
docker compose up -d
```

Open **http://localhost:8080**, tap **Create profile**, and you're in. First launch downloads
the exercise media (~140 MB) once; after that it's instant.

> Want it reachable from your phone over the internet with passkeys? You'll need an HTTPS
> domain — it's a two-line change in `.env`. See **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

## How it works

```
┌─────────────┐        ┌──────────────────────────────┐
│  Your phone │──HTTPS─▶│  web  (nginx)                │
│  / laptop   │        │   ├─ serves the app (static) │
└─────────────┘        │   └─ proxies /api ──────────┐│
                       └──────────────────────────────┘│
                                                        ▼
                                        ┌──────────────────────────┐
                                        │  api  (Node + WebAuthn)  │
                                        │   └─ ./data (JSON files) │
                                        └──────────────────────────┘
```

- **frontend/** — the app: **React + Vite** (React Router + Zustand), built to static files inside Docker
- **api/** — the backend: Node with no framework, one dependency (`@simplewebauthn/server`), storing everything as plain JSON files under `./data`
- **web/** — a multi-stage Docker image that builds the frontend and serves it with nginx, proxying `/api` to the backend so everything is on **one origin** (passkeys require this)

You never need Node or a build step locally — `docker compose up` builds the frontend inside the container. It's still small and readable: a component tree you can audit in an afternoon.

## Your data

Lives in `./data` on your host:

- `db.json` — profiles + public passkey credentials
- `state-<user>.json` — each user's plan, workouts, body weight, settings
- `secret` — the key that signs session cookies

**Back up the `./data` folder** and you've backed up everything. Passkey private keys never
touch the server — they stay in your phone's secure hardware / your password manager.

## Configuration

All via `.env` (see `.env.example`):

| Variable   | What it is                                    | Default                 |
|------------|-----------------------------------------------|-------------------------|
| `RP_ID`    | Hostname passkeys are bound to                | `localhost`             |
| `ORIGIN`   | Full URL the app is served from               | `http://localhost:8080` |
| `WEB_PORT` | Host port for the web UI                      | `8080`                  |
| `RP_NAME`  | Name shown in the passkey prompt              | `openGym`               |

## Tech

React + Vite (React Router, Zustand) · Node (no framework) · nginx · Docker Compose · WebAuthn ·
exercise data from [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset).
No database server, no cloud dependencies — the frontend builds inside Docker, so self-hosting
stays a one-command `docker compose up`.

## Development

Frontend (hot reload against a running backend):

```bash
cd frontend
npm install
npm run dev            # Vite dev server on :5173, proxies /api and media to :3000 / :8888
```

Or just run the whole stack in Docker and rebuild on change:

```bash
docker compose up -d --build
```

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues:
more starter plans, exercise-data languages, import from other trackers.

## License

Code: [MIT](LICENSE). Exercise images/GIFs are fetched from the upstream dataset and keep their
own terms — see [NOTICE.md](NOTICE.md).
