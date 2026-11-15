# openGym Next: next development steps (as of 2026-11-15)

Read this first when you resume. Before it: `AGENTS.md` (first-session checklist), `START-HERE.md` (setup and the per-task loop) and `adr/`.

## 1. State

| PR | Branch | Base | Content | Status |
|---|---|---|---|---|
| #18 | `next/ready-20261114` | main | Fork merged onto upstream 1.4.5 | **merged** |
| #19 | `next/docs-plan-adrs-20261114` | ready | Plan v2, ADRs 0001–0005 | merged into `ready` only (never reached main) |
| #20–#23 | EP13, EP09, EP10, EP12 | main | One epic each | draft, superseded by #25 |
| #24 | `next/docs-plan-adrs-20261114` | main | All docs to main | draft, contained in #25 |
| **#25** | `next/integration-20261115` | main | docs + EP13 + EP09 + EP10 + EP12, conflicts resolved | **draft, fully verified, merge this** |
| **#26** | `next/EP16-e2e-a11y` | #25 | E2E + axe in CI, a11y fixes, rollback, ADR 0007, this file | **draft, verified** |

Epic status:
- **Done (draft):** EP09, EP10 (squat), EP12, EP13, EP16-T01/T02/T04.
- **Closed by decision:**
  - EP14-T01: upstream already has local inference (ADR 0007).
  - EP08 and EP11: NO-GO after the spikes.
- **Needs a person:** EP16-T03 (devices), the EP14 real-model run, translation review.
- **Blocked:** EP15, which needs a named licensed PT reviewer.

## 2. Merge (only you merge)

1. **#25 with "Create a merge commit"**, not squash. That keeps one revert point per epic (`rollback.md`). GitHub then marks #20–#24 as merged.
2. **#26**: change its base to `main` after #25 merges (`gh pr edit 26 --base main`), then merge.
3. **Turn on GitHub Actions for the fork** (repo → Actions → enable). No check has run on any fork PR ("no checks reported"); until then, the local runs in each PR body are the only evidence.

## 3. Next tasks, in order

| # | Task | Who | Done when |
|---|---|---|---|
| 1 | Enable Actions; confirm `Tests / tests-ok` (now including `e2e`) is green on #26 | owner | Green run linked in #26 |
| 2 | **EP16-T03 devices:** native builds on one iPhone (iOS 15.5+) and one mid-range Android. Check camera permission and squat count (EP10), 3D map open/turn/close and WebGL context loss (EP12), battery and heat over 10 minutes. | owner + agent | Matrix in `docs/next/devices.md` |
| 3 | **EP14 real-model run:** Ollama + a 7–8B Q4 model, coach provider "OpenAI-compatible endpoint" at `127.0.0.1:11434/v1`, nothing else configured (ADR 0007) | owner | Model, latency and whether the plan validated, recorded in `devices.md` |
| 4 | **EP10-T04 second movement** (hinge or lunge). Record 3 short clips on a phone first, then tune thresholds against them. | agent, after clips exist | Rep count within ±1 on the 3 clips |
| 5 | Report the upstream a11y baseline (`a11y.md`: label-in-name on /home, /plan, /stats) to DuarteSantos8/openGym. Drop each baseline entry once fixed upstream. | owner | Upstream issue linked in `a11y.md` |
| 6 | Manual a11y: VoiceOver/TalkBack, 200 % text, keyboard through the 3D map list | owner | Notes in `a11y.md` |
| 7 | Native-speaker review of the machine-translated strings (cs, da, fa, id, lt, vi + EP13 labels) | reviewer | Reviewer named in a PR |
| 8 | EP09-T03 (apply a progression rule to a routine). Only if users ask for it. | — | — |
| 9 | EP15: start only after a licensed PT reviewer is named in writing | — | — |

## 4. Environment (WSL2 Ubuntu)

```bash
source ~/.nvm/nvm.sh                     # Node 22 locally; CI uses Node 26
cd ~/dev/og-<name>/frontend              # one git worktree per branch
npx vitest run --maxWorkers=8            # full suite; default workers flake under CPU load
npm run build                            # also stages MediaPipe (prebuild)
npx vitest run scripts/check-bundle-syntax.test.mjs   # Safari 15.5 guard: run before every push
npm run test:e2e                         # Playwright + axe; starts API and preview itself (needs a build)
```

- **E2E in WSL:** WSL can't run browsers (missing libs, no `sudo`). Run the E2E specs from Windows against servers started in WSL:
  ```
  E2E_BASE_URL=http://localhost:4173 E2E_CHANNEL=chrome npx playwright test
  ```
- **Seeding a guest:** a guest's state is only written on its first change. `e2e/fixtures.mjs` → `enterAsGuest(page, workouts)` handles that.
- **WSL restarts sometimes**, and that clears `/tmp`. Keep logs under `~/dev/.ogtools/`.

## 5. Rules (unchanged)

- **PRs and merging:** draft PRs on the fork only, with `--repo sorensadrgit-art/openGym`; never upstream. Nothing is merged without the owner.
- **Charter:** local-first; no telemetry; no third-party runtime calls (every E2E test fails on an external request); AGPL; respect media licences.
- **Before every push:** scan the diff for absolute personal paths, emails and secrets, because the fork is public.
- **Dependencies:** a new one must pass `check-bundle-syntax` (Safari 15.5). Pin the last compatible version (three 0.178.0) or strip the call with a build plugin that fails loudly.
- **Accessibility:** never add an a11y baseline entry for a screen this fork changed. Fix it instead.

## 6. Resume prompt for a coding agent

> Repo: `sorensadrgit-art/openGym`. Read `AGENTS.md`, then `docs/next/NEXT-STEPS.md`. Take the first unfinished task in section 3 that an agent can do. Create a worktree from `main` (or from `next/integration-20261115` if #25 isn't merged yet). Write the tests first. Then run the full suite with `--maxWorkers=8`, the build, `check-bundle-syntax` and `test:e2e`. Open a draft PR on the fork with a body that says what was verified and what wasn't. Follow section 5. Stop and ask before anything irreversible.
