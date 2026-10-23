# Optional workout phases

Routines and active workouts can group whole exercises into optional phases. The existing warm-up-set control remains a separate, per-exercise feature.

## Use

Choose **Add phase** in a routine or workout. Built-in choices are Warm-up, Mobility, Main work, Accessory, Cooldown and Stretching. Add only what is useful, repeat a type, rename it or change its order. There is no required sequence or required main phase.

When a populated flat routine first opts in, its existing exercises are placed in Main work so their statistics keep the same meaning. An empty routine can start with a preparation-only phase. Removing the last phase returns to a flat workout. Removing another phase asks where to move its exercises and preserves logged sets.

Each phase has **Add exercise** and **Remove exercise** actions beneath its exercises, including an Add action when the phase is empty. The exercise picker names the destination and keeps both quick and configured additions in that phase. Removal lists only that phase's exercises and asks for confirmation.

Open an exercise's **…** actions to move it up/down, remove it, change its superset link or choose a destination phase. A contiguous superset is labeled **Move group to phase** and moves together. Only one exercise actions panel opens at a time; Escape closes it and returns focus to its trigger. The visible grip also drags an exercise or group between phases, including empty phases. Move up/down supports keyboard and pointer ordering within phase boundaries. A phase move brings the moved exercise into view.

**Add phase** opens the phase choices directly and brings the new section into view. The **…** in a phase header expands its name, colour, training settings, order and removal controls in place. Save closes this editor and returns focus to the phase header. Empty phases can be removed directly; occupied phases retain the explicit destination choice. The separate Manage phases entry is no longer needed. Routine-level settings collapse while editing phases, leaving the exercise plan first; flat routines retain their existing controls.

Drag a phase by its grip to reorder the whole phase, including its exercises and supersets. On touch screens, hold the grip before moving. The existing Move up/down controls remain available in phase settings. Active-workout phase dragging is available in List and Compact layouts; Cards and Focus show one phase at a time. Structural changes remain disabled during a running set timer.

Tap a phase header to minimise or expand its contents. This only changes the current view; exercise data and logged sets are retained.

Phase headers use a colour highlight, name and exercise count. Eight swatches and a custom hex/native colour picker let each phase have its own colour. Reset restores its type's default. Colour carries no training meaning: the name and Counts as training work setting remain authoritative. Custom colours survive routine copies, sharing, session start and finished-workout snapshots, including later edits to the original routine. Presets can include a colour for future additions.

An active workout retains the current exercise and the rest timer's exercise when phases move. Structural changes wait until a running set timer finishes. Card navigation closes phase settings when the current phase changes.

Custom presets store a name and **Counts as training work**. Saving a preset also adds a phase. Editing or deleting that preset affects future additions; existing routine, active-workout and completed-workout snapshots keep their settings.

## Training statistics and activity

| Phase default | Counts as training work |
|---|---|
| Main work, Accessory, Custom | Yes |
| Warm-up, Mobility, Cooldown, Stretching | No |

Every phase exposes the checkbox, including built-in phases. Training work is eligible for progression, records, estimated 1RM, working volume, strength maps and effort summaries. The existing set-level warm-up/work rules then apply within eligible exercises. Completed preparation activity is still logged and contributes to the existing fatigue estimate. This change introduces neither recovery credit nor new fatigue coefficients.

Repeated appearances of the same exercise have separate occurrence identities. An occurrence's history and prescription cannot accidentally use its preparation entry or a different work occurrence after reordering. Old flat records remain readable and retain their existing statistical behavior.

## Data contract

The existing flat `ex` and `entries` arrays remain canonical. Optional metadata groups them without introducing nested exercise arrays:

```js
sections: [{ id, type, label, countsAsWork, color? }]
// Each phased exercise:
{ id: exerciseId, occurrenceId, sectionId, section: { id, type, label, countsAsWork, color? }, /* existing fields */ }
```

`sections` order determines phase order; exercise order is stable inside a phase. Types are `warmup`, `mobility`, `work`, `accessory`, `cooldown`, `stretch` and `custom`. Metadata permits up to 50 phases, names up to 80 characters, and unique phase IDs. Occurrence IDs are bounded strings, unique inside a phased routine/session. Shared readers and validation live in `api/coach/core/workout-sections.js`, which both application builds already package; frontend mutations live in `frontend/src/lib/workout-sections.js`. There are no new dependencies or database migrations.

Editable routines and active sessions normalize membership and snapshot metadata. Finished workouts keep their snapshots. Routine copies and plan imports create fresh phase and occurrence IDs. Consumers that snapshot complete routine objects can retain phase definitions with those snapshots.

`color` is optional and accepts only a six-digit hex value, normalized to lowercase at the shared metadata boundary. Colour-free records remain valid and use display defaults without a data migration. Explicit colours participate in the existing phased-plan hash; a changed snapshot conservatively invalidates an outstanding Coach proposal.

## Compatibility

- Routine editor, workout card/list views and saved history show phase headings. Flat routines retain their existing presentation with an Add phase action.
- Routine/session start, completion and restore carry phase metadata. Exercise replacement/settings retain membership. Existing set-level warm-ups, progression rules, mixed logging modes, intensifiers, supersets and timers remain available.
- Flat plan exports remain format 1. A plan with phases uses format 2; import validates phase definitions, membership and occurrence uniqueness, and rejects groups spanning phases. Printed plan output contains phase headings. Older clients may accept unknown formats without understanding their classification; recipients need a phase-aware client before importing these plans.
- Coach receives whitelisted phase metadata and training-only work summaries. Hashes include phase labels, classification, order and occurrence membership; legacy flat hashes stay unchanged. Phased plans reject missing/stale hashes, ambiguous duplicate-exercise targets and structural add/reorder/superset proposals. Supported scalar changes, swaps and removals preserve phase metadata. Coach phase authoring remains deferred.
- MCP routine/workout reads include phase context; its record summaries exclude preparation work.

Clients predating phases are not safe editors of phased account state: their calculations do not understand the new classification and some edits can discard metadata. Release the client/API changes together and update devices before editing phased account state. There is no database migration.

This contribution applies independently to upstream main. Programme, richer set-phase settings, group metadata and sharing hardening are separate contributions. The earlier integration-based prototype verified Programme snapshots and those combined features; the standalone branch retains main's existing controls and needs compatibility reconciliation when those contributions are merged.

## Screenshots

The synthetic review fixture is shown in [mobile](screenshots/workout-phases/mobile-editor.jpg), [reordered and collapsed phases](screenshots/workout-phases/mobile-reorder-collapse.jpg), [phase settings](screenshots/workout-phases/mobile-settings.jpg), [active workout](screenshots/workout-phases/mobile-workout.jpg), [desktop](screenshots/workout-phases/desktop-editor.jpg), and [light theme](screenshots/workout-phases/mobile-light.jpg).

## Local review

From `frontend`, run `npm run dev -- --host 127.0.0.1 --port 5178 --strictPort`, then open:

- `/review/workout-phases.html#/plan/r/review` — phased example.
- `/review/workout-phases.html?flat#/plan/r/review` — flat comparison.

These development-only entries render real app components with synthetic data and session-local persistence. They bypass account boot; they are not production build entries. Add `?reset` for a fresh fixture or `?light&reset` for the light theme. Exercise media comes from the local catalogue through Vite's existing media handler.

Relevant checks:

```text
# frontend
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build
# repository root
node frontend/scripts/check-locales.mjs
node scripts/build-coach-assets.mjs --check
# api
node --test test/payload.test.js test/validate.test.js test/cohort.test.js test/prompts.test.js test/prompt-split.test.js test/warmup.test.js
# mcp
node node_modules/vitest/vitest.mjs run test/tools.test.js
```

Coverage includes unchanged flat behavior, preparation-only completion, snapshots, classification/fatigue separation, repeated exercises, set-level warm-ups, group ordering, active rest/current-exercise preservation, sharing/printing/restore, Coach parity/staleness and MCP summaries. Completion and delayed removal also run through the real UI action paths.

## Remaining scope

Automatic suggestions (OG-014), per-exercise preparation links and Coach phase authoring are deferred. A future deterministic suggester can aggregate the training phases' existing muscle groups and offer matching mobility/cooldown/stretch exercises when a phase is added. It should explain the match and require selection, with no forced insertion or LLM dependency.

Native iOS/Android packaging and live account round trips are not verified by the local browser preview. Product fit and release compatibility remain subject to maintainer review.
