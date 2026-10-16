# Contributing to Gains

Thanks for taking a look. Gains is deliberately small and light on dependencies, and the aim is
to keep it that way: easy to read, easy to self-host.

## Project layout

```
frontend/  React + Vite app (src/views, src/components, src/store, src/lib). Builds to static files.
           android/ and ios/ are the Capacitor shells for the standalone app (docs/MOBILE.md).
api/       Backend: server.js on plain node:http, two dependencies (@simplewebauthn/server, web-push).
           coach/ is the optional AI coach; openapi.yaml documents every route.
web/       Multi-stage Dockerfile (builds the frontend, serves it with nginx) and the nginx template.
mcp/       Optional read-only MCP server for LLM clients (Claude Desktop, Cursor, ...). Not in the
           Docker build; it only runs when a client spawns it. See mcp/README.md.
kubernetes/ Example manifests (docs/SELF_HOSTING_KUBERNETES.md).
docs/      User and operator guides (index: docs/README.md); docs/dev/ has feature design notes.
catalogue/ The exercise catalogue: one JSON file per exercise, translations in i18n/, and the
           licensed 180 px stills and animations in media/ (catalogue/README.md).
```

## Running for development

```bash
cp .env.example .env
docker compose up -d --build      # api + web on :8080

cd frontend && npm install && npm run dev   # hot reload, proxies /api to :3000
cd frontend && npm test                     # training logic, locales, components
cd api && npm test
cd mcp && npm test
```

## Guidelines

- **Keep it dependency-light.** The frontend uses React, React Router and Zustand; `api/` has two
  dependencies. A new dependency on either side is a hard sell.
- **Match the style.** Small components, clear names, comments only where the *why* isn't obvious.
  State lives in the Zustand store (`src/store`), pure helpers in `src/lib`. There is no linter or
  formatter config, so follow the surrounding code.
- **Don't commit** `data/`; it is gitignored. Don't add or replace anything in
  `catalogue/media/`: the stills and animations are licensed from Gym visual, 180 px at most, and
  not open to contributions (see [NOTICE.md](NOTICE.md)).
- **Exercise fixes and translations go through `catalogue/`**, one JSON file per exercise and one
  per language. [catalogue/README.md](catalogue/README.md) explains the fields and how the app is
  built from them; don't edit the generated `frontend/src/lib/exercises-data.js` by hand.
- **Click through what you touched**, including the workout flow, in a browser before opening a
  pull request.
- **Training logic gets a unit test.** Anything that decides what you lift next, or reads a logged
  session back, belongs in a pure helper in `src/lib` with a test beside it. These rules are easy
  to get subtly wrong and nearly impossible to check by clicking; the progression engine has had
  real bugs that only a test caught.
- **New UI strings go into every locale** in `frontend/src/locales/`. English is the source
  language and has no file. `node scripts/check-locales.mjs` (run in CI) flags a key that is
  missing, blank or has lost a `{n}` placeholder. Portuguese (Brazil) inherits from Portuguese
  (Portugal) and has its own guard test.

## Using AI tools

Gains itself is developed with Claude Code (see
[How Gains is built](README.md#how-gains-is-built)), and [`CLAUDE.md`](CLAUDE.md) holds the
project context for it. You're welcome to use whatever tools you like for a pull request. The bar
is the same either way: you understand the change, it's tested, and you can answer questions about
it in review.

## What CI does with your pull request

A pull request runs the frontend, API and MCP test suites, the locale and string checks, the
production build, and builds and boots both api image targets (`.github/workflows/test.yml`). A push
to `main` also publishes `linux/amd64` images to this repository's GitHub Container Registry
(`.github/workflows/publish-ghcr.yml`). Nothing builds an APK for you; if your change needs one to be
judged, say so in the pull request. A first-time contributor's workflows wait for a maintainer to
approve them, so "no checks yet" just means nobody has pressed the button.

## Good first issues

- More starter plans
- Exercise translations: any language in `catalogue/i18n/` with gaps, or a new one
  (see [catalogue/README.md](catalogue/README.md#translating))
- Percentage or training-max programming (5/3/1 style) on top of the progression engine in
  `src/lib/progression.js`; the policy interface is already there
- Accessibility passes on the workout and chart screens

## Where to ask what

| You have | Goes to |
| --- | --- |
| A question, or self-hosting that won't behave | [An issue](https://github.com/steradrian/gains/issues) |
| A reproducible bug | [An issue](https://github.com/steradrian/gains/issues) |
| A change you've already built | [A pull request](https://github.com/steradrian/gains/pulls) |
| A security problem | [Private report](https://github.com/steradrian/gains/security/advisories/new), see [SECURITY.md](SECURITY.md) |

## Reporting bugs

Open an issue with what you did, what you expected, what happened, and your browser and OS. For
login or passkey problems, include your `RP_ID` and `ORIGIN` (not the contents of `data/`); most
login issues are an origin mismatch.

## Contribution terms

Gains has not set contribution terms of its own yet. [CLA.md](CLA.md) is the Contributor License
Agreement of the project Gains was forked from: it grants rights to that project's maintainer, not to
Gains, so it does not apply to a contribution here. Until Gains has terms of its own, open a pull
request only if you are happy for it to be licensed under the [GNU AGPL v3.0](LICENSE) like the rest
of the code.
