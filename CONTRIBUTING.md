# Contributing to openGym

Thanks for taking a look! openGym is intentionally small and dependency-light, and the goal is
to keep it that way — easy to read, easy to self-host.

## Project layout

```
app/    frontend — one static SPA (index.html, app.js, style.css, data.js). No build step.
api/    backend  — server.js (Node, no framework), one dependency (@simplewebauthn/server).
web/    nginx config that serves app/ and proxies /api to the backend.
docs/   self-hosting guide.
```

## Running for development

```bash
cp .env.example .env
docker compose up -d --build
# edit files in app/ (no build needed — just reload) or api/ (docker compose restart api)
```

Frontend changes are plain HTML/CSS/JS — edit and refresh. When you change `app/*.js|css`,
bump the `?v=N` query in `index.html` and `sw.js` so clients and the service worker refetch.

## Guidelines

- **Keep it dependency-light.** New npm packages in `api/` are a hard sell; the frontend has none.
- **No build step for the frontend.** Vanilla JS, please.
- **Match the style.** Small functions, clear names, comments only where the "why" isn't obvious.
- **Don't commit** the exercise media (`app/img`, `app/gif`) or `data/` — they're gitignored.
- **Test the flow** you touched. There's a jsdom smoke test used during development; at minimum,
  click through the affected screens in a browser before opening a PR.

## Good first issues

- Additional starter plans (upper/lower, full-body, 5×5…)
- More languages for the exercise instructions (the dataset ships several)
- Importers from other trackers (Strong, Hevy CSV → openGym JSON)
- Accessibility passes on the workout and chart screens

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, and your browser/OS. If it's
about login/passkeys, include your `RP_ID`/`ORIGIN` (not the `data/` contents) — most login
issues are an origin mismatch.

By contributing you agree your work is licensed under the project's [MIT License](LICENSE).
