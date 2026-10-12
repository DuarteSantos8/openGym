# Harry's fork of openGym

Harry's fork of openGym: a self-hosted gym tracker, extended with Anatoly program import and
Health Connect stats, replacing fit-app (`~/Projects/fit-app`). Upstream is
`DuarteSantos8/openGym`; this fork is `hpeppitt/opengym`. Upstream's `CLAUDE.md` above this
import is the architecture record and stays true; this file is what the fork adds.

## Project profile
- type: engineering
- extensions: none
- overlays: none
- run: cd frontend && npm run dev
- check: bash scripts/fork/check.sh
- test: cd frontend && TZ=UTC npm test
- decisions: docs/fork/DECISIONS.md
- docs: docs/fork/

## Layout
Upstream's layout holds (see `CONTRIBUTING.md`). The fork adds:

- `docs/fork/`: this file, `DECISIONS.md`, `ARCHITECTURE.md`, `BACKLOG.md`. Nothing of the fork's
  goes in upstream's `docs/`.
- `scripts/fork/`: the fork's own scripts (`check.sh`). Upstream's `scripts/` is theirs.
- `frontend/android/app/fork.gradle`: the fork's application id, applied from the last line of
  upstream's `build.gradle`.
- New code goes in **new files** (`frontend/src/lib/anatoly-*.js`, `frontend/src/lib/health-read*.js`,
  a new native plugin class) so upstream merges stay clean. Edits to upstream files are kept to
  one-line hooks where possible.

## Commands
```bash
# Toolchain: Node 22 (keg-only brew install, not on PATH by default) and JDK 21 for Android
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
export JAVA_HOME=$(/usr/libexec/java_home -v 21)

cd frontend && npm install && npm run dev        # web app, hot reload
bash scripts/fork/check.sh                        # the gate: frontend + mcp + api tests, locales
bash scripts/fork/build-android.sh                # web build + stage media + cap sync android
bash scripts/fork/build-android.sh --apk          # ... then Gradle assembleRelease (JDK 21)
# then zipalign + apksigner with the fork's keystore, see docs/MOBILE.md "To build and sign your own"
# Do not use `npm run build:mobile` here: it syncs iOS too and fails without Xcode.

git fetch upstream && git merge upstream/main     # take an upstream release (merge, never rebase)
```

## Hard rules
- **Upstream is merged, never rebased.** This fork's history is published and long-lived.
- **Dependency-light is upstream's hard constraint and ours.** React, Router, Zustand on the
  frontend; two deps in `api/`. Capacitor plugins are the only native-side additions.
- **Training logic is a pure helper in `frontend/src/lib` with a test beside it.** Upstream's
  rule; it also matches how fit-app kept its `utils/` pure.
- **The gate runs on Node 22 with `TZ=UTC`.** Node 25 ships a stub `localStorage` global that
  breaks 565 tests; Sydney time breaks 7 date tests upstream wrote against UTC. `check.sh` sets
  both. A failing test under any other Node or TZ is not evidence of anything.
- **No secrets in the repo.** The Gemini key for import goes in the phone's secure storage
  through Settings (the same store the AI Coach's own-key mode uses), never baked at build time.
- **AGPL-3.0-or-later.** Code from this fork must not be copied into fit-app or any non-AGPL repo.
- **Do not edit `frontend/src/lib/exercises-data.js` by hand**; it is generated from `catalogue/`.

## Conventions
- Plain JavaScript, no TypeScript, no linter. Match the surrounding file.
- New UI strings go into every locale in `frontend/src/locales/` (CI runs `check-locales.mjs`).
- Fork task ids are `OG-NNN` in `docs/fork/BACKLOG.md`.
- Commits that touch upstream files say so in the subject (`[upstream]`), so a merge conflict
  later can be traced.

## Living docs
- `docs/fork/DECISIONS.md`: dated, append-only. Anything that changes direction gets an entry.
- `docs/fork/ARCHITECTURE.md`: the seams the fork adds. Update when a boundary moves.
- `docs/fork/BACKLOG.md`: the phased plan and task list.
