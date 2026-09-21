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

---

# German exercise names

`de.json` is the editable source for the German exercise-name pack, and it
covers a stage rather than the whole catalogue: the 999 built-in exercises
that use equipment, and not the 325 whose equipment is `body weight`. Those
keep their English title — the app falls back per exercise, so a partial pack
costs nothing beyond the names it does not yet carry. Which exercises the
stage contains is enforced, not approximate: `scripts/de-name-rules.mjs`
defines the set, and the builder refuses a source that misses one of them or
adds a body-weight entry.

`de-CH` ships no pack of its own. It derives this one by replacing ß with ss,
so German names are written with ß here and the Swiss spelling follows
automatically.

Generate the runtime pack with:

```sh
node scripts/build-de-exercise-names.mjs
```

Translate a stage — one equipment family at a time, dry run first, `--apply`
to write:

```sh
node scripts/translate-de-exercise-names.mjs --equipment='trap bar'
node scripts/translate-de-exercise-names.mjs --equipment=dumbbell --apply
```

Equipment and identity-changing qualifiers (assisted, weighted, one-arm,
seated, incline …) are checked against `scripts/de-name-rules.mjs` while the
batch is still in hand: a violation goes back to the model as a correction
naming the offending word, and a batch that cannot be fixed is never written.
The same rules run again in `frontend/src/lib/de-exercise-names.test.js`, so
CI fails on anything edited in by hand afterwards.

The translations were produced from the English EXDB titles with LLM
assistance and must not be described as reviewed by a native speaker unless a
named human reviewer completes that review. They are original translations and
were not copied from another German exercise dataset.
