# Gains documentation

Pick the part that matches what you're doing. If you just have a question, try the
[FAQ](FAQ.md) first.

## Using the app

| Guide | Read it when |
|---|---|
| [FAQ](FAQ.md) | You have a quick question: iPhone, cost, where your data goes, AI, the exercise media |
| [Phone app](MOBILE.md) | You want to build the Android app or know the iPhone options, or to connect the app to your own server |
| [Importing data](DATA_IMPORTS.md) | You're coming from FitNotes, Strong, Hevy or Apple Health, or sharing a plan with someone |
| [AI coach](AI_COACH.md) | Your instance has the coach switched on and you want to know what it sees and can change |

## Hosting it

| Guide | Read it when |
|---|---|
| [Self-hosting](SELF_HOSTING.md) | You're setting up an instance. Start here: running it, passkeys and HTTPS, users, backups, updates, troubleshooting |
| [HTTPS at home](SELF_HOSTING_HTTPS.md) | You want valid certificates on your LAN without exposing the server to the internet |
| [Kubernetes](SELF_HOSTING_KUBERNETES.md) | You run a cluster instead of Docker Compose |
| [AI coach](AI_COACH.md) | You're deciding whether to turn the coach on, and with which provider |
| [MCP server](../mcp/README.md) | You want Claude Desktop, Cursor or another AI client to read your training history |
| [NixOS](NIX.md) | You run NixOS and want Gains native — flake packages and a NixOS module, no Docker |
| [Security](../SECURITY.md) | You host it for other people, or want to report a vulnerability |

All settings live in `.env`; [`.env.example`](../.env.example) explains each one, and the
[README](../README.md#quick-start) has the full table.

## Working on the code

| Guide | Read it when |
|---|---|
| [Contributing](../CONTRIBUTING.md) | Before your first pull request: setup, guidelines, what CI checks |
| [CLAUDE.md](../CLAUDE.md) | You want the architecture in one page (written for Claude Code, useful for people too) |
| [HTTP API](API.md) | You're touching routes; the OpenAPI spec is the source of truth |
| [Sync: listing profiles](SYNC_USERS.md) | You run the hub next to this instance: `GET /api/sync/users`, its token and why it is separate |
| [Roadmap](../ROADMAP.md) | You want to know what's planned and where your idea fits |
| [Changelog](../CHANGELOG.md) | You want to know what changed in a release |

Design notes for specific features, kept next to the code they describe:

| Note | Covers |
|---|---|
| [Set types](dev/SET_TYPES.md) | Drop sets and rest-pause: the set-row model and how totals are counted |
| [Workout views](dev/LIST_VIEW.md) | The cards, list and compact layouts of the workout screen |
| [Combine routines](dev/COMBINE_ROUTINES.md) | Spec for running more than one routine in a session |

## Still stuck?

Open an [issue](https://github.com/steradrian/gains/issues). If something in these docs was
wrong or missing, that's worth one too.
