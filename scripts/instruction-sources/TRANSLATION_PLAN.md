# Brazilian Portuguese instruction translation plan

Translate in schema-validated, checkpointed batches. After a stage, regenerate
the runtime pack and run the frontend suite; after the complete corpus, perform
the independent language/content review. Progress is measured from
`pt-BR.json`, not from generated files.

| Stage | Dataset body part | Total exercises | Order |
|---:|---|---:|---|
| 0 | Foundation sample across categories | 20 translated | Complete |
| 1 | Waist / abs / core | 169 | Complete |
| 2 | Chest / pectorals | 163 | Complete |
| 3 | Back / lats / upper back | 203 | Complete |
| 4 | Shoulders / delts | 143 | Complete |
| 5 | Upper arms / biceps / triceps | 292 | Complete |
| 6 | Lower arms / forearms | 37 | Complete |
| 7 | Upper legs / glutes / quads / hamstrings | 227 | Complete |
| 8 | Lower legs / calves | 59 | Complete |
| 9 | Cardio and neck | 31 | Complete |
| 10 | Full-corpus terminology and independent QA | 1,324 | Ready for review |

The body-part stages cover all 1,324 dataset IDs exactly once. The foundation
sample already contributes to several stages, so stage progress must exclude
IDs already present in the source file. Do not add `pt-BR` to `INSTR_LANGS`
until Stage 10 confirms 1,324/1,324 coverage.

## Checkpoints

- Stage 1 completed in 2026-08-19: 169/169 waist IDs. Combined corpus progress
  is 179/1,324 exercises and 996 instruction steps because the foundation
  sample also contains 10 exercises from later stages.
- Stages 2–9 completed in 2026-08-19: source coverage reached 1,324/1,324.
  Automated Stage 10 gates passed for 7,710/7,710 steps: exact ID and step
  coverage, non-empty content, curated-source parity, glossary/English/PT-PT
  leakage checks, complete frontend tests and production build. The independent
  full-corpus review prompt is prepared separately for Claude Code; do not claim
  native-speaker review unless a named human actually performs one.
