# AGENTS.md: start here (any coding agent, first session)

This fork (`sorensadrgit-art/openGym`) is building **openGym Next** on top of upstream openGym.
If this is your first time in the project, do the steps below in order before you write any code.

## 1. Read, in this order

| # | File | Why |
|---|---|---|
| 1 | `docs/next/NEXT-STEPS.md` | Current state (PR map), merge order, **the next task to take** |
| 2 | `docs/next/START-HERE.md` | Setup (A1–A3), the per-task loop (A4), coder/reviewer prompts |
| 3 | `CLAUDE.md` | Upstream architecture, layout, conventions, test commands |
| 4 | `docs/next/adr/` | Decisions already made (MediaPipe, base branch, …): don't reopen them without cause |
| 4b | `docs/next/BEGINNER-CLOUD-PLAN.md` | The beginner-first and Cloud edition plan (EP17–EP27): what is done, what is open, in order |
| 5 | The epic's own files named in the task | Only what the task touches |

## 2. Where the code is

- **GitHub:** `sorensadrgit-art/openGym` (fork). Upstream is `DuarteSantos8/openGym`: read-only for you.
- **Base branch:** `main`. Every openGym Next PR so far (#18–#27) is merged, and CI (`Tests`, including `e2e`) is green on it.
- **Local (WSL2 Ubuntu):** one git worktree per branch under `~/dev/og-<name>`; helper scripts in `~/dev/.ogtools/`.
- **Node:** run `source ~/.nvm/nvm.sh` first (Node 22).

## 3. First-session checklist

1. `git fetch origin`, then `gh pr list --repo sorensadrgit-art/openGym --state open` to confirm the PR map in NEXT-STEPS.md is current.
2. Take the **first unfinished task** in `NEXT-STEPS.md` §3. Don't pick your own.
3. Create a worktree from the base: `git worktree add ~/dev/og-<task> -b next/<EPxx-Tyy-slug> origin/main`.
4. Install dependencies, then confirm you have a green baseline before changing anything: `cd frontend && npx vitest run --maxWorkers=8`.
5. Work the loop from START-HERE.md A4:
   1. Write tests first, then the code.
   2. Run the full suite, `npm run build`, and `npx vitest run scripts/check-bundle-syntax.test.mjs`.
   3. For UI changes, run `npm run test:e2e`: Playwright and axe, failing on any external request (see NEXT-STEPS §4 for running it from Windows).
6. Scan the diff for personal paths, emails and secrets (the fork is public), then push and open a **draft** PR:
   `gh pr create --draft --repo sorensadrgit-art/openGym --base <base> --head <branch>`.
   In the PR body, list what was verified and what was **not**.
7. In the same PR, update `docs/next/NEXT-STEPS.md`: mark the task done and note anything the next agent needs.

## 4. Hard rules

- **PRs and merging:** draft PRs on the fork only, always with `--repo sorensadrgit-art/openGym`; never touch upstream. Never merge; the owner merges.
- **Charter:** local-first; **no telemetry**; no third-party runtime calls; AGPL-3.0; keep media licences and attributions (e.g. `frontend/public/anatomy/ATTRIBUTION.md`).
  - **One approved exception (ADR 0008):** the Cloud edition, built only with `VITE_EDITION=cloud`, may call Supabase and Stripe. The default build, every self-hosted server and every default E2E test keep "no third-party runtime calls" exactly as written. Cloud code lives under `frontend/src/lib/cloud/` and `supabase/`, and is never imported statically from anywhere else.
  - **Exercise media and money (ADR 0009):** nothing under `catalogue/media/` goes into a build that takes payment, and none of it is ever given to a model.
  - **Health content (ADR 0012):** general education for healthy adults, with sources; no diagnosis, no rehab advice.
- **iOS target is Safari 15.5.** If a dependency trips `check-bundle-syntax`, pin the last compatible version or strip the call with a build plugin that fails loudly. Never weaken the checker.
- **Environment:** `sudo` is not available, so don't work around it. Browser smoke tests run on Windows Playwright with the installed Chrome.
- **Irreversible actions:** stop and ask before anything irreversible (force-push, deleting branches or data, licence changes).

## 5. Known gotchas

- **Flaky frontend tests** under the default worker count come from CPU contention. Use `--maxWorkers=8`.
- **WSL restarts sometimes**, and that clears `/tmp`. Keep logs in `~/dev/.ogtools/`.
- **Browser smoke tests:**
  - The app uses hash routes (`#/addons`).
  - A guest starts with "Continue without account".
  - The onboarding tour overlay blocks pointer clicks, so click with `el.evaluate(b => b.click())`.
- **Locales:** pt-BR strings belong in `PT_BR_OVERRIDES`, not appended to the default export.
