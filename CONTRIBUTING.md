# Contributing to openGym

Thanks for taking a look! openGym is intentionally small and dependency-light, and the goal is
to keep it that way — easy to read, easy to self-host.

## Project layout

```
frontend/  React + Vite app (src/views, src/components, src/store, src/lib). Builds to static files.
api/       backend — server.js (Node, no framework), one dependency (@simplewebauthn/server).
web/       multi-stage Dockerfile (builds frontend → nginx) + nginx.conf (serves app, proxies /api).
media/     exercise img/gif (gitignored, fetched at runtime).
docs/      self-hosting guide.
```

## Running for development

```bash
cp .env.example .env
docker compose up -d --build      # api + web + media on :8080
# frontend hot reload:
cd frontend && npm install && npm run dev
```

## Guidelines

- **Keep it dependency-light.** The frontend uses React + Router + Zustand and nothing else;
  new deps (front or back) are a hard sell. `api/` has exactly one dependency — keep it that way.
- **Match the style.** Small components, clear names, comments only where the "why" isn't obvious.
  State lives in the Zustand store (`src/store`); pure helpers in `src/lib`.
- **Don't commit** the exercise media (`media/`) or `data/` — they're gitignored.
- **Test the flow** you touched — click through the affected screens (and the workout flow) in a
  browser before opening a PR.

## Good first issues

- Additional starter plans (upper/lower, full-body, 5×5…)
- More languages for the exercise instructions (the dataset ships several)
- Importers from other trackers (Strong, Hevy CSV → openGym JSON)
- Accessibility passes on the workout and chart screens

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, and your browser/OS. If it's
about login/passkeys, include your `RP_ID`/`ORIGIN` (not the `data/` contents) — most login
issues are an origin mismatch.

By contributing you agree your work is licensed under the project's [GNU AGPL v3.0](LICENSE).
