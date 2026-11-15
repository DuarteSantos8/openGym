# openGym Next: next development steps (as of 2026-11-14)

Read this first when you resume. Before it: `START-HERE.md` (A1–A7 setup and the per-task loop) and `adr/`.

## 1. State

| PR | Branch | Base | Content | Status |
|---|---|---|---|---|
| #18 | `next/ready-20261114` | upstream 1.4.5 line | Fork merged onto upstream 1.4.5; conflicts resolved | draft, green |
| #19 | `next/docs-plan-adrs-20261114` | #18 | Plan v2, `check_plan.py`, ADR 0001–0005, this file | draft |
| #20 | `next/EP13-T02-coach-nutrition` | #18 | Coach nutrition context (opt-in, aggregates only) | draft, green |
| #21 | `next/EP09-T02-liftoscript-eval` | #18 | Liftoscript evaluator, parity simulator, Progression lab | draft, green |
| #22 | `next/EP10-T03-pose-core` | #18 | MediaPipe pose (bundled model, telemetry stripped), Movement lab, ADR 0006 | draft, green |
| #23 | `next/EP12-anatomy-3d` | #18 | 3D muscle map, Z-Anatomy CC BY-SA, three pinned 0.178.0 | draft, green |

Epic status:
- **Done (draft):** EP09, EP10, EP12, EP13.
- **NO-GO after spike:** EP08 (FitTrackee; existing import covers it) and EP11 (BLE; one gap recorded).
- **Feasible, not built:** EP14 (local inference fits the RTX 4070, 8 GB).
- **Blocked:** EP15, which needs a named licensed PT reviewer.
- **Not started:** EP16.

## 2. Merge order (only you merge)

1. #18 into the fork's main line.
2. #19.
3. Rebase each of #20, #21, #22 and #23 onto the merged #18, one at a time. Run the full suite after each one.
   - Expected trivial conflicts: `views/Addons.jsx` (each epic adds one section) and `addons.css` (EP09 and EP10 both add `.addon-field`; keep one copy).

## 3. Next tasks, in order

| # | Task | Done when |
|---|---|---|
| 1 | **EP12-T05: coloured-levels check.** The seeding script `smoke12c.mjs` wrote nothing: `gym_state_v1` doesn't exist right after "Continue without account". Fix: wait for the key with `page.waitForFunction(() => localStorage.getItem('gym_state_v1'))`, or log one workout through the UI. Exercise ids: squat `3948`, bench `1254`, row `0010`, curl `4437`. Workout shape: `{id, d:'YYYY-MM-DD', entries:[{id, sets:[{w,r,done:true}]}]}`. | Screenshot shows quads/chest/back shaded; the text list shows non-zero levels |
| 2 | **EP16-T01: E2E in CI.** Turn the Playwright smoke tests (guest → `#/addons` → each lab) into `e2e/` specs that run against `vite preview` + API on a temp `DATA_DIR`. Click through the tour overlay with `.evaluate(b => b.click())`. | CI job green; fails if any external request is made |
| 3 | **EP16-T02: accessibility.** Add axe-core to the E2E specs for Addons, Stats and Workout. | 0 serious/critical violations |
| 4 | **EP16-T03: devices.** Run the native builds on one iPhone (iOS 15.5+) and one mid-range Android. Check camera permission (EP10), WebGL context loss (EP12), and battery/heat over 10 minutes. | Matrix recorded in `docs/next/devices.md` |
| 5 | **EP16-T04: rollback.** Each epic must be removable: a feature flag or one revert commit. Write the steps and test one revert. | `docs/next/rollback.md` + one tested revert |
| 6 | **EP14-T01: local coach adapter (opt-in).** Ollama on `127.0.0.1` behind the existing coach interface, off by default, with no fallback to a cloud model. Write an ADR first. | ADR 0007 + adapter tests; 0 requests when off |
| 7 | EP10-T04: second movement (hinge or lunge) plus a phone test. | Rep count within ±1 on 3 recorded clips |
| 8 | EP09-T03: apply a Progression lab rule to a routine. Optional; only if users ask for it. | — |
| 9 | Native-speaker review of the machine-translated strings (cs, da, fa, id, lt, vi + EP13 labels). | Reviewer named in PR |
| 10 | EP15: start only after a licensed PT reviewer is named in writing. | — |

## 4. Environment (WSL2 Ubuntu)

```bash
source ~/.nvm/nvm.sh                     # Node 22
cd ~/dev/og-<epic>/frontend              # one git worktree per branch
npx vitest run --maxWorkers=8            # full suite; default workers flake under CPU load
npm run build                            # also runs stage-mediapipe (prebuild)
npx vitest run scripts/check-bundle-syntax.test.mjs   # Safari 15.5 guard: run before every push
```

- **Smoke tests** run on Windows Playwright with the installed Chrome (`channel: 'chrome'`), because WSL lacks the libs and `sudo` is blocked. Serve with API `PORT=3000 DATA_DIR=$(mktemp -d) node server.js` + `npx vite preview --port 4173 --host 0.0.0.0`.
- **WSL restarts sometimes**, and that clears `/tmp`. Keep logs under `~/dev/.ogtools/`.

## 5. Rules (unchanged)

- **PRs and merging:** draft PRs on the fork only, with `--repo sorensadrgit-art/openGym`; never upstream. Nothing is merged without the owner.
- **Charter:** local-first; no telemetry; no third-party runtime calls (each smoke test asserts 0 external requests); AGPL; respect media licences (Z-Anatomy CC BY-SA attribution stays with the GLB).
- **Before every push:** scan the diff for absolute personal paths, emails and secrets, because the fork is public.
- **Dependencies:** a new one must pass `check-bundle-syntax` (Safari 15.5). If a library uses newer built-ins, pin the last compatible version, as with three 0.178.0, or strip the call with a build plugin that fails loudly, as with `vite-no-mediapipe-telemetry.mjs`.

## 6. Resume prompt for a coding agent

> Repo: `sorensadrgit-art/openGym`. Read `docs/next/START-HERE.md`, then `docs/next/NEXT-STEPS.md`. Take the first unfinished task in section 3. Create a worktree from `next/ready-20261114`. Write the tests first, then run the full suite with `--maxWorkers=8`, the build, and `check-bundle-syntax`. Open a draft PR on the fork with a body that says what was verified and what wasn't. Follow section 5. Stop and ask before anything irreversible.
