# MVP combined acceptance record

Status: **in progress, not release approval**. Parent working branch:
`room/autonomous-project-resumption-orchestrat-djus`. The full acceptance commands below
will run only after the final EP-05b source review. No final combined pass is claimed yet.
The bounded scope and staging checklist are in [EP-16-mvp-gates](../../plans/EP-16-mvp-gates.md).

## Source lineage and reviews

| Delivery | Reviewed source | Parent integration | Review and evidence |
| --- | --- | --- | --- |
| EP-03 volume plus assistance corrections | final6434f47c, runtime7a0d9f4c | Original PR9 merged externally; correctionf6e9dafb..1940ebdf | [Final scoped PASS](../EP-03-parent-review/independent-fix2-review.md);414 focused tests; browser; earlier failure preserved |
| EP-04 diary and adoption/validation corrections | finalddcd1be5, runtime0ac5cbc8 (identical to reviewedfe22da11) | faede047..7d9423bd,50 source/test/contract paths identical | [Scoped PASS](../EP-04-parent-review/independent-fix1-review.md);218 focused frontend/47API; browser/backup evidence |
| EP-05a server lookup | finalc976b963, runtime176b1698 | Original task cherry-picks then external PR11 merge470defb7 | [Independent PASS](../EP-05-parent-review/independent-review.md); FE7917/API911/MCP140; three live requests exhausted |
| EP-05b preview and saved source snapshot | Implementation in progress | Pending | Focused/source/browser review pending final delivery |

Original task/review failures are retained, not turned into passes by later focused checks.
EP-03 full frontend had7,952 pass/1 timeout, with isolated31/31. EP-04 pre-correction full
frontend had7,962 pass/1 obsolete default-preset assertion, subsequently corrected. Both
tasks' final full acceptance is consolidated into the exact combined runtime gate.

## Combined checks to record

Environment: Linux; Node22.23.5; existing lockfiles; one heavy job at a time. Final runtime SHA,
start/end/exit and counts will be recorded with each command. Long jobs use retained TTY
sessions; interrupted output cannot be labelled passing.

| Check | Result | Evidence |
| --- | --- | --- |
| frontend `npm test -- --maxWorkers=1` | PENDING | Not run on final combined runtime |
| API `node --test --test-concurrency=2 test/*.test.js` | PENDING | Not run on final combined runtime |
| MCP `npm test -- --maxWorkers=2` | PENDING | Not run on final combined runtime |
| Production build, entry/lazy bundle sizes | PENDING | Final build after integration |
| Locale and strict source-string checks | PENDING | Final19-pack check |
| Catalogue, coach-assets and API-docs generators | PENDING | Final generated-source parity |
| Combined browser paths | PENDING | Synthetic data, media blocked, no live provider calls |
| Final whole-branch independent review | PENDING | After task reviews and combined checks |

The UI author owns focused tests/browser/build during implementation. Parent will run the full
combined gate once; no duplicate task full run is requested. If a real failure requires a code
correction, retain the failed run and rerun the affected gate on corrected source.

## Release limits retained

- **CI unavailable:** last dispatch returned422, and the new draft correction PR had no check
  runs. Queued unrelated dynamic jobs are not test passes. No Actions permissions were changed.
- **Docker/staging unverified:** no Docker executable, no image build/boot, isolated HTTPS
  passkey deployment or rollback rehearsal. Source-server HTTP and COPY-manifest tests are
  separate evidence. Existing compose upstream-latest images are not this fork candidate.
- **Device/accessibility limits:** desktop Chromium coverage does not certify physical
  Android/iOS/Safari, all locales, screen readers or cold-start offline behavior. Existing shared
  picker focus limitations and earlier EP-02 motion-measurement limits remain documented.
- **Security baseline:** existing development/optional dependency advisories remain in
  [the resumption audit](../codex-resume/README.md). Frontend production and defaultAPI
  nonoptional audit subsets had zero advisories; this is not an all-target security approval.
  The server author's install log also reports existing watch-zepp high/critical findings;
  that optional watch dependency tree has not been remediated or certified by this MVP work.
- **Owner/operator gates:** fork CLA configuration unresolved; OFF operator usage setup is
  documented, not completed on the owner's behalf. No provider request beyond the authorized
  three was made. No protected-branch merge, public deployment or native release was performed
  by this coordinator or its children. PR9/11 were externally merged while work continued.
- **Scope:** EP-00–05 and this bounded evidence task comprise MVP work. EP-06–15 remain
  deferred optional designs, not silently implemented or declared complete.

No production data, credentials, licensed exercise media or raw browser session cookies belong
in these artifacts. All browser records are synthetic; the final lookup UI uses a local
synthetic HTTPS boundary for provider responses while retaining real route/auth/normalization.
