# Brazilian Portuguese exercise names

`pt-BR.json` is the editable source for the Brazilian Portuguese exercise-name
pack. It maps every built-in EXDB exercise ID to a Portuguese title. The app
combines that title with the unchanged English source at runtime:

```text
Elevação assistida das pernas deitada (assisted lying leg raise)
```

Custom exercise names are never translated. IDs, plan data, workout history,
imports and exports continue to use the canonical catalogue entries.

Generate the runtime pack with:

```sh
node scripts/build-pt-br-exercise-names.mjs
```

The initial translations were produced from the English EXDB titles with LLM
assistance and must not be described as reviewed by a native speaker unless a
named human reviewer completes that review. They are original translations and
were not copied from another Portuguese exercise dataset.

# Russian exercise names

`ru.json` is the same thing for Russian, and `GLOSSARY.ru.md` beside it fixes
the terminology — which movements keep an English loanword a Russian lifter
actually says (`бёрпи`, `машина Смита`, `EZ-гриф`) and which get a Russian
term, so a batch translated next month matches one translated today.

```sh
node scripts/translate-ru-exercise-names.mjs --apply   # fills in what is missing
node scripts/build-ru-exercise-names.mjs               # regenerates the runtime pack
```

The translation script only visits IDs the source does not already have, so it
is safe to re-run after the catalogue grows, and it checkpoints after every
batch. Same caveat as above: these were produced with LLM assistance from the
English titles and must not be described as reviewed by a native speaker unless
a named human reviewer completes that review.
