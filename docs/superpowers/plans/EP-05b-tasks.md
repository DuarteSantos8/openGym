# EP-05b confirmed task plan

Assigned worktree `.worktrees/ep-05b-codex`, branch `feat/ep-05b-codex-preview`.
Base `7d9423bd`; preserve inherited merges. Sole Codex implementer, no delegation.
Approved brief `../briefs/EP-05b.md` overrides the older outline/common full-suite rule.

## Confirmed code and file map

- `frontend/src/lib/nutrition/food-source.js` and adjacent test: bounded preview validation,
  strict ASCII GTIN/check digit, canonical source fingerprint using existing sha256 helper,
  g/ml/explicit-serving scaling and stable errors. No transport in domain helpers.
- `lib/nutrition/entry.js` and tests: creation context accepts one `sourceSnapshot`, validates
  and deep-copies it. Existing edit allowlist preserves provenance and snapshot untouched.
  No sync/store algorithm change. `createEntry` remains the UUID allocator, with manual
  creation kind; `update(s => addEntry(s, record))` remains the persistence path.
- `components/nutrition/FoodLookup.jsx` and tests: explicit lookup form through `api()`,
  `useStore.config.foodLookup.status`, configured/unverified wording, local stable failures,
  request generation + owner/module guards. No passive request, camera or retry.
  Show preview, amount and computed totals; explicit Save only. Request invalidation covers
  barcode/day changes, unmount, account/module/config changes and competing requests.
- `components/nutrition/SourceSnapshot.jsx`: validate before offline render, plain text only,
  construct product and licence links from fixed source and validated GTIN. Never imported URLs.
- `components/nutrition/EntrySheet.jsx`: retain module/account guards, preserve sourceSnapshot
  through recent-food creation, show retained attribution offline, block duplicate submit.
- `views/Nutrition.jsx` thin lookup-panel wiring and `components/nutrition/nutrition.css`;
  existing view tests plus new component tests. Keep invalid/undated reads unchanged.
- `lib/__fixtures__/contracts/nutrition-source-entry.json`, nutrition persistence/contract
  tests under `lib/nutrition/` and/or existing `store/useStore.nutrition.test.jsx`: real update,
  atomic field clocks, JSON/ZIP backup reader/import, delete/undo, older-client round trip.
- `frontend/src/locales/*.js`: genuine translations for every added UI string.
- `docs/product/DATA_CONTRACTS.md`: sourceSnapshot shape/bounds/immutability/fingerprint.
- Parent-authorized documentation extension: food sections in `docs/SELF_HOSTING.md`,
  `docs/INTEGRATIONS.md` and `.env.example` comments. Describe explicit preview versus saved
  snapshot, offline manual entry/attribution and service recreation after env changes.
- Evidence and reproducible synthetic browser transport under `../evidence/EP-05b/`.
  No progress.md, API runtime, dependencies, lockfiles or generated catalogue edits.

## Producer interfaces verified

`createEntry(input, context)` accepts label/day/meal, amount and g/mL/serving input, optional
entry-total nutrients. `servingAmount` bounds 0..1,000,000 with three-place rounding and
positive explicit serving size. Saved mL field is `amountMl`; API basis is `ml`.
`editEntry` preserves unknown fields; EntrySheet owner/module guards run on render and Save.
`api()` supports server subpaths/mobile pairing, owns its timeout signal; HTTP error code is
`error.data.code`, transport code is `error.code`. Use generations, not a transport rewrite.
`remoteAuth()` plus MOBILE distinguishes standalone. Configuration alone proves no reachability.

One atomic sourceSnapshot contains source/externalId/label, optional brand/quantityText,
per100 basis and optional nutrients/energyConversion, optional explicit serving, fetchedAt,
attribution text/product URL/licence/licence URL. Copy only bounded named fields; never raw
payloads/images. Validate labels 160, brand120, quantity80, serving label160, attribution200;
numeric source bounds match producer (kcal900/1800, macros100/200 by g/ml; serving <=10000).
Canonical hash covers these source values except fetchedAt, excludes all editable meal data,
and uses stable field order. URL fields are constructed, never trusted when rendering.

## RED/GREEN milestones and arithmetic

1. Commit this plan before source changes and tell parent the hash/file map.
2. RED/GREEN domain + atomic creation/persistence: g fixture per100 kcal200/protein8/fat0,
   carbohydrate absent; 25g =>50kcal/2g/0g with carbohydrate still absent. Serving30g x2
   =>60g/120kcal/4.8g. ml fixture per100 kcal40/protein0, serving125ml x2 =>250mL/100kcal.
   Mismatched serving basis never offered; no density inferred from package quantity.
   Cover malformed/null/string/negative/infinite/overflow numbers, zero, fingerprint stability,
   deep copy, immutable edits/reuse, distinct UUIDs and backup/sync field retention.
3. RED/GREEN UI: no lookup until click, unavailable states, all stable error categories,
   stale owner/module/day/navigation/barcode responses, explicit save and double submission,
   offline attribution and hostile imported URLs. Keep manual diary regression tests green.
4. Covering regressions at <=2 workers, locale/source strict checks, relevant generators,
   one production build with entry/lazy chunk deltas versus producer and EP-00 baseline.
   Parent owns the single final full frontend (one worker), API and MCP gate.
5. Browser with own API33105/Vite5178/Chromium9325, throwaway DATA_DIR/profile. Read
   browser-harness skill; block exercise-media before captures. Synthetic OFF responses only
   at HTTPS transport boundary; real route/auth/module/normalization. 320/390/1280 dark/light,
   keyboard/reduced motion, no passive calls, lookup/preview/explicit save, offline reopen/edit,
   failure/manual fallback. Record failures honestly; stop only owned PIDs.
6. Notify stable runtime for parent independent review, address findings with tests. Final
   handoff evidence records exact commits/commands/counts/exits/screenshots/bundle/limitations.
   Inspect diff; first push preceded by `git pull --no-rebase origin next/integration`;
   later pushes pull assigned published branch, normal merges only. Draft PR to integration.

## Environment

Node v22.23.5 at `/home/cloudroom-agent/tools/node-v22.23.5-linux-x64/bin`.
Reuse parent node_modules only after matching all four lockfiles and verifying installed tools.
Load/disk checked: load0.60, available memory25GB (host report), disk281GB free.
Parent confirms all producer services stopped and grants this implementation the heavy-work
window until stable-runtime handoff. No provider requests (budget exhausted), external
credentials, protected branch push/merge, deployment or new permissions.
