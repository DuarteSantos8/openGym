# EP-05b correction round 1

Frozen corrected runtime: **762f48a59fa4d03fc4f4e177c0b7d89f8dc11727**.
Original reviewed runtime: `385449e22d16cc76fee547d0df862ea1f0974b62`.
Separate additional coverage commit: `96274f47`. RED: `6e02af93`. GREEN: `762f48a5`.
No runtime changes after the GREEN commit. Independent scoped correction spec/quality review
passed; see `independent-review-round1.md`. The parent's single combined full gate remains
a separate acceptance requirement.

## Finding and fix

The reviewer reproduced an old rendered Save creating an entry after a synchronous module
off/on, account one/two/one, or configured/disabled/configured transition. Subscription-based
`clear()` incremented the request generation immediately, but the event handler still held
the old React preview until rerender. Checking the final account/module/config was insufficient.

The two-line runtime correction records the request generation on the preview and requires
`preview.generation === generation.current` at Save. This is a synchronous validity check;
no new state, sync, API or persistence mechanism was added.

## Exact RED command

Working directory `/code/openGym-fork/.worktrees/ep-05b-codex/frontend`, Linux, Node22.23.5:

```sh
export PATH=/home/cloudroom-agent/tools/node-v22.23.5-linux-x64/bin:$PATH
npx vitest run src/components/nutrition/FoodLookup.test.jsx --maxWorkers=2
```

Exit **1**, **3 failed / 30 passed / 33 total**, one file. All three new same-batch cases
failed with `expected [ { …(19) } ] to have a length of +0 but got 1`.
Exact output: [review-round1-red.log](review-round1-red.log). Committed before runtime fix.

## Exact covering GREEN command

Same working directory and Node:

```sh
export PATH=/home/cloudroom-agent/tools/node-v22.23.5-linux-x64/bin:$PATH
npx vitest run src/components/nutrition src/views/Nutrition.test.jsx src/lib/nutrition src/store/useStore.nutrition.test.jsx src/lib/contracts-fixtures.test.js src/lib/sync-stamps-parity.test.js src/lib/pt-br-locale.test.js --maxWorkers=2
```

Exit **0**, **172 passed / 13 files**, 8.10s.
Exact output: [review-round1-green.log](review-round1-green.log).
This directory selection expands to exactly these files:

1. `src/components/nutrition/EntrySheet.source.test.jsx`
2. `src/components/nutrition/FoodLookup.mobile.test.jsx`
3. `src/components/nutrition/FoodLookup.test.jsx`
4. `src/views/Nutrition.test.jsx`
5. `src/lib/nutrition/diary.test.js`
6. `src/lib/nutrition/entry.test.js`
7. `src/lib/nutrition/food-source.test.js`
8. `src/lib/nutrition/format.test.js`
9. `src/lib/nutrition/source-creation.test.js`
10. `src/store/useStore.nutrition.test.jsx`
11. `src/lib/contracts-fixtures.test.js`
12. `src/lib/sync-stamps-parity.test.js`
13. `src/lib/pt-br-locale.test.js`

These cover the new race, normal explicit saves, earlier request invalidation, diary owner
guards, source arithmetic/immutability, standalone/mobile gating, real store persistence,
JSON/ZIP reader/import, atomic stamps, merge parity and locale inheritance. No full suite ran.

## Rebuild and narrow browser proof

`RAYON_NUM_THREADS=2 npm run build` in frontend: **exit0**, 2.09s;
[review-round1-build.log](review-round1-build.log). Existing chunk-size and ineffective dynamic
import warnings remain. No build errors.

Reloaded the production preview at localhost5178, using real API33105 auth/module/normalization
with the documented synthetic HTTPS preload. Imported the actual built useStore chunk in the
browser and found its exported store function by `getState`/`setState`. For each of the three
cases, obtained a real preview via the UI, retained its actual Save DOM element, mutated the
store away and back synchronously in one JavaScript task, then called that old element's
`click()`. **Before3 / after3 rows in every case**. A subsequent fresh lookup and keyboard Save
created **exactly one** entry. Zero uncaught errors. See
`review_round1_production_probe` and `review_round1_fresh_save` in
[browser-results.json](browser-results.json). These are synthetic-provider checks, not live OFF.

The API, Vite preview, Chromium and named browser-harness daemon are stopped. Owned tab closed;
ports33105/5178/9325 verified closed. Own throwaway DATA_DIR/cookie/profile removed. Heavy
window returned to parent. UI screenshots predate the two-line fix; visual runtime is unchanged.
