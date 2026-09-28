# Curated exercise-instruction translations

`pt-BR.json` is the editable source for Brazilian Portuguese exercise
instructions. It is intentionally separate from the upstream-generated packs:
the upstream exercise dataset does not currently ship Portuguese instructions.

## Provenance and review status

The translations are produced from the English instructions in
`frontend/src/lib/exercises-data.js` with language-model assistance from OpenAI
Codex and, for larger structured batches, Anthropic Claude Code. They are
original translations, not copied from another Portuguese exercise dataset.
Each batch is structurally checked against the English source and audited for
Brazilian terminology. It must not be described as native-speaker reviewed
until a named human reviewer has actually completed that review.

The translation policy is meaning-faithful rather than word-for-word: preserve
the number and order of steps, retain the intended movement and safety cues,
and clarify the referenced limb only when the English would otherwise be
ambiguous in Portuguese. Do not silently repair questionable exercise mechanics
from the source dataset; record those separately for upstream correction.
Known source inconsistencies are recorded in `SOURCE_DIVERGENCES.md`.

Add translations in small, reviewable batches. Every translated exercise must
preserve the English instruction-step count. Then regenerate the runtime pack:

```sh
node scripts/build-pt-br-instructions.mjs
```

The generator rejects unknown IDs, empty steps, mismatched step counts and
steps left unchanged in English. The frontend test also verifies that the
generated `frontend/src/instr/pt-BR.js` exactly matches this source.

Do not add `pt-BR` to `INSTR_LANGS` until all 1,324 exercise IDs are translated
and the full automated corpus gates pass. Until then, the released app must
continue to show the honest English-instructions notice instead of silently
mixing Portuguese and English.

Use the terminology in `GLOSSARY.md` for every batch.

For a structured batch, use `scripts/translate-pt-br-stage.mjs` with a dataset
body part and limit. It calls Claude in read-only structured-output mode and
checkpoints only after every returned ID and step count in that batch validates,
so a long stage can resume safely. The normal pack builder and frontend tests
remain mandatory after generation.

Use `--provider=codex` to run the same schema-constrained workflow through an
authenticated Codex CLI when Claude is unavailable. Both providers run without
write tools; only this validator updates the curated JSON after a valid batch.
