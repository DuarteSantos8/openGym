# EP-05b scoped correction review — round 1/5

Date: 2026-11-14. Independent Codex; no agents.
Read-only checkout: /code/openGym-fork/.worktrees/review-ep05b
Review range: 385449e2..762f48a59fa4d03fc4f4e177c0b7d89f8dc11727

**Spec compliance: PASS for the scoped correction.**
**Task quality: PASS for the scoped correction.**
**I1 stale-save finding: RESOLVED.**
**M1 evidence EOF whitespace: PENDING final evidence cleanup and parent final diff check; not a runtime blocker for this verdict.**

No new Critical, Important or Minor finding in this correction range. This is not a full re-review or whole-branch/platform acceptance.

## I1 correction assessment

At frontend/src/components/nutrition/FoodLookup.jsx:74, each accepted preview now retains the request generation that produced it. At :82, Save rejects a preview whose generation differs from generation.current, before setting the submit latch, creating an entry or invoking store update.

The existing clear() at :45 increments the ref synchronously. The store subscription at :49 invokes clear on module, account and capability-status transitions. Therefore an old Save closure cannot become valid merely because eligibility returns to its original values before React commits the queued state changes. Its captured preview generation remains older than the ref. The async result guard at :67, current-owner/module/config check and duplicate-submit latch remain intact.

This is the minimal correction requested by I1: two changed runtime lines, no second lifecycle mechanism, no new persistence field, API request, dependency or sync behavior. Generation is transient preview metadata; creation still forwards only the original bounded source snapshot and fingerprint. There is no asynchronous boundary between the Save guard and the existing synchronous creation/update path.

## Regression and history assessment

frontend/src/components/nutrition/FoodLookup.test.jsx:120 adds three concrete same-batch cases. Each obtains the rendered Save element, changes module/account/config away and back, then clicks that same element within one act callback without yielding between transitions and click. Assertions at :137 require zero entries and removal of the obsolete product. These tests reproduce the original failure window rather than merely testing permanent loss of eligibility.

The existing test at :31 still verifies normal explicit save, synchronous double-submit suppression, and another explicit lookup/save producing a distinct meal ID. The correction does not replace or weaken those assertions.

Verified commit order and inspected actual committed output:

- 96274f47 adds coverage without runtime changes; covering.log reports 169 passed / 13 files.
- 6e02af93 is RED before the runtime correction. review-round1-red.log records 3 failed / 30 passed / 33 total, with all three away/back cases saving one row instead of zero.
- 762f48a5 is GREEN. review-round1-green.log records 172 passed / 13 files, 8.10 seconds.

The author report supplies the Node v22.23.5 environment, exact RED and covering commands, exits and the expanded list of 13 selected files. Counts and durations agree with the committed logs. These are inspected author-run results, not independent suite reruns.

## Additional coverage in 96274f47

Reviewed the added tests in the authorized diff:

- FoodLookup.mobile.test.jsx:11 uses MOBILE=true and no pairing, including stale signed-in/config state, and asserts the server-required message, no lookup form and no request.
- FoodLookup.test.jsx:98 exercises the mL preview and explicit volume serving through Save: two 125 mL servings produce amountMl 250, energyKcal 100 and known protein zero, with no amountG.
- :109 ensures a mismatched serving basis is not offered.
- :114 blocks the previously rendered Save after a lasting account change.
- :140 checks malformed imported source metadata displays the unreadable-source message, creates no anchor/image and leaves the original metadata intact.

These are useful bounded additions and introduce no production behavior beyond the I1 correction. The malformed-source test demonstrates rendering/nonmutation, not a new exhaustive import or backup certification.

## Evidence boundaries and outstanding work

Read docs/superpowers/briefs/EP-05b.md, the previous verdict, the supplied correction package, the real frozen diff/history/source/tests/logs, and the expressly supplied uncommitted author report at /code/openGym-fork/.worktrees/ep-05b-codex/docs/superpowers/evidence/EP-05b/review-round1.md.

That author report records a successful production rebuild and synthetic-provider browser proof: all three stale-Save cases retain before3/after3 rows, followed by a fresh lookup and keyboard Save creating exactly one entry, with zero uncaught errors. I inspected the report; I did not independently rerun or inspect its linked browser/build artifacts. Those claims do not replace the parent's final evidence and combined acceptance review. UI screenshots reportedly predate the nonvisual two-line correction.

M1 remains pending as explicitly directed. The original six EOF cases and newly delivered evidence logs should be covered by the parent's final whole-range git diff --check after cleanup. No whitespace pass is claimed here.

Existing full-suite, generated, browser, bundle and platform gates remain separate and parent-owned. No provider call, test-suite rerun, independent probe, install, build, service, browser, source edit or Git mutation was performed in this round. The source and committed regressions settle the scoped I1 question without another probe. Verified frozen HEAD and clean worktree status. Only this verdict file was written.
