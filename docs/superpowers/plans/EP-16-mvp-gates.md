# EP-16 bounded MVP verification and release-readiness task

Approved scope derives from the owner's resumption request and the MVP in PRODUCT_SPEC.
This task consolidates evidence, verifies the combined candidate and prepares a reviewable
handoff. It does not authorize a protected-branch merge, deployment, native publication,
dependency changes or optional EP-06–15 implementation. The general EP-16 outline remains
unchanged; its repeated RED/GREEN placeholders apply only if a real behavior defect is fixed.
Documentation and recording existing checks do not need artificial failing tests.

## Actual files and responsibilities

- Parent owns `docs/superpowers/progress.md`, this plan, and
  `docs/superpowers/evidence/EP-16/README.md` plus final test logs/manifests.
- Preserve task-owned commit sequences from EP-03/04/05a/05b on the parent working branch.
  Exclude duplicated inherited orchestration docs. Combine locale keys and required shared
  integration changes, resolve only understood conflicts, and inspect the complete diff.
- Review evidence stays under each task's parent-review directory. A fresh Codex whole-branch
  reviewer examines the completed candidate after per-task reviews and combined checks.
- No workflow, deployment or dependency edits are planned. Any reproduced defect returns to
  its accountable author with an outcome-focused RED case, a narrow fix and scoped review.

## Combined acceptance gate

Use Node22.23.5 and existing lockfiles. One heavy job at a time, retained TTY sessions, explicit
exit capture. Do not repeat full suites without a new change, failure or unresolved concern.

Ruling: EP-04 correction-round and EP-05b final full checks are consolidated into this gate.
Authors run covering regressions/build/locales/browser and preserve earlier full-run outcomes;
their handoffs remain conditional until the exact combined runtime passes. This avoids running
the same full frontend/API/MCP acceptance twice while preserving full final coverage. Source
review and targeted defect regressions happen before the expensive combined run.

1. Frontend `npm test -- --maxWorkers=1`. This is also the outstanding EP-03 acceptance gate;
   its previous full timeout remains in evidence even if the combined run passes.
2. API `node --test --test-concurrency=2 test/*.test.js`, then MCP
   `npm test -- --maxWorkers=2`, in their respective directories.
3. Frontend production build; locale check; strict source-string check. Root catalogue,
   coach-assets and API-docs generator checks. Record entry and Nutrition/Stats lazy chunks.
4. Inspect integrated browser behavior with synthetic local accounts: enabled diary lookup
   preview/explicit save; no request on render; offline snapshot/attribution/edit; lookup
   failure/manual fallback; module off keeps data; workout remains usable; Stats volume and
   date ranges remain correct. Reuse documented per-task matrices for unchanged surfaces.
   Block exercise media before AI-visible captures. No further live food-product requests.
5. Verify exact candidate SHA, clean status, diff whitespace, dependency/lockfile delta and
   missing/extra scope. Link all task reviews and failed as well as successful verification.

## Platform gates and honest limits

- Actions dispatch currently fails422 despite enabled permission. Do not change access or
  fabricate a CI pass. Retry only after external state changes; local runs remain separately
  identified. Fork CLA configuration requires repository-owner resolution.
- Docker executable is absent. COPY-manifest and source HTTP tests do not certify image
  build/boot. Staging must build the fork's exact SHA; upstream `latest` images in the existing
  compose file are not this candidate. No privileged daemon installation is part of this task.
- Isolated HTTPS/passkey staging, Docker rollback and physical Android/iOS/Safari validation
  remain unverified without the required environment. No sensors/cameras are added by MVP.
- Existing development/optional dependency advisories remain in the issue ledger; production
  frontend/defaultAPI audit subsets are separately reported. No new dependency is authorized.
- Preserve exercise-media restrictions and source attribution. No licensed media is sent to AI.

## Staging rehearsal required before release

This is a checklist, not an executed result. Use synthetic data and an isolated hostname/data
directory. Record exact fork revision and image IDs/digests for API/default and web; preserve
the prior compatible pair. Keep ORIGIN and RP_ID stable. Start with FOOD_LOOKUP disabled.
Confirm health/config through nginx, register/sign in using passkeys, exercise two-device sync,
food edits/deletes, offline replay and backups. Explicitly enable lookup only after operator
setup; do not consume further live calls during this development run.

Take a stopped-service backup of the complete staging data directory, including session/key
material required by existing backup documentation, into a restricted local destination.
Restore a copy into a fresh isolated stack and verify records, deletion evidence and login.
Rehearse rollback using preserved image IDs and the compatible data snapshot. Do not point an
older binary at the only copy of new data. Record commands, timestamps, checksums and results
without committing credentials or backup contents. Production remains untouched.

## Completion report

Final manifest names the combined commit, task source heads, reviews, draft PR, passing and
failed checks, unresolved findings and release gates. EP-06–15 remain explicitly deferred.
Mark implementation/review complete only where evidence supports it; platform-blocked release
gates remain blocked. Request release authorization only for a concrete verified candidate,
after the remaining external prerequisites have actually been satisfied.
