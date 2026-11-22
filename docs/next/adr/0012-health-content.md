# ADR 0012: Health and training content: educational only, sourced, reviewed before it is called reviewed

- Status: accepted (2026-11-22, owner go-ahead on the plan's defaults)
- Context: the beginner work adds text that tells people how to train: a plan picker (`lib/planner.js`), guides and a glossary (`content/learn.js`), and later form cues and common mistakes per exercise (EP23). The charter says "movement/rehab output is educational, not diagnostic", and EP15 (PT-reviewed content) is blocked until a licensed PT is named in writing.

## Decision

1. **Scope: general education for healthy adults.** No diagnosis, no rehab protocols, no injury-specific advice, no promises. EP15 stays blocked; nothing here unblocks it.
2. **Numbers name their source.** A guide that gives a health or training number lists where it comes from (ACSM, WHO, ISSN and the like) in its `sources`. No source, no number.
3. **Limitations only ever make things gentler.** The quiz's "anything to be careful with?" lowers the dose, never prescribes for the condition, and two answers (pregnancy, told to limit exercise) add "check with a professional first". The answer is not stored anywhere.
4. **Red flags are always reachable.** "When to stop" (chest pain, fainting, sharp or radiating pain, numbness) is a Learn guide and is linked from the plan result.
5. **One disclaimer line, not a wall.** "General training information for healthy adults, not medical advice." on the plan result and on Learn.
6. **Review status is data.** Per-exercise content (EP23) carries `contentReview: { status: 'draft' | 'reviewed', reviewer, date }`. `reviewed` needs a named human. The UI never presents a draft as reviewed.
7. **Drafting with a model is allowed for text, from the owner's outline, and is always `draft` until a human signs it.** No exercise media is ever given to a model (ADR 0009).
8. **Tests hold the line.** `lib/learn.test.js` fails on a link out of the app, on a promise word ("guarantee", "cure") and on a health guide without sources.

## Consequences

- The beginner features can ship now without a PT reviewer, because they stay inside general, sourced guidance.
- Anything about pain, injury or return from injury waits for EP15's named reviewer.
- Translations of the Learn text are a follow-up: the guides ship in English and say so on screen in other languages.
