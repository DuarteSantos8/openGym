# openGym Next: next development steps (as of 2026-11-15)

Read this first when you resume. Before it: `AGENTS.md` (first-session checklist), `START-HERE.md` (setup and the per-task loop) and `adr/`.

## 1. State

All openGym Next work so far is on `main` (44f837f23). CI is green there: the `Tests` workflow with every job, including `e2e`, passed on its first run on GitHub (run 43719512582, 2026-11-15).

| PR | Content | Status |
|---|---|---|
| #18 | Fork merged onto upstream 1.4.5 | merged |
| #19, #24 | Plan v2, ADRs 0001–0005, NEXT-STEPS, AGENTS.md | merged |
| #20–#23, #25 | EP13, EP09, EP10, EP12 (#25 = all of them, with conflicts resolved) | merged |
| #26, #27 | EP16 (E2E + axe in CI, a11y fixes, rollback, ADR 0007). #27 also restored the add-ons page wiring that the #22 "Update branch" merge had dropped | merged |

Lesson from #22 and #26: pressing "Update branch" can re-resolve a conflict badly, and a PR whose base branch has already been merged goes nowhere. Merge each PR into `main` directly, and keep both sides in `Addons.jsx` / `addons.css` conflicts.

Epic status:
- **Done:** EP09, EP10 (squat), EP12, EP13, EP16-T01/T02/T04.
- **Closed by decision:**
  - EP14-T01: upstream already has local inference (ADR 0007).
  - EP08 and EP11: NO-GO after the spikes.
- **Done (2026-11-15):** emulated devices (WebKit/Chromium phone profiles in CI) and the EP14 real-model run.
- **Needs a person:** EP16-T03 on real phones, translation review.
- **Blocked:** EP15, which needs a named licensed PT reviewer.

## 2. Merging (only the owner merges)

- **Target:** every PR targets `main`.
- **Merge method:** "Create a merge commit", not squash, so each change stays one revert point (`rollback.md`).
- **Before merging:** wait for `Tests / tests-ok` to be green.

## 3. Next tasks, in order

| # | Task | Who | Done when |
|---|---|---|---|
| 1 | ~~Enable Actions; confirm `Tests / tests-ok` (with `e2e`) is green~~ **Done 2026-11-15**: run 43719512582 on `main`, all jobs green | owner | ✅ |
| 2 | **EP16-T03 devices.** **Emulated: done** (WebKit iPhone 13 + Pixel 7 projects in CI, `devices.md`). Still open: real phones, using the checklist in `devices.md` | owner | Real-phone table in `devices.md` filled |
| 3 | ~~EP14 real-model run~~ **Done 2026-11-15**: qwen2.5:7b on the RTX 4070. Test ok, review validated in 8 s, ask in 2.8 s; reasoning quality weak (`devices.md`) | — | ✅ |
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

> Repo: `sorensadrgit-art/openGym`. Read `AGENTS.md`, then `docs/next/NEXT-STEPS.md`. Take the first unfinished task in section 3 that an agent can do. Create a worktree from `main`. Write the tests first. Then run the full suite with `--maxWorkers=8`, the build, `check-bundle-syntax` and `test:e2e`. Open a draft PR on the fork with a body that says what was verified and what wasn't. Follow section 5. Stop and ask before anything irreversible.
