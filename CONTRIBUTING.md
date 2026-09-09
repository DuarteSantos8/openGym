# Contributing to openGym

Thanks for taking a look! openGym is intentionally small and dependency-light, and the goal is
to keep it that way — easy to read, easy to self-host.

## Project layout

```
frontend/  React + Vite app (src/views, src/components, src/store, src/lib). Builds to static files.
           android/ + ios/ are the Capacitor shells for the standalone mobile app (docs/MOBILE.md).
api/       backend — server.js (Node, no framework), one dependency (@simplewebauthn/server).
web/       multi-stage Dockerfile (builds frontend → nginx) + nginx.conf (serves app, proxies /api).
media/     exercise img/gif (gitignored, fetched at runtime).
docs/      self-hosting guide.
mcp/       optional Model Context Protocol server — read-only stdio bridge for LLM apps
           (Claude Desktop, Cursor, …) to query a user's workouts/1RM/muscle balance. Not in
           the Docker build; only runs when an LLM client spawns it. See mcp/README.md.
```

## Running for development

```bash
cp .env.example .env
docker compose up -d --build      # api + web + media on :8080
# frontend hot reload:
cd frontend && npm install && npm run dev
# training logic (progression rules, 1RM, how a session is read back):
cd frontend && npm test
```

## Guidelines

- **Keep it dependency-light.** The frontend uses React + Router + Zustand and nothing else;
  new deps (front or back) are a hard sell. `api/` has two (`@simplewebauthn/server` for passkeys,
  `web-push` for notifications) — keep it near that.
- **Match the style.** Small components, clear names, comments only where the "why" isn't obvious.
  State lives in the Zustand store (`src/store`); pure helpers in `src/lib`.
- **Don't commit** the exercise media (`media/`) or `data/` — they're gitignored.
- **Test the flow** you touched — click through the affected screens (and the workout flow) in a
  browser before opening a merge request.
- **Training logic gets a unit test.** Anything deciding what you lift next, or reading a logged
  session back, belongs in a pure helper in `src/lib` with tests beside it (`npm test`). These
  rules are easy to get subtly wrong and nearly impossible to verify by clicking — the
  progression engine grew two real bugs that only a test pinned down.

## What CI does with your merge request

Every MR runs the three test suites (frontend, MCP, api), with the results and the coverage
of your diff shown in the MR itself, plus a build of the web image and the api image when you
touched their inputs. The frontend job also prints how much your change adds to the gzipped
bundle compared with main. The APK and the published images are manual jobs there.

One gitlab.com quirk: an MR from a fork runs its pipeline in *your* fork, which usually has
no runners enabled — so it would show "no pipeline" forever. For that reason the project
starts the pipeline on its own runners for you: automatically if you have had an MR merged
here before, otherwise a maintainer presses "Run pipeline" after a first look at the diff
(the MR gets the `ci-approval-needed` label until then). Changes to `.gitlab-ci.yml` or
`scripts/ci/` always go through that manual step.

## Good first issues

- Additional starter plans (upper/lower, full-body, 5×5…)
- More languages for the exercise instructions (the dataset ships several)
- Percentage / training-max programming (5/3/1-style) on top of the progression engine in
  `src/lib/progression.js` — the policy interface is already there
- Accessibility passes on the workout and chart screens

## Where to ask what

| You have | Goes to |
| --- | --- |
| A quick question, or you'd rather just chat | [The Discord](https://discord.gg/e62jY6fwVb) |
| A question, or self-hosting that won't behave | [An issue labelled `question`](https://gitlab.com/DuarteSantos8/opengym/-/issues) |
| An idea you're not sure about yet | [An issue labelled `idea`](https://gitlab.com/DuarteSantos8/opengym/-/issues) |
| A reproducible bug | [Issues](https://gitlab.com/DuarteSantos8/opengym/-/issues) |
| A change you've already built | A merge request |

GitLab has no Discussions, so questions and ideas are issues too — just labelled, so nobody
mistakes a question for agreed-on work. An answered question is worth more than the same answer
in a chat log: the next person searching "passkey login fails behind my reverse proxy" finds it.
That is the one thing the Discord can't do, so if an answer there turns out to be worth keeping,
it belongs in an issue afterwards.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, and your browser/OS. If it's
about login/passkeys, include your `RP_ID`/`ORIGIN` (not the `data/` contents) — most login
issues are an origin mismatch.

By contributing you agree your work is licensed under the project's [GNU AGPL v3.0](LICENSE).
