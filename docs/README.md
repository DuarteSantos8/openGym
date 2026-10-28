# openGym documentation

Pick the part that matches what you're doing. If you just have a question, try the
[FAQ](FAQ.md) first.

## Using the app

| Guide | Read it when |
|---|---|
| [FAQ](FAQ.md) | You have a quick question: iPhone, cost, where your data goes, AI, the exercise media |
| [Phone app](MOBILE.md) | You want the iPhone app, the Apple Watch or the Android APK, or to connect the app to your own server |
| [Importing data](DATA_IMPORTS.md) | You're coming from FitNotes, Strong, Hevy or Apple Health, sharing a plan with someone, or turning a YouTube follow-along workout into a routine |
| [AI coach](AI_COACH.md) | Your instance has the coach switched on and you want to know what it sees and can change |

The [live demo](https://opengym.ch/demo/) is the real app with example data, nothing
to install.

## Hosting it

| Guide | Read it when |
|---|---|
| [Self-hosting](SELF_HOSTING.md) | You're setting up an instance. Start here: running it, passkeys and HTTPS, users, backups, updates, troubleshooting |
| [HTTPS at home](SELF_HOSTING_HTTPS.md) | You want valid certificates on your LAN without exposing the server to the internet |
| [On a Mac](SELF_HOSTING_MAC.md) | You want to run it on a Mac at home, with Colima instead of Docker Desktop and Tailscale for HTTPS |
| [Kubernetes](SELF_HOSTING_KUBERNETES.md) | You run a cluster instead of Docker Compose |
| [AI coach](AI_COACH.md) | You're deciding whether to turn the coach on, and with which provider |
| [MCP server](../mcp/README.md) | You want Claude Desktop, Cursor or another AI client to read your training history |
| [NixOS](NIX.md) | You run NixOS and want openGym native: flake packages and a NixOS module, no Docker |
| [Security](../SECURITY.md) | You host it for other people, or want to report a vulnerability |

All settings live in `.env`; [`.env.example`](../.env.example) explains each one, and the
[README](../README.md#quick-start) has the full table.

## Working on the code

| Guide | Read it when |
|---|---|
| [Contributing](../CONTRIBUTING.md) | Before your first pull request: setup, guidelines, what CI checks |
| [Architecture](ARCHITECTURE.md) | You want the map: how the app, server, phones and watch fit together, with diagrams |
| [App stores and releases](APP_STORES.md) | You're shipping a release: the APK, Google Play and the App Store |
| [scripts/](../scripts/README.md) | You want to know which build script does what |
| [CLAUDE.md](../CLAUDE.md) | The same project context in the form Claude Code sessions start from |
| [HTTP API](API.md) | You're touching routes; the OpenAPI spec is the source of truth |
| [Roadmap](../ROADMAP.md) | You want to know what's planned and where your idea fits |
| [Changelog](../CHANGELOG.md) | You want to know what changed in a release |

Design notes for specific features, kept next to the code they describe:

| Note | Covers |
|---|---|
| [Set types](dev/SET_TYPES.md) | Drop sets and rest-pause: the set-row model and how totals are counted |
| [Workout views](dev/LIST_VIEW.md) | The cards, list and compact layouts of the workout screen |
| [Combine routines](dev/COMBINE_ROUTINES.md) | Spec for running more than one routine in a session |
| [Fatigue and sets](dev/FATIGUE_SETS_MODEL.md) | How hard sets feed the fatigue map and its recovery time per muscle |

## Still stuck?

Ask on the [Discord](https://discord.gg/e62jY6fwVb) or in
[Discussions](https://github.com/DuarteSantos8/openGym/discussions). If something in these docs was
wrong or missing, that's worth an issue too.
