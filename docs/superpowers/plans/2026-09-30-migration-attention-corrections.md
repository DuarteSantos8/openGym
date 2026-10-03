# Migration attention corrections implementation plan

**Goal:** Correct every TODO A23–A55 in MIGRATION_TO_ENGINE_NOTE.md §8 and update that index with verified behavior.
**Architecture:** Retain the existing pure conversion and engine; fix shared unit, merge, validation and persistence boundaries. Preserve existing workspace changes and add no dependencies.
**Spec:** docs/MIGRATION_TO_ENGINE_NOTE.md §8.

- [x] Canonical units and shared plans (A23, A49): regression tests in units/plan-share; convert declared loads, dictionaries, active/snapshot data and hashes; preserve execution metadata.
- [x] Merge (A24, A25, A46): reproduce independent migrations, merge audits and collision-safe dictionaries, replay retained history and reconcile derived 1RMs.
- [x] Durable storage and API (A26–A31, A55): streamed race and storage/filesystem failure tests; recheck schema, fail closed, retain retry context, resume profile/active writes, validate exact backups, align supported size limits.
- [x] Conversion fidelity (A32, A34, A35, A48, A50–A53): reproduce collisions/malformed/date/active cases; preserve original values in audits and execution context in canonical records.
- [x] Canonical validation (A33): reject malformed nested records, broken identity/reference and prescription hashes; retain unusual valid execution values.
- [x] Training engine (A36–A48, A54): reproduce next-session/replay/deletion cases; share chronological and plan-boundary semantics; decide success from required rows; reconcile derived estimates.
- [x] Integration: run complete API/frontend/MCP tests and frontend build, review all A23–A55 against implementation, update section 8 and related prose.

Review focus: storage quota and rename failures; divergent copies with identical generated ids; shuffled/backfilled history; required work versus bonus/warmup rows; inferred timed and unilateral active sessions.

Verified: frontend 3,294 tests; API 573 tests; MCP 29 tests; frontend production build; git diff --check. No dependencies added.
