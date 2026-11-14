# EP-04 parent integration review

Source review at frozen `4d87fc32` found three Important issues and one Minor precision issue:
[independent review](independent-review-round1.md). Final owner evidence and corrections are
pending; this file does not accept the task or its full test suite.

## Findings returned to the owner before final verification

1. **Diary-only guest adoption:** `hasData`, `localExtras` and the actual adoption prompt
   omitted nutrition, so an otherwise empty guest diary could be lost or described as a plan.
   Parent's synthetic fixture probe is preserved in `../codex-resume/README.md`. Owner added
   RED/GREEN for both choices and delayed adoption with newly logged account foods, including
   UUID-based inventory splitting. `localExtras` is client-only, with no API counterpart;
   shared merge/stamp algorithms remain unchanged and parity is still a required check.
2. **Global sheet ownership:** an Add/Edit form could remain open after a synced module-off
   change or account switch. Owner RED `c3333034` / GREEN `19757ab9` adds render/save guards.
   Author reports real two-browser module-off sync dismisses the other open form.
3. **Undated records:** parent ran a small Node22.23.5 probe against pre-fix source using a
   schema2 UUID record with `day: '2026-99-99'`. `diaryDays` grouped it under that invalid day,
   while the view selected only a valid day plus the empty-day group: zero visible rows and
   zero daily unknowns. The record was retained but inaccessible. Owner RED `4387f0d6` /
   GREEN `4d87fc32` validates grouping keys and renders a separate Undated entries surface.
   Stored days are not rewritten; undated rows do not contaminate selected-day totals.

Each correction remains subject to the fresh review by
`cr_child_77c3d2ed9c6aed815fde2af6`. No parent source edits were made.

## Browser evidence inspected while final tests run

Author's `browser-results.json` records real local HTTP with two isolated browser profiles:
offline add/reload/reconnect; held stale PUT causing409 then200; independent protein16/fat11
edits surviving with three unique records; JSON export/reset/deleted import/live restore;
complete workouts with module on/off; module-off dismisses the open sheet; undated rows stay
read-only/deletable with daily totals unchanged. These are author-run observations, not a
parent browser replay. ZIP coverage is from the real-reader integration test, not browser UI.

Parent visually inspected `diary-rtl-200percent-320.png`: Arabic RTL, enlarged text and stacked
summary values are visible without horizontal overflow. The final source includes the rem
grid fix from browser RED `88af0d60` / GREEN `180773ba`. Final browser exception list is empty.
Earlier diagnostics preserve a409 response and stale Tour asset404/aborted requests with an
exception; the final handoff must explain and retain those instead of erasing them.

First full frontend wrapper terminated143 before a result summary; that is not a pass.
Final full verification is pending. Parent has not rerun full suites or touched author services.

## Independent-review correction round1/5

Original author received all findings: retained null elements crash reducers; malformed serving
metadata passes read validation; declining delayed guest adoption into an empty server document
loses post-sign-in foods from the active copy (recoverable in stash). Real-store regression
tests, narrow fixes and scoped re-review are required. The active full run finishes before
source edits, so its tested tree remains identifiable; subsequent source changes justify a
final rerun. That final full FE/API/MCP rerun is consolidated into the parent's combined MVP
gate; author runs covering regressions/build/locales/parity/browser after fixes and reports
full final-head checks as conditional. No correction has yet been accepted.

Minor M1 (nutrition formatting accidentally uses workout weight precision) is assigned as a
separate small correction in the same area, preserving global workout formatting. The missing
mL/serving JSON+ZIP and older-client roundtrip coverage is also assigned to close the evidence gap.
Read-validation ruling: missing legacy provenance remains unknown without invented values;
present creation/provenance metadata must have valid types/formats. Document/test that policy
without silently migrating stored rows. This preserves older data while rejecting malformed
metadata; the independent scoped reviewer must verify it.

Correction RED also exposed `stampOptionalCollections` filtering malformed retained elements
after reducer guards. Parent authorized the smallest mirrored client/API retention correction
with focused parity and API stamping coverage; generic ID merge stays unchanged. The old Tour
test's all-default-on assertion also needs an opt-in-aware expectation, with no Tour runtime
change. Pre-fix full frontend completed exit1:7,962 pass/1 Tour assertion failure. Preserve it;
the final combined gate must pass after the corrections. These are not yet accepted fixes.
