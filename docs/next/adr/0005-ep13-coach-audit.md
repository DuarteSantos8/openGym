# ADR-0005 EP13: audit of the existing Coach
Timebox: 1 session (used: 0.3) · Decision: **GO for one gap: opt-in nutrition context (aggregates only)**
Date: 2026-11-14 · Base: `next/ready-20261114`

## What upstream already has (api/coach/core, 26 modules; 7 API coach test files)
- Providers: Claude, ChatGPT, Codex, Gemini, OpenRouter, any OpenAI-compatible incl. Ollama (`providers.js`, `adapters/`).
- Bounded payload: `payload.js` caps (12 weeks, 60 sessions, 300,000 chars, note and profile text limits).
- Context builders: `context.js` (`muscleLoad`, `gymOf`, `challengesOf`, `recordsOf`, `measurementsOf`, `healthOf` with cleaned vitals, `rotationOf`).
- Consent: `S.coach.consent` (intake) plus per-provider consent (`frontend/src/lib/coach-consent.js`).
- Proposal safety: `validate.js`, `pending.js`, `refine-changes.js`, `schemas.js`; changes are proposals the person applies.

## Gap
The fork's nutrition diary (`foodLog`) never reaches the Coach, so a weekly review cannot relate training to intake.

## Decision (EP13-T02, Tier A, size M)
Add `nutritionOf(S, now)` beside `healthOf`:
- **Off by default**; on only with an explicit `S.coach.shareNutrition === true`.
- **Aggregates only**: per day for the last 14 days, `{ day, kcal, proteinG, carbsG, fatG, entries, unknown }`, numbers clamped. **No food names, notes or sources** — food names are user/third-party free text and the classic prompt-injection path; aggregates remove it by construction.
- Bounded: ≤ 14 rows, finite non-negative numbers, values above sane caps dropped.
- No new validator, no new actions: proposals still pass `validate.js`.

## Tests (RED first)
off by default · on → 14 rows max · food names never present in the payload · malformed/negative/NaN values dropped · unknown nutrients counted, not zeroed · deleted entries excluded.
