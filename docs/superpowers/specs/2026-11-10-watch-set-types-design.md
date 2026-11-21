# Set types on the Apple Watch: warm-up, failure, drop, add and remove a set

Status: design approved by the lifter 2026-11-10 (mockup: `2026-11-10-watch-set-types-menu.png`, source
`menu-M3-side.html` in the design scratchpad). Builds on PR stack #1100 → #1107 → #1108 (branch
`watch/metrics-zones`). Branch: `watch/set-types`.

## Why

The watch is the lifter's main logging tool. They need to see on the wrist, **before** a set, that the routine
planned it as a warm-up, a set to failure or a drop set, so they know to go all in. And they need to **mark** it
there when it happens: "I mark it when I cannot make all the reps that I had planned". They mark on purpose, from a
menu. No automatic "To failure?" prompt (rejected: they often raise the weight and lower the reps on purpose).
While in that menu they also want to add a set (at the end of the exercise) or remove one, without reaching for the
phone.

## Goals

1. The set page shows a set's planned/marked types as tags under the exercise name: Warm-up (orange, flame, exists
   today), **Failure** (red `#ff453a`, bolt), **Drop** (near-white, step-down glyph). Tags combine (Failure + Drop).
2. One **set menu** per set, opened by pressing and holding the set page (0.6 s) or tapping a visible "…" button.
3. In the menu: Warm-up / Failure / Drop toggles, **Add set**, **Remove** (hold 1 s, then Undo).
4. Every change reaches the phone and stays in the workout exactly as if made on the phone.

## Non-goals

- Editing each drop's weight/reps on the watch (phone only). Rest-pause and cluster sets: shown as plain sets, not
  offered in the menu.
- Set-type marks on the Overview rows and the Summary (drawn in the first round, not in the chosen design; add later
  if the lifter asks).
- Any automatic failure detection.

## Anti-goals (failure even if it "works")

- A mark that the watch shows but the phone does not save, or the reverse ("what is shown is what is saved").
- Removing the wrong set (index drift between watch and phone).
- A hold meant for the menu that skips a set, or a hold that removes a set by accident.
- An older phone or older watch breaking: all new snapshot fields optional; an unknown event is ignored, not fatal.

## The rules (mirror the phone exactly)

From `frontend/src/views/Workout.jsx` set menu (~L705–732) and `lib/workout-model.js` / `lib/history.js`:

| Control | Shown / enabled when | Effect on the phone |
|---|---|---|
| Warm-up | exercise mode is `reps`; to make a warm-up: `canBeWarmup(row)` and another work set remains; set not done | `applyWarmToggle` (`lib/live-activity.js`): `makeWarmupAt` / `makeWorkAt` — **the row moves** to the edge of the warm-ups |
| Failure | not a warm-up; mode ≠ `cardio` | `toggleFailure` over the set's span (`setSpanAt`), like `toggleFailureAt` |
| Drop | not a warm-up; mode `reps`; not rest-pause | on: `addDrop` with `nextDropWeight` (one drop), like `addDropRow`. off: remove all its drops |
| Add set | always (not cardio: phone's own addSet handles cardio; watch hides it for cardio) | the phone's `addSet(idx)`: a copy of the LAST set at the END of the exercise (per-side and timed rules included) |
| Remove | the exercise has more than one set | the phone's `deleteActiveSet` path (`removeSetAt`) |

Warm-up excludes Failure and Drop: when the set is a warm-up those two discs are locked (dashed, lock badge, dim),
and making a set a warm-up clears its failure mark and drops on the phone (same as the phone's own menu result —
**builder: verify what `makeWarmupAt` does to `failure`/`drops`; mirror it, don't invent**).

## Data between phone and watch (needs Duarte's OK in #777 before merge)

### Phone → watch (snapshot, `watchSet` in `frontend/src/lib/watch-sync.js`, `SetRow` in `WatchCore/Model.swift`)

New optional fields on a set:
- `failure: true` — `isFailureSet(s)` (planned or marked).
- `drop: <first drop weight>` — present when `isDropSet(s)`; the number is the first drop's weight in the exercise's
  shown unit (the "Drop 50" label); `0`/missing weight → `drop: 0`.
- `rp: true` — rest-pause or cluster set, so the watch hides Drop for it (only if needed to mirror the rule).

All optional, omitted when false, so older watch apps ignore them.

### Watch → phone (events, same queue/ack as `setDone`)

Rebuilt on 1.4.6's set ids (protocol 2, #1162). The protocol lives in
[docs/WATCH_SYNC.md](../../WATCH_SYNC.md) ("Watch → phone: events" and "A set's identity"); this spec no longer
defines it. In short:

- Add and Remove are the existing `addSet` / `removeSet` events, handled by `addWatchSet` / `removeWatchSet` in
  `lib/watch-sync.js`. Add goes at the end of the exercise with a `sid` the watch makes up (`w-<uuid>`). The phone
  never takes out a done set, one with a side done, or an exercise's only row, so the watch does not offer those.
- Marks are one new event, `setMark` (`wid, exId, entryIdx, setIdx, sid, warmup?, failure?, drop?, at`): the row
  by its `sid` (by place without one), each mark only when sent, the later `at` wins as for a tick
  (`markWatchSet`, applied with `watch-marks.js`, the phone's own menu rules).
- No identity check by `w`, `r`, `done`: the set's id is its identity.

Undo for Remove is local: the watch shows "Set 2 removed · Undo" for 4 s and **only then** sends `removeSet`. The held
removal waits in the watch's edits like any other, replayed over every snapshot, so a snapshot does not end the Undo.
If the watch app is closed during the window, the removal is sent the next time it starts.

The watch applies each change to its own state at once and keeps it (`edits`) until the phone acks it, replayed over
each snapshot in the watch's order before its ticks. For Warm-up the watch moves the row the way
`makeWarmupAt`/`makeWorkAt` do; the row keeps its `sid`, so a pending tick follows it.

Older phone (no `settings.setMenu`): the watch hides the menu. An unknown type is acked and dropped by `applyEvents`.

## The watch UI (as drawn in the approved mockup)

Set page (`Watch/SetPage.swift`):
- The tag line under the name shows Failure / Drop chips (plus existing tags). At 41 mm when crowded, chips drop to
  glyph-only discs (glyph + colour, word in VoiceOver label).
- A glass "…" button at the right end of the tag line: looks ~38×28, hit area ≥44×44, clear of the boxes and the top
  28 pt.
- Press and hold anywhere on the page **except the Done button** for 0.6 s opens the menu: a circle grows from the
  finger with a lime ring showing time left; lifting early does nothing. Done keeps its own 0.8 s hold = skip set.
  The Crown boxes keep working.
- Also from the fix-a-logged-set page (Save): the menu edits that done set, Warm-up included as on the phone's own menu (wrist test 2026-11-11; the live-activity
  phone's rule `applyWarmToggle` refuses done rows), Failure/Drop apply at once like on the phone (**builder: confirm
  whether the fix page's Save should gate them; the mockup caption says "applies when you tap Save" — pick the one
  that matches how the fix page already saves w/r, and keep it consistent**).

Set menu (a sheet, one screen, never scrolls at 41 and 42 mm):
- Top band: system close ✕ top-left, "Set 2" lime pill (with ✓ when the set is done), clock.
- A slim card: "62.5 kg × 8" with small round mark glyphs at the right (bolt, step, flame); during Remove's hold the
  line above the buttons says "Set 2 · 62.5 kg × 8 is lost"; a plain tap on Remove says "Hold 1 s to remove".
- Three round 44 pt discs with labels: Warm-up (orange), Failure (red), Drop (near-white, label "Drop 50" when on).
  On = filled in its colour, dark glyph, check badge. Off = dark glass disc, light glyph. Locked = dashed, lock badge.
  The whole column (disc + label) is the hit target.
- Bottom row: **Add set** (lime, +) and **Remove** (red edge, −) side by side, each half width, 10 pt apart, 48 pt
  tall at 42 mm, 12 pt clear at the bottom. German: "Hinzufügen" / "Entfernen".
- Input lockout 1 s after the menu opens (existing TouchLock pattern).
- After Add: the menu closes, the pill shows 2/4, a toast "Set 4 added · at the end".
- After Remove: a plain screen "Set 2 removed · 62.5 kg × 8", one big lime Undo, a draining bar (4 s), then back
  to the set page.
- Remove disabled (dim) when it is the exercise's only set.
- Haptics: one per action (toggle: `.click`; remove fires: `.directionDown`-style firm; add: `.success`) — follow
  `watch-ui/references/haptics.md`.
- Always On: menu closes with wrist down like other sheets; set page tags as outlines.
- VoiceOver: each disc is a toggle with its word and state; Remove has a custom action "Remove set" with the hold
  replaced by a confirm.

Strings: every new word goes through `frontend/ios/ci/watch-strings.mjs` (reuse the phone's own keys where they
exist: "Taken to failure", "Drop set", "Warm-up", …). German "Warm-up" stays the loan word under the disc (mockup
note); if the phone's German pack already says otherwise, use the phone's word only if it fits at 41 mm.

## Where the logic lives (project rules)

- Pure rules in **WatchCore** with XCTest (`SessionCore` or a new small `SetMenu.swift`): what the menu offers for a
  set, toggle effects, warm-up row move, add/remove on the local state, the events they produce, pending/merge with
  snapshots, the identity fields. Views only wire them.
- Phone side in `frontend/src/lib/watch-sync.js` (+ `live-activity.js` helpers reused), with vitest tests in
  `watch-sync.test.js`: snapshot fields, each event, the identity guard, older-phone/unknown-type behaviour.
- No new exercise media. No new dependencies.

## Checks before done

- `swift test` in WatchCore, `npx vitest run` in frontend, watch build.
- Simulator shots: set page with tags, menu (each state), German 41 mm, Always On, at 41 and 42 mm; compare to the
  mockup side by side.
- Device list for the lifter: hold feel vs Done's skip hold, wet-finger accuracy on the bottom row, haptics.

## Left to the builder

Exact SwiftUI structure, file split, the event/pending plumbing following existing patterns, glyph SF Symbols
choice closest to the mockup (bolt.fill, flame.fill, a step-down glyph), animation details (respect Reduce Motion).

## Builder check: answers (2026-11-10)

Found in the code (now part of the spec):
- `makeWarmupAt` (`history.js:1312`) rebuilds the row without failure or drops; `placeRow` (`:1337`) moves it to the
  first non-warm-up index. `canBeWarmup` (`:1310`) refuses drop and rest-pause sets, so the watch locks Warm-up for
  those too (hence `rp` in the snapshot). Port `placeRow` exactly.
- The phone's `addSet` copies only `{w, r, done:false}` (no marks) from the last set; timed per-side pushes an L+R
  pair; `deleteActiveSet` (`Workout.jsx:1124`) refuses to empty an exercise and removes the whole `setSpanAt` span.
- The identity guard compares in the exercise's shown unit (`viewRow`/`shownWeight`), and for side sets uses the
  watch's view (`w` = heavier side, `r` = sum, as `markSide`).

My calls (marked as such). 1, 2 and 4 are superseded by the set ids (see the protocol section above):
1. **Phone refusal and later ticks** (my call): the watch mirrors the phone's acceptance rules, so a refusal only
   happens when the phone was edited at the same moment. Known limit, not fixed now: a tick queued after a refused
   structural event may land on the shifted row until the next snapshot. `lean:` comment where it lives; upgrade
   trigger: any report of a tick on the wrong set.
2. **Where the phone applies them** (my call): like `setDone`: through the workout screen's `handlers`, opening the
   workout when unbound (`openWorkout`). New `handlers.setMark / addSet / removeSet` wrap the existing closures
   (`toggleFailureAt`, `addDropRow`, `removeDrop`, `addSet`, `removeSetAt`; warm-up via `applyWarmToggle`). The new
   types join the "wait for start" lists (`watch-sync.js:445`, `:453`) and `claim`. On an already-saved workout they
   are acked and dropped (marks after save are a phone edit).
3. **Drop off** (my call): the watch can turn Drop off only when the set has exactly one drop (the one Drop on adds);
   with 2+ drops the disc shows on and locked, label "Drop", VoiceOver "edit on the phone". The snapshot sends
   `drops: <count>` next to `drop: <first weight>`.
4. **Index-keyed watch state** (my call): one WatchCore helper remaps `pending`, `skipped` and `efforts` keys when
   rows move, are removed or inserted; a pending tick on a removed row is dropped with it.
5. **Older phone** (my call): the phone sends `setMenu: true` in the snapshot `settings`; without it the watch hides
   "…" and the hold, so an older phone never silently reverts a removal. Part of the #777 ask.
6. **Marks on a done set** (my call): apply at once, like the phone; the fix page's Save stays for w/r/sec/effort only.
   The mockup caption "applies when you tap Save" is superseded.
7. **Optimistic Add/Remove** (my call): the watch appends a copy of the last set's span (w, r, sec, sides shape;
   done false, no marks, no `at`) and removes the whole span on Remove, so 2/4 is right at once.
