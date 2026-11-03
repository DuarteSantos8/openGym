# scripts/

Build and release helpers. Each script explains itself at the top; this page says which one you
want. Run them from the repository root with Node 22 unless noted.

## Run by CI (keep them working)

| Script | What it does |
|---|---|
| `build-api-docs.mjs` | `website/api.html` from `api/openapi.yaml`. `--check` fails when it is stale |
| `build-coach-assets.mjs` | `api/coach/core/library-data.js` and `prompts.js`, the Coach's copy of the catalogue and its prompts. `--check` in CI |
| `build-coach-library.mjs` | Old name of the one above, only forwards to it |
| `catalogue/validate.mjs` | Checks every entry in `catalogue/` (fields, words, ids) |
| `catalogue/build.mjs` | Builds the app's exercise files from `catalogue/`. `--check` fails when they are out of date |
| `catalogue/check-media.mjs` | Fails on any media file over 180 px (the licence) or in a format the app can't show |
| `catalogue/stage-media.mjs` | Copies the stills and animations next to a built app (`npm run build:mobile`, the demo) |
| `ci/fork-mr-pipelines.py` | GitLab mirror only: starts pipelines for merge requests from forks |

## Used when you change something

| Script | When |
|---|---|
| `build-hevy-id-map.mjs` | Regenerates `frontend/src/lib/hevy-id-map.js` after Hevy adds templates (needs a Hevy API key) |
| `de-name-rules.mjs` | The German exercise-name rules. `frontend/src/lib/exercise-names.test.js` holds every German name to them |
| `catalogue/migration-check.mjs` | Before a catalogue change ships: compares old and new catalogue on copies of real profiles |

Frontend-only helpers (locale checks, bundle size, the service worker stamp) live in
`frontend/scripts/`, and the API's in `api/scripts/`.

## Release machine only

These touch the licensed full-size animations, which never go into the repository or CI. They
run on the maintainer's machine against the private media archive.

| Script | What it does |
|---|---|
| `android/build-release.sh` | Builds and signs the APK and the Google Play bundle |
| `android/make-asset-packs.mjs` | Adds the Play asset packs to the Android project for one build, and removes them again |
| `ios/finish-ipa.sh` | Puts the app's animations into the unsigned IPA from CI and signs it for the App Store |
| `media/make-pack-manifests.mjs` | Plans the Apple-hosted animation packs from file names alone |
| `media/build-media.py` | Turns the Gym visual pack into the files openGym ships (ffmpeg only) |
| `media/build-app-webp.py` | The phone apps' animated WebP animations |

## Kept for the record

One-off scripts from building the v1.4.0 exercise database. Nothing calls them any more; they show
how `catalogue/` was put together.

| Script | What it did |
|---|---|
| `catalogue/import-legacy.mjs` | Wrote `catalogue/` from the exercise data up to v1.3.x |
| `catalogue/drafts-from-pack.py` | Listed the Gym visual exercises the catalogue did not have yet |
| `catalogue/import-drafts.mjs` | Folded those drafts into `catalogue/` |
| `catalogue/import-names.mjs` | Folded the name translations into `catalogue/i18n/` |
