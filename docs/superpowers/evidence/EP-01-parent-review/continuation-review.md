# Independent review continuation, 2026-11-14

Reviewed feature head: `8dc1a809b678578e282708d8bd3ff12aff75ac85`. Integration head at review: `02697e81` (documentation-only advance). Pi reviewer `thr_nv2up7xmgh` ran using the user-authorized `minimax/MiniMax-M3.1-Flash` model. Execution and the configured model were confirmed. The earlier OpenAI routing/login failure is superseded.

Verdict: **CHANGES REQUESTED**. Existing full-suite and CI passes remain valid evidence for that head, but do not resolve the following defects. Nothing has been merged.

## Parent-reproduced defects

1. The reset inventory can grow within the same reset epoch when a device learns server-only ids. Both server PUT and client merge left newly listed record `b` visible instead of tombstoning it.
2. Repeating an identical partial-stamp PUT changed an untouched field clock from 286 to 495. A third replica's field value 9 then lost to 3. This is a semantic difference, not JSON key ordering.

The parent ran `npm exec --yes --package=node@22 -- node /tmp/ep01-replay-review.mjs` at the reviewed head using Node v22.23.5. Exit 1; all four expected assertions failed. The equivalent preserved script is [replay-reset-review.mjs](replay-reset-review.mjs), runnable from the repository root. [Actual RED observations](replay-reset-red.json) include consistent document clocks (286/495) and server time 500.

## Additional review disposition

- A deliberate add-back requires a negative deletion stamp. Presence or a newer row timestamp cannot safely imply resurrection because tombstoned payloads are retained. The owner will clarify that future import/undo consumers write this stamp, document the clock recipe, and test the negative stamp through client/server/both merge orders while ordinary stale edits remain hidden. No implicit resurrection is authorized.
- An unstamped PUT without a base revision could lose a supplied optional-field edit depending on lexical order (`Apple` to `An apple` lost; `Apple` to `Pear` survived). The owner will stamp optional records after unknown-field preservation for every unstamped non-new-reset PUT, keeping legacy rules unchanged. Note: the reviewer initially attributed legacy replacement to `stampUnstamped`; that helper is actually gated by `overRead` too. The observed legacy scalar result is replacement behavior, not evidence of new legacy stamps.
- The reviewer's initial non-commutativity flag was only object key insertion order and was retracted. Guest-only record import under `prefer` is documented policy. Neither warrants a runtime change.

Corrections are delegated to the original EP-01 owner. Final review and final-head verification remain pending.

## Correction checkpoint

At `ffac4559` (after owner RED `f9aa688c`), the parent re-ran the same four assertions with Node v22.23.5. Exit0, four passed: both reset paths hide the newly learned record, the replay clock remains286, and the third replica retains value9. [Actual GREEN observations](replay-reset-green.json). The parent inspected the mirrored14-insertion/4-deletion runtime correction. Owner full suites and independent recheck remain pending; this is not final acceptance.
