<div align="center">

<img src="assets/banner.png" alt="openGym" width="720">

**A self-hosted gym and body-weight tracker you actually own.**

Plan your week, run guided workouts, log every set and your body weight —<br>
on your phone, synced across your devices, behind your own passkey login.

[![Discord](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdiscord.com%2Fapi%2Finvites%2Fe62jY6fwVb%3Fwith_counts%3Dtrue&query=%24.approximate_member_count&suffix=%20members&label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge)](https://discord.gg/e62jY6fwVb)
[![Online](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdiscord.com%2Fapi%2Finvites%2Fe62jY6fwVb%3Fwith_counts%3Dtrue&query=%24.approximate_presence_count&suffix=%20online&label=&logo=discord&logoColor=white&color=3BA55C&style=for-the-badge)](https://discord.gg/e62jY6fwVb)
[![GitHub stars](https://img.shields.io/github/stars/DuarteSantos8/openGym?style=for-the-badge&logo=github&logoColor=white&color=24292f)](https://github.com/DuarteSantos8/openGym/stargazers)

[![Release](https://img.shields.io/github/v/release/DuarteSantos8/openGym?style=flat-square)](https://github.com/DuarteSantos8/openGym/releases)
[![Tests](https://img.shields.io/github/actions/workflow/status/DuarteSantos8/openGym/test.yml?branch=main&label=tests&style=flat-square)](https://github.com/DuarteSantos8/openGym/actions/workflows/test.yml)
[![Pipeline](https://gitlab.com/DuarteSantos8/opengym/badges/main/pipeline.svg?style=flat-square)](https://gitlab.com/DuarteSantos8/opengym/-/pipelines)
[![Coverage](https://gitlab.com/DuarteSantos8/opengym/badges/main/coverage.svg?job=test:frontend&style=flat-square)](https://gitlab.com/DuarteSantos8/opengym/-/pipelines?ref=main)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-a3e635?style=flat-square)](LICENSE)

[Website](https://opengym.duarte-santos.ch) ·
[Live demo](https://opengym.duarte-santos.ch/demo/) ·
[Android APK](https://github.com/DuarteSantos8/openGym/releases/latest) ·
[Self-hosting guide](docs/SELF_HOSTING.md) ·
[Roadmap](ROADMAP.md) ·
[Changelog](CHANGELOG.md)

<a href="https://buymeacoffee.com/duartesantos" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="45" width="163"></a>

</div>

<table align="center">
<tr>
<td align="center"><img src="assets/screenshots/home.png" alt="Home screen" width="230"><br><sub><b>Home</b> · today's workout and weight</sub></td>
<td align="center"><img src="assets/screenshots/workout.png" alt="Workout screen" width="230"><br><sub><b>Guided workout</b> · demos and sets</sub></td>
<td align="center"><img src="assets/screenshots/stats.png" alt="Stats screen" width="230"><br><sub><b>Stats</b> · heatmap, charts and PRs</sub></td>
</tr>
</table>

## Why openGym

Most workout apps keep your data on their servers, push you towards a subscription, or vanish
when the company does. openGym runs on your own box, keeps your data in a folder you control, and
is yours to fork. It still behaves like a modern app: installable on the home screen, passkey
sign-in, works offline, syncs between your phone and your laptop.

No account on someone else's server, no subscription, no ads, no telemetry. One
`docker compose up` and it's running.

The [in-browser demo](https://opengym.duarte-santos.ch/demo/) is the real app with example data,
if you want to try it before installing anything.

## Features

**Planning**

- A routine per weekday over a library of **1,324 exercises** with animated demos, searchable and
  browsable by muscle on a body map. Filter by the equipment you own.
- Four starter plans (Push/Pull/Legs, Upper/Lower, Full Body, 5×5) that load as ordinary,
  editable routines.
- Move a session to another day without touching the weekly plan. The week starts on Monday or
  Sunday, your choice.
- Supersets, warm-up sets, drop sets and rest-pause, timed exercises (planks, hangs, carries),
  cardio by time and speed, rest time per exercise, planned deloads.
- Your own exercises, with your own photo, GIF or short video. Location data is stripped on the
  device before upload.

**Training**

- Guided sessions: today's workout starts itself, weights are pre-filled from last time, a rest
  timer runs between sets, PRs are detected as you go. On a rest day it tells you when the next
  session is.
- A quiet workout screen: one menu per exercise, the set number as the set's own menu, card or
  list view. Switches in Settings bring the old button rows back if you liked them.
- Optional effort column as RIR or RPE, colour-coded, with a plain-language line per level.
- Plate math for barbell, EZ bar, trap bar and Smith machine, worked out from the plates you own.
- Bodyweight exercises know they carry no load: log reps, add a dip belt if you use one.
- Per-side reps for lunges and single-arm work, the screen stays awake while you train, and a
  rest-timer alert can flash the screen for loud gyms.

**Progress**

- Progression rules per routine or per exercise: linear, Greyskull LP, double progression through a
  visible rep range, or adding time. Each target explains why it is that number; missed reps never
  add load, stalls trigger a deload.
- Estimated 1RM per exercise with its own curve, Structural Balance ratios (Poliquin, Thibaudeau,
  ATG), a year-long activity heatmap.
- A muscle map in three modes: where your volume went, what is still recovering, and what has gone
  untrained.
- Body-weight chart against a goal line.
- Edit any saved workout after the fact, log one you did on paper, or move it to the right date.
  Records are re-read from the corrected history.

**Accounts and data**

- Passkeys (Face ID, Touch ID, fingerprint) with per-profile data synced across devices. Password
  sign-in can be switched on per instance; new devices pair with a one-time code or QR.
- Two devices editing at once merge instead of overwriting each other (see [sync](#how-sync-works)).
- Import from FitNotes, Strong, Hevy (CSV or API key) and Apple Health weight exports. Export
  everything as one JSON file whenever you like.
- Share a plan as a small file or print it as a PDF.
- Optional admin dashboard with invite-only signup and an activity log.
- 17 languages, including right-to-left Arabic. Exercise names and instructions are translated
  for most of them.

**Optional extras, off by default**

- An [AI coach](docs/AI_COACH.md) that drafts a week of routines and later suggests changes based on
  what you logged. You approve every change. It runs on your server with your own provider key
  (Anthropic, OpenAI, Gemini or any OpenAI-compatible endpoint, Ollama included).
- An [MCP server](mcp/README.md) so an assistant like Claude Desktop can answer questions about your
  training history. Read-only and local; not part of the Docker build.

The full list of what changed release by release is in the [changelog](CHANGELOG.md).

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) with Compose.

```bash
git clone https://github.com/DuarteSantos8/openGym
cd openGym
cp .env.example .env
docker compose pull      # prebuilt images, amd64 + arm64 (skip this to build from source)
docker compose up -d
```

Open <http://localhost:8080>, tap **Create profile**, and you're in. The first start downloads
the exercise media (about 140 MB) once.

To reach it from your phone with passkeys you need HTTPS on a domain; that's a two-line change in
`.env`. The [self-hosting guide](docs/SELF_HOSTING.md) walks through Cloudflare Tunnel, Caddy,
Traefik and nginx, and there are separate guides for
[HTTPS on a LAN](docs/SELF_HOSTING_HTTPS.md) and [Kubernetes](docs/SELF_HOSTING_KUBERNETES.md).

> [!NOTE]
> Images are published from the same tag to `registry.gitlab.com/duartesantos8/opengym/{api,web}`
> (what `docker-compose.yml` pulls) and `ghcr.io/duartesantos8/opengym-{api,web}`. Swap the
> `image:` lines if you prefer GHCR, or run `docker compose up -d --build` to build locally. Either
> way you don't need Node on the host.

<details>
<summary><b>Configuration reference</b> (all through <code>.env</code>)</summary>

| Variable | What it does | Default |
|---|---|---|
| `RP_ID` | Hostname passkeys are bound to | `localhost` |
| `ORIGIN` | Full URL the app is served from | `http://localhost:8080` |
| `WEB_PORT` | Host port for the web UI | `8080` |
| `NGINX_PORT` | Port the web container listens on inside the container | `80` |
| `BACKEND` | Name of the API service that `/api` is proxied to | `api` |
| `PORT` | Port the API listens on; the web container proxies to the same value | `3000` |
| `RP_NAME` | Name shown in the passkey prompt | `openGym` |
| `SESSION_DAYS` | How long a sign-in lasts, in days | `90` |
| `ADMIN_UIDS` | User ids that get the admin dashboard, comma-separated | *(none)* |
| `INVITE_ONLY` | Require an invite code to create a profile | *(off)* |
| `ALLOW_GUEST` | Offer "Continue without account"; `0` requires a profile | *(on)* |
| `PASSWORD_LOGIN` | Offer name-and-password sign-in next to passkeys | *(off)* |
| `OIDC_ISSUER` | Turns on sign-in through an external identity provider | *(off)* |
| `OIDC_CLIENT_ID` | What that provider knows this instance by | *(none)* |
| `OIDC_CLIENT_SECRET` | The client's secret, if the provider issues one; blank for a public client using PKCE alone | *(none)* |
| `OIDC_REDIRECT_URI` | Where the provider sends the browser back to | `ORIGIN` + `/api/oidc/callback` |
| `OIDC_SCOPES` | Scopes requested at the provider; must include `openid` | `openid profile email` |
| `OIDC_NAME` | Label the sign-in screen shows for the provider | the issuer's hostname |
| `TRUST_PROXY` | Let the sign-in throttle read the client address from proxy headers | `1` in `docker-compose.yml` |
| `AUDIT_LOG` | Record sign-ins and admin actions; `0` records nothing | *(on)* |
| `AUDIT_MAX` | Events kept in the activity log; `0` for no limit | `5000` |
| `AUDIT_DAYS` | Days kept in the activity log; `0` keeps until `AUDIT_MAX` | `90` |
| `AUDIT_IP` | Record the caller's address: `off`, `net` (network only) or `full` | `off` |
| `VAPID_SUBJECT` | Contact URL sent with push notifications | your `ORIGIN` |
| `API_TARGET` | API image to build: `default`, or `coach` with the Claude Agent SDK and Codex CLI | `default` |
| `COACH_DISABLED` | `1` forces the AI coach off instance-wide | *(unset)* |

Push-notification keys are generated on first run into `./data/vapid.json`. `DATA_DIR` is pinned to
`/data` inside the container and mapped to `./data` on the host; change the volume, not the
variable. The [self-hosting guide](docs/SELF_HOSTING.md) covers every option in detail.

</details>

## Phone app

The same codebase builds a standalone app with Capacitor: no account, no server, everything stays
on the phone, with native reminders and a rest countdown in the notification shade.

- **Android:** download the signed APK from the [latest release](https://github.com/DuarteSantos8/openGym/releases/latest)
  or the [website](https://opengym.duarte-santos.ch). Each build sits next to its `.sha256`, and
  the app checks for updates itself. openGym is deliberately not on the Play Store.
- **iPhone:** Apple doesn't allow installs outside the App Store. Self-host and add the PWA to your
  home screen from Safari, or build the native app onto your own device with Xcode.

Details and build instructions: [docs/MOBILE.md](docs/MOBILE.md).

## How it works

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/architecture-dark.png">
  <img src="docs/diagrams/architecture.png" alt="Architecture: the phone talks HTTPS to nginx (web), which serves the app and proxies /api to the Node api; the api stores JSON in ./data. A one-shot media service downloads exercise media on first start; the AI coach and MCP server are optional." width="520">
</picture>
</p>

- **`frontend/`** is React 19 and Vite (React Router, Zustand), built to static files inside Docker.
- **`api/`** is plain `node:http` with four dependencies: `@simplewebauthn/server` for passkeys,
  `jose` for identity-token verification, `undici` for its own outbound HTTP and `web-push` for
  notifications. Everything is stored as JSON under `./data`.
- **`web/`** builds the frontend and serves it with nginx, proxying `/api` so the whole app sits on
  one origin, which passkeys require.

The training logic (progression rules, 1RM, how a logged session is read back) lives in pure
functions under `frontend/src/lib/` with tests beside them. The HTTP API is documented as an
OpenAPI spec in [`api/openapi.yaml`](api/openapi.yaml), browsable at
[opengym.duarte-santos.ch/api.html](https://opengym.duarte-santos.ch/api.html).

### How sync works

Each profile's data is one document with a server revision. A device sends the revision it last
saw along with its changes; if another device wrote in between, the server refuses and returns the
current document so the device can merge and retry.

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/sync-dark.png">
  <img src="docs/diagrams/sync.png" alt="Sync: a device saves with the revision it last saw; if another device wrote in between, the server answers 409 with the current document, the device merges and saves again." width="560">
</picture>
</p>

Nothing that hasn't reached the server is discarded on disconnect or sign-out, and the app shows a
banner whenever it's working offline.

### Your data

Everything lives in `./data` on your host:

| File | Contents |
|---|---|
| `db.json` | Profiles and public passkey data |
| `state-<user>.json` | Each user's plan, workouts, body weight and settings |
| `audit.log` | Admin activity log (no IP addresses unless you turn that on) |
| `secret` | Session-cookie signing key |

Back up `./data` and you've backed up everything. Passkey private keys never reach the server; they
stay in your phone's secure hardware or your password manager.

## Documentation

The [documentation index](docs/README.md) sorts every guide by who it's for. The most used ones:

| I want to | Read |
|---|---|
| Get a quick answer | [FAQ](docs/FAQ.md) |
| Set up my own instance | [Self-hosting](docs/SELF_HOSTING.md) |
| Use the Android or iPhone app | [Phone app](docs/MOBILE.md) |
| Bring my history from another app | [Importing data](docs/DATA_IMPORTS.md) |
| Turn on the AI coach | [AI coach](docs/AI_COACH.md) |
| Contribute code | [Contributing](CONTRIBUTING.md) |
| Report a security problem | [Security](SECURITY.md) |

## Roadmap

A release roughly every two weeks, each small and themed. The full plan is in
[ROADMAP.md](ROADMAP.md), and the issues sit in the
[GitHub milestones](https://github.com/DuarteSantos8/openGym/milestones).

| Release | Planned | Theme |
|---|---|---|
| v1.3.10 | Oct 2026 | Session queue and rotation |
| v1.3.11 | Nov 2026 | Programmes and phases |
| v1.3.12–13 | Nov–Dec 2026 | Progression engine: AMRAP, %1RM, 5/3/1 |
| v1.3.14 | Dec 2026 | Cardio, exercise alternatives, groups |
| v1.4.0 | Jan 2027 | Database storage (the one compatibility break) |
| v1.4.1–3 | Jan–Feb 2027 | Search, OIDC login, trainer role |
| v1.4.4–7 | Mar–Apr 2027 | iOS app, Health Connect, catalogue, skins |

## Community

- **[Discord](https://discord.gg/e62jY6fwVb)** for release announcements, self-hosting help and
  quick back-and-forth. Usually the fastest way to get an answer.
- **[Discussions](https://github.com/DuarteSantos8/openGym/discussions)** for questions and ideas
  you want the next person to find by searching.
- **[Issues](https://github.com/DuarteSantos8/openGym/issues)** for reproducible bugs and agreed-on
  work. Login trouble is almost always an `RP_ID`/`ORIGIN` mismatch; the
  [self-hosting guide](docs/SELF_HOSTING.md) covers it.
- **[Pull requests](https://github.com/DuarteSantos8/openGym/pulls)** are welcome; start with
  [CONTRIBUTING.md](CONTRIBUTING.md).

<a href="https://github.com/DuarteSantos8/openGym/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=DuarteSantos8/openGym&max=60" alt="Contributors">
</a>

### Where the code lives

GitHub is the home of the project. [gitlab.com/DuarteSantos8/opengym](https://gitlab.com/DuarteSantos8/opengym)
is a mirror, updated by a GitHub Actions workflow on every push to `main` and every release tag. It
exists because its CI builds the release artifacts: the signed APK, the multi-arch images and the
SBOMs. Nothing is merged there by hand. In the changelog, `!NN` refers to a GitLab merge request
from the weeks in August and September 2026 when the project lived there.

## How openGym is built

People have asked about this, so plainly: **openGym is developed with
[Claude Code](https://claude.com/claude-code)**, Anthropic's coding agent. A large share of the
code, tests and documentation is drafted in Claude Code sessions, and the repository carries a
[`CLAUDE.md`](CLAUDE.md) with the project context those sessions start from.

What that does and doesn't mean:

- **A person decides and ships.** What goes in, what gets reviewed and merged, and every release
  are the maintainer's call. Changes are tested on a staging instance and on real phones before
  they are tagged.
- **Tests hold the logic in place.** The training logic is covered by unit tests, and pull requests
  run the frontend, API and MCP suites in CI. That is the guard against plausible-looking code
  that is wrong, whoever or whatever wrote it.
- **The app itself doesn't need an LLM.** Nothing in a default install calls an AI service. The AI
  coach and the MCP server are opt-in, and the coach only talks to the provider you configure, with
  your own key.

Community pull requests are written by their authors, with whatever tools they like, and reviewed
the same way.

## Support

openGym is free and stays free: AGPL, no paid tier, nothing held back for sponsors. If it replaced a
paid tracker for you and you'd like to chip in, there's a coffee button below. A star, a bug report
or a pull request helps just as much.

<a href="https://buymeacoffee.com/duartesantos" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217">
</a>

[![Star History Chart](https://api.star-history.com/svg?repos=duartesantos8/opengym&type=Date)](https://star-history.com/#DuarteSantos8/openGym&Date)

## License

**openGym's own code** is licensed under the [GNU AGPL v3.0](LICENSE). You can self-host, use,
modify and share it; if you run a modified version as a network service, you have to offer that
version's source under the same license.

> [!IMPORTANT]
> **The exercise media is not covered by that license.** Exercise metadata and instruction text come
> from [ExerciseDB v1](https://exercisedb.dev/) through
> [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) under MIT. The
> images and animations are third-party content under neither MIT nor the AGPL, and their ownership
> is disputed: the dataset attributes them to [Gym visual](https://gymvisual.com/), while
> [ExerciseDB/AscendAPI](https://exercisedb.io/faq) claims to own them. openGym doesn't redistribute
> them (your instance downloads them on first start) and doesn't relicense them. To reuse that
> media, clear it with the rights holder first.

Full third-party notices, including the body-diagram geometry, are in [NOTICE.md](NOTICE.md).
