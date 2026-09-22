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
covers a stage rather than the whole catalogue: 760 of the 1,324 built-in
exercises. Left out are the 325 whose equipment is `body weight`, and 239
equipment exercises whose German name is written but not yet signed off by a
native speaker (`AWAITING_REVIEW` in `scripts/de-name-rules.mjs` lists them,
with the reason). Both groups keep their English title — the app falls back
per exercise, so a partial pack costs nothing beyond the names it does not
yet carry. Which exercises the stage contains is enforced, not approximate:
`scripts/de-name-rules.mjs` defines the set, and the builder refuses a source
that misses one of them or adds an entry from outside it.

Clearing a name from `AWAITING_REVIEW` is what a second German-speaking
reviewer does: delete its id there, put its name in `de.json`, rebuild. The
test fails if the two ever disagree, so the list cannot quietly rot.

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
node scripts/translate-de-exercise-names.mjs --equipment=dumbbell --limit=999 --apply
```

`--limit` caps how many names one invocation translates and defaults to 40, so a run
without it stops early and still exits successfully — pass a limit at least as large as
the family you are translating. Names already in `de.json` are skipped, so re-running
after an interrupt costs nothing.

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
