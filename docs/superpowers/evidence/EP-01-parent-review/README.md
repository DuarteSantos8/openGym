# EP-01 orchestrator review

Reviewed feature branch: `room/ep-01-data-contracts-and-sync-9djc`. Source checkpoint:
`ffcf68ea` (includes fixes through `142b3e7f`). Environment: Linux, Node v22.23.5,
existing lockfile dependencies, two test workers. Tests ran in a detached checkout of
that checkpoint; the orchestrator then returned to `next/integration`. No source was
changed by the orchestrator and the feature is not merged.

## Findings reproduced and corrected

| Finding at 411aed42 | Concrete reproduction | Corrective evidence |
| --- | --- | --- |
| Preferred account data hidden by guest reset | Account owns `shared`; guest resetIds names `shared`; prefer account produced zero visible records. | RED 775ade9c; correction f7c5603e; actual mergeStates and mirrored-helper regression, both prefer directions. Independent direct assertion passed. |
| Unstamped fields lost | Merge `{id: shared, grams: 100}` and `{id: shared, name: Apple}`: both fields vanished. | RED 775ade9c; correction f7c5603e; both-order union test plus HTTP initial unstamped PUT. Independent direct assertion passed. |
| Stamp-map stack overflow | 150,000 field stamps, 1,688,921-byte JSON record (below 5 MiB API limit), caused RangeError in Math.max spread. | RED dbcc987a; iterative-max correction f7c5603e; helper and actual HTTP tests. Independent direct assertion passed. |

The owner also found and fixed optional reset-id eviction at the legacy 20,000-id cap
(RED 58c84cfd, fix 142b3e7f). The focused suite below includes that regression.

## Independently executed checks

- At 411aed42: five selected frontend files passed 40/40, and HTTP/optional API tests
  passed 24/24. The extra probes above still failed; these test counts alone did not establish acceptance.
- At f7c5603e: five selected frontend files passed 43/43 after the corrections.
- At ffcf68ea: `npm exec --yes --package=node@22 -- node frontend/node_modules/vitest/vitest.mjs run --root frontend --maxWorkers=2 src/lib/sync-optional.test.js src/lib/contracts-fixtures.test.js src/lib/sync-stamps-parity.test.js src/store/useStore.contracts.test.jsx` passed **43 tests / 4 files**, exit 0.
- At ffcf68ea: `npm exec --yes --package=node@22 -- node --test --test-concurrency=2 api/test/contracts-http.test.js api/test/sync-optional.test.js api/test/provider-contract.test.js` passed **33 tests**, exit 0. Full output: [api-focused.txt](api-focused.txt).
- Direct assertions against the three original reproductions passed on ffcf68ea: [probes.json](probes.json).
- Reviewed the full runtime diff (sync helpers on both sides and optIn default), tests,
  record fixtures, DATA_CONTRACTS, module documentation and the scoped file list.
  No dependencies, routes, provider runtime, production data or media changed.

- Browser smoke on ffcf68ea: loaded the synthetic profile saved on the old baseline,
  started another Full Body C session, logged 40 kg × 10 with CDP networking disabled,
  reconnected, finished/saved and reloaded. Both workouts remained (400 kg and 800 kg),
  active=null. [browser-smoke.json](browser-smoke.json). Node 22 API/Vite on localhost;
  exercise media blocked; no screenshots or console/network pass claimed. Test tab and
  servers stopped. This adds a post-change workout check to the earlier baseline smoke.

The scopes/counts above overlap and must not be added together. Full-suite/build results
are separate owner evidence, inspected in the final pushed task report and draft PR:
frontend 7,876 tests/657 files, API 833, MCP 140/6, production build, locale/strict-string,
three generators and diff check all exit 0. Final feature commit `8dc1a809` changes only
evidence documentation after `ffcf68ea`; the reviewed runtime is unchanged.

[Draft PR #5](https://github.com/sorensadrgit-art/openGym/pull/5) independently verified as
open, draft, unmerged, targeting next/integration, head `8dc1a809`. The final GitHub Tests
run [43514211333](https://github.com/sorensadrgit-art/openGym/actions/runs/43514211333)
completed successfully. Frontend, API, MCP, images, report and tests-ok passed; Android
and catalogue were skipped by the workflow filters, not tested by that run.
Connector status snapshot: [ci-final.json](ci-final.json).
The prior run was superseded by the evidence commit; its frontend cancellation is not
represented as a test pass.

## Acceptance status and limits

The three orchestrator findings are resolved in the reviewed code. This is **not final
approval**: the separately assigned Pi reviewer (`thr_bugw47y7kr`) has no OpenAI credentials
and returned no review. No failed login was retried and no substitute provider was assigned.
The user must fix that login in Settings → Agents for that reviewer to run.

Contract caveats were inspected: optional rows remain in storage/backups after logical
delete; every consumer must use visibleOptionalEntries; old deployed binaries do not
acquire these merge hooks; unsafe tombstone compaction is not implemented; future importers
must validate domain values and UUIDs. No optional user feature has been enabled here.
Authenticated multi-device browser/native behavior and staging deployment are not verified
by the guest baseline smoke or by the synthetic HTTP tests.
