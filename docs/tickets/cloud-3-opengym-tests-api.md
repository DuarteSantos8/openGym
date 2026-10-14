# Cloud handoff 3: openGym test reliability and sync-route hardening

Repo: `steradrian/gains` (fork of DuarteSantos8/openGym; React 19 frontend in `frontend/`, Node API in `api/`). Branch: `fix/tests-and-sync-audit` off `main`. One PR into `main`. Stop when the PR is open and CI is green; the owner's main session reviews and merges.

Another agent is reworking the frontend navigation shell on `feat/mode-shell` (App.jsx, TabBar, routes, history, sheets, many views). **Do not touch frontend source except test files and test setup.** Server-side `api/` is yours.

## Context
"Gains" is a private fitness PWA built on this fork. A gateway ("hub") calls `/api/sync/*` with short-lived ES256 hub tokens (`aud=opengym-sync`, `scope=sync`, `jti`) to sync workouts and body weight. Those routes, their replay cache and their audit logging live in `api/`.

## Tasks
1. **Flaky tests:** two `useStore` test files sometimes fail at import under full-suite load (timeout); they pass alone and on rerun. Find the cause (heavy module graph? a shared setup?) and fix it properly. Raising the timeout alone isn't enough unless the slowness turns out to be inherent. To prove it, run the full suite 5 times in a row green and report each exit code.
2. **Coach test helper:** `daysAgo` reads `Date.now()` on every call, so a run that crosses 00:00 UTC can flake. Capture one `NOW` per module, or use fake timers.
3. **Hard-coded dates:** tests with hard-coded dates (`cadence-weekly`, `media-gc`, `e2e-apikey`) break if `MAX_WEEKS` or the window logic changes. Derive the dates from the constants or a fixed fake clock.
4. **Sync audit flooding:** a misconfigured hub can push other entries out of the 5,000-row audit log in about 8 hours. Throttle `sync.token.fail` audit entries harder: aggregate repeats per reason into a single counted entry per window. Add a test that a storm of failures cannot evict non-sync entries.
5. **Pin base images:** pin them in `api/Dockerfile` and `web/Dockerfile` (`node:22-alpine`, `nginx-unprivileged:alpine`) to exact version tags.

## Rules
- Make file changes only with your editor tools, never sed/awk/python/heredocs.
- Run the full test suite, lint and build; report their real exit codes. Do not pipe a command through grep in a way that hides its exit code.
- Changesets, if the repo uses them, are `patch` only. Do not bump versions.
- Commit trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`. Stage specific paths.
- PR body: what caused the flake, each change and its test, and anything you could not verify.
