# EP-03 parent review

Independent review supersedes the initial parent probe's limited finding-free result:
[initial I1](independent-review-round1.md), [round1 re-review](independent-fix1-review.md).
Round1/5 (`470defb7..44b24eed`): I1 addressed; one new Important I2 remains. Saved false
assistance overrides now reach old ID-based bodyweight subtraction, reversing the trend.
Round2/5 is assigned to the original author with helper/Stats/bodyweight regressions and
narrow browser proof. No fix acceptance is claimed. A minimal optional resolver in history.js
is authorized only if needed to reuse arithmetic while preserving every existing caller's
default behavior; no unrelated global volume change or copied arithmetic is authorized.
Combined one-worker full frontend acceptance remains pending.

Runtime inspected: `f28c91eafa1848a831493a96a82bc818738ad7bb`.

The parent inspected the helper, Stats diff, required cases, semantic table and locale additions.
No blocking runtime finding was established in this pass. Independent agent review and final
browser/full-suite evidence are still pending; this is not final acceptance.

`volume-probe.mjs` constructs 400 deterministic profiles (3,200 sessions) and independently
calculates expected loads, drops, completed limbs, dumbbell factors and warm-up choices without
calling a production volume helper for its oracle. It checks series equality, session accounting
and nonmutation. Node 22.23.5 passed all 1,200 checks in UTC and another 1,200 in America/New_York.
Results retain the inspected commit in `probe-utc.json` and `probe-new-york.json`.

Reproduce against an EP-03 checkout:

```sh
TZ=UTC node docs/superpowers/evidence/EP-03-parent-review/volume-probe.mjs /path/to/checkout
TZ=America/New_York node docs/superpowers/evidence/EP-03-parent-review/volume-probe.mjs /path/to/checkout
```

Whitespace-only evidence log issues were sent to the author for cleanup. The author reported
a full-suite timeout in unchanged media-sync code and is isolating it. Do not infer a complete
frontend pass from the focused results. The table/keyboard and responsive acceptance gates
remain subject to the final browser evidence and fresh reviewer.
