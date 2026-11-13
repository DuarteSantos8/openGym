# Set menu on Wear OS: warm-up, failure, drop, add and remove a set

Status: design approved by the lifter 2026-11-13 (mockup `2026-11-13-wear-set-menu.png` beside this file; option W2
with W1's set pill, after one review pass). Branch `wear/set-menu`, stacked on #1183 (`wear/readability`), whose set
page it changes. The phone side is Apple PR #1139 (`watch/set-types`), which this branch depends on and does not copy.

## Why

The Apple Watch app can already mark a set as a warm-up, a set to failure or a drop set, and add or remove a set,
from the wrist (#1139). On Wear OS the lifter still has to pick up the phone for any of that, which breaks the
session. They need to see a planned type before the set ("go all in on this one"), mark it when it happens ("I mark
it when I cannot make all the reps I had planned"), and add a set at the end or remove one, without the phone. The
lifter's bar: "visual, easy to understand, very aesthetic; quality of the utmost importance".

## Goals

1. The set page shows the set's types as small colored chips inside the set pill: Warm-up (orange), Failure (red),
   Drop (purple). Tags combine (Failure + Drop). They show before the set when the routine planned them.
2. One set menu per set, opened by tapping the "2/3 · tags · …" pill or by a long-press on the weight/reps boxes.
3. In the menu: a live set card, three toggles (Warm-up, Failure, Drop), then Add and Remove side by side.
4. Every change reaches the phone and is saved exactly as if made on the phone's own set menu.

## Non-goals

- Editing each drop's weight and reps on the watch (phone only). Rest-pause and cluster sets show as plain sets and
  get no Drop toggle.
- Types on the Overview rows and the Summary.
- Automatic failure detection, or a "To failure?" prompt.
- Animations (the lifter asked for stability this release).
- Any phone-side change: the phone handlers, snapshot fields and rules come from #1139 unchanged.

## Anti-goals (a failure even if it "works")

- A mark the watch shows but the phone does not save, or the reverse.
- Removing the wrong set (index drift between watch and phone).
- A long-press meant for the menu that changes a number, or a slip that removes a set with no way back.
- An older phone breaking: the menu must not appear unless the phone says it handles the events.
- A set page that no longer fits a 40 mm round watch (192 dp) at text 1.0 or 1.3.

## The rules (mirror the phone; they live in #1139)

The Wear app follows #1139's spec (`docs/superpowers/specs/2026-11-10-watch-set-types-design.md` on
`watch/set-types`) for every rule and wire field. In short:

| Control | Shown / enabled when | Event |
|---|---|---|
| Warm-up | mode `reps`; to make one: the set can be a warm-up and another work set remains; set not done | `setMark` `warmup` |
| Failure | not a warm-up; mode not `cardio` | `setMark` `failure` |
| Drop | not a warm-up; mode `reps`; not rest-pause (`rp`) | `setMark` `drop` |
| Add set | not cardio | `addSet` (a copy of the last set at the END of the exercise) |
| Remove | the exercise has more than one set | `removeSet` |

Warm-up locks Failure and Drop (dimmed, dashed, a lock), and making a set a warm-up clears them, as on the phone.
A drop set with 2+ drops is edited on the phone: the Drop row shows on and is locked (the phone's `applyWatchMark`
only turns Drop off when exactly one drop exists, and the Apple Watch locks it the same way).

## Data between phone and watch

Exactly #1139's protocol, so the phone needs no Wear-specific code:

- Snapshot set fields (optional): `failure`, `drop`, `drops`, `rp`, `side`; `settings.setMenu` says the phone
  understands the events. **No `settings.setMenu`, no menu**: the pill shows "Set 2 of 3" as today (tags still show).
- Watch → phone events `setMark`, `addSet`, `removeSet`, each with `id, wid, exId, entryIdx, at` like `setDone`,
  and for `setMark`/`removeSet` the identity fields `setIdx, w, r, done`. The phone checks identity and drops a
  stale event (the next snapshot puts the watch right).
- The watch applies each change to its own state at once and keeps it pending until a snapshot reflects it (the
  `SessionCore` pending pattern used for ticks), so a late snapshot can't flash it back. Warm-up moves the row the way
  the phone's `makeWarmupAt`/`makeWorkAt` do, ported to Kotlin with tests, so indexes agree before the next snapshot.
- Undo for Remove is local: the watch queues `removeSet` only when the 4 s Undo ends. If the app goes to the
  background or is closed during those 4 s, the removal is sent at once (what the lifter saw is what is saved), and
  a phone snapshot during the window sends it at once too (#1139's rule).

## The watch UI (as drawn in the approved mockup)

Set page (`ui/Screens.kt` set panel):
- The "Set 2 of 3" line becomes a pill: "2/3", the set's tag chips, then "•••". The whole pill is the button
  (48 dp tall hit area). The exercise name stays plain text. No extra line: the boxes keep #1183's sizes.
- Long-press on the weight or reps box also opens the menu. A plain tap and the crown keep their current jobs
  (select the box, change its number). The pager swipes are untouched.
- Without `settings.setMenu` the pill shows tags but no "•••" and does nothing on tap.
- Always On: the menu closes; tags show as full-color outlines (reviewed for contrast: 6:1).
- 40 mm, two tags in German ("Versagen", "Drop"): the pill is 161 of ~174 dp. If it does not fit on a device, drop
  "2/3" when two tags show (builder: measure; the rule must keep the pill inside the circle).
- TalkBack reads the pill in full: "Set 2 of 3, Failure, Drop, set menu".

Set menu (a full-screen Wear list the crown scrolls):
- A live set card on top: "62.5 kg × 8" and the tags as they are now (it updates as toggles change).
- Three 48 dp toggle rows: a letter disc when off (W, F, D, translated), a check when on, the row tinted in its
  color; locked rows dashed and dimmed (contrast 5.7:1). At 40 mm the card and two rows show, the third peeks.
- Add and Remove side by side at the end, 48 dp tall, icon over word ("+ Hinzufügen", "− Entfernen" fit at 12 sp).
- Remove is dim and does nothing when it is the exercise's only set.
- After Add: the menu closes and the pill shows the new count ("2/4").
- After Remove: the menu closes and a "Removed | Undo" chip takes the Done bar's place for 4 s. Undo puts the set
  back and sends nothing.
- Text 1.3: rows may wrap to two lines; nothing is cut.
- Haptics: one tick per toggle, a firmer one on Remove (the app's existing `Haptics.kt`).
- Exact sizes, colors and contrast numbers: `2026-11-13-wear-set-menu-notes.md` beside this file.

Words come from the phone's packs where they exist ("Warm-up", "Taken to failure"/"Failure", "Drop set", "Add set",
"Remove set", "Undo"), through `wear-strings.mjs`; only new keys' lines change in the language files.

## Where the logic lives

- Pure Kotlin in `SessionCore.kt` or a new small `SetMenu.kt`, with JVM tests: what the menu offers for a set, the
  toggle effects, the warm-up row move, add/remove on local state, the events produced, pending/merge with
  snapshots, the Undo window. Port #1139's WatchCore test cases where they exist.
- `WearStore.kt` wires them to the queue and the Data Layer the way `setDone` is wired.
- Views only render and call.
- No new dependencies, no exercise media.

## Checks before done

- `:wear:testDebugUnitTest`, `:wear:compileReleaseKotlin`, `:wear:assembleDebug` (one build at a time).
- Emulator shots at 40 and 45 mm, text 1.0 and 1.3, German, Always On: set page with tags, menu top and end,
  locked rows, Undo chip; side by side with the mockup.
- A debug demo seed for tagged sets and `settings.setMenu`, so the emulator can show the menu without a phone.
- On a real watch (lifter): the long-press feel against the crown and taps, Remove/Undo, the German pill.

## Answers to the builder check (2026-11-13)

1. **Other actions during Remove's 4 s Undo:** any other event the watch queues (Done, a mark, Add) sends the
   pending `removeSet` first, so the phone sees events in the order the lifter made them and indexes agree. Navigation
   stays free. (My call: matches #1139's "a phone update sends the removal at once"; tested for order.)
2. **#1139 may still change:** build to `fork/watch/set-types` as it is, with the field names and event shapes in one
   small codec spot so a change there is cheap. Checks are JVM tests against #1139's shapes (port its test cases); an
   end-to-end check with a phone build of #1139 is a device step for the lifter. (My call.)
3. **Timed per-side pairs (two rows, `side` L/R):** follow #1139's code: the pair counts as one set for the pill
   count and the marks (`setSpanAt`), and Add and Remove are off for paired rows (`SetMenu.offer`), as on the Apple
   Watch; add `side` to Wear's model. (Mirrors #1139.)
4. **Where the menu opens:** the live set page and the fix-a-logged-set page, as on the Apple Watch after the lifter's
   wrist test (2026-11-11): marks on a done set apply at once; Warm-up on a done set follows the phone's rule. Not from
   the keypad. (Lifter's Apple decision, carried over.)
5. **Current set after Add/Remove:** port #1139's remap of index-keyed state (pending, skipped, effort, picked): Add
   never moves the current set; Remove of an earlier set shifts it down by one; removing the current set selects the
   next open set. (My call: mirrors #1139.)
6. **Strings:** reuse phone and Apple Watch keys through `wear-strings.mjs`; any new key goes into every language
   pack (project rule), not English only.

## Left to the builder

- `SetMenu.kt` vs growing `SessionCore.kt`: whichever keeps `SessionCore` readable.
- The long-press duration (Wear's default long-press is fine unless it fights the box's tap).
- How the menu is shown (a full-screen destination or an overlay) within the app's current navigation.
