# REPORT.md Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every confirmed finding of `REPORT.md` (M1–M8, M10, M13, P1–P4) so the v1 → v2 migration is robust and v2 progression matches v1 where the report found a regression.

**Architecture:** Five tasks, ordered by the report's §8 (M5 is split in codec + wiring). No task demotes data to legacy: history is converted, never discarded. The characterisation tests the audit left behind (`api/test/migration-audit.test.js` `todo`s, `frontend/src/lib/engine-audit.test.js` `it.fails`) are the failing tests: each task flips its own to plain tests and adds only the extra cases it needs. Engine code in `api/engine/*` is shared by the API and the frontend (`frontend/src/lib/prescription/index.js` re-exports it), so one fix serves both.

**Tech Stack:** Node 22 `node:test` for `api/`, Vitest for `frontend/`. No new dependencies.

**Spec:** `REPORT.md` (repo root), finding ids below match it.

## Global Constraints

- No linter/formatter/TypeScript: match the surrounding style by hand (2-space indent, single quotes, `api/` uses semicolons, `frontend/src/lib/*.js` does not).
- Dependency-light: no new packages, frontend or api.
- Training-logic changes need a `*.test.js` beside the code (CONTRIBUTING.md) — every task here has one.
- Work on the checked-out branch `feat/generic-engine-v1.3.12-issue186`; do not create branches.
- Run api tests with `cd api && node --test`, frontend with `cd frontend && npm test`. Baseline: api 577 pass / 8 todo, frontend 3294 pass / 7 expected-fail. Every task must end with both suites green.
- Never edit `media/` or `data/`.
- **Decision recorded for P2/P3/P4:** restore v1 semantics (the migration's stated goal is "first session after upgrade matches v1"). Confirm at plan review; if rejected, Task 4 shrinks to documenting the three changes in `docs/MIGRATION_TO_ENGINE_NOTE.md`.

## Review Focus

- A linked entry whose only done rows are warm-ups must not count as a miss (Task 1 test).
- A v1 profile with a mix of 1.25 / 52 / 52.5 kg loads and a `lb` unit must keep v1's next load (Task 2 tests).
- A workout with `d: ''` **and** no `start` must still migrate (Task 2 test).
- Pack/unpack must be lossless on every row shape: sides L/R, drops, rest-pause clusters, `lb` unit, free-form `muscleSnapshot` keys, a key equal to a short name (Task 3 tests); a profile still too big after packing must fail with `profile-too-large`, never be truncated.
- A profile written before this change (canonical, unpacked) must still load on server, client and MCP (Task 4 test: `unpackProfile` is the identity on it).
- A double-progression lifter who improves at one weight but never reaches the aim must not deload; one who stagnates must still deload at the third session (Task 4 tests).

## File Structure

- `frontend/src/lib/finish-session.js` — Task 1 (live skip handling).
- `api/migration/profile-migration.js` — Tasks 1, 2 (skipped links, step, fingerprint, cardio, dates, caps).
- `api/migration/profile-pack.js` (new), `api/migration/profile-size.js` — Task 3 (compact storage/wire form).
- `api/server.js`, `frontend/src/lib/state-codec.js` (new), `useStore.js`, `mobile.js`, `api.js`, `mcp/src/state.js` — Task 4 (edges).
- `api/engine/advance.js`, `generate.js`, `context.js` — Task 5.
- `api/test/migration-audit.test.js`, `frontend/src/lib/engine-audit.test.js` — flipped/extended per task.
- `docs/MIGRATION_TO_ENGINE_NOTE.md`, `REPORT.md` — one status note per task.

---

### Task 1: Skipped exercise is not a miss (P1)

Nessun dato legacy: una entry v1 senza lavoro completato resta **convertita** (prescrizione congelata, righe, `actual`) ma marcata `excludedFromProgression: true`, esattamente come il motore dal vivo marca una sessione saltata. Non avanza la traccia, non è mai la base della prossima prescrizione, non scompare dalla storia.

**Files:**
- Modify: `frontend/src/lib/finish-session.js:21-31`
- Modify: `api/migration/profile-migration.js` (link loop, `finalizeDraft`, `seedProgression`, `migrateWorkout`)
- Test: `frontend/src/lib/engine-audit.test.js` (P1), `api/test/migration-audit.test.js` (new P1 test)

**Interfaces:**
- Consumes: `isWarmupRow`, `list`, `isObj` già definiti in `profile-migration.js`; `isWarmupRow` già importato in `finish-session.js`.
- Produces: un'esposizione finita (live o migrata) senza una riga di lavoro completata ha `excludedFromProgression: true` e non avanza la traccia; i link migrati hanno `link.skipped: boolean`; `lastWorked(d): object|undefined` = valori del target dell'ultimo link non saltato (Task 2 lo riusa).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/lib/engine-audit.test.js` cambia il test P1 da `it.fails` a `it` e proteggi la lettura (nessuno stato di progressione è ora l'esito corretto):

```js
  it('does not count as a stall (skipped exercise must not deload)', () => {
    const S = profile(), occ = linear(100)
    for (const day of [0, 1, 2]) finish(S, start(S, occ, day), day)          // nothing checked off
    expect(S.progression['occ-0025']?.stalls ?? 0).toBe(0)
    expect(prescriptionOf(S, start(S, occ, 3)).parameters.load.resolved.value).toBe(100)
  })
```

Aggiungi a `api/test/migration-audit.test.js` (dopo il test M7):

```js
test('P1 (migration): a linked entry with no completed work row is converted but excluded, never a miss', () => {
  const skipped = (i) => wk(`w${i}`, `2026-01-0${i}`, [entry(BENCH, { sets: 3, reps: 5, weight: 60 },
    [row(8, 30, { phase: 'warmup' }), row(5, 60, { done: false }), row(5, 60, { done: false }), row(5, 60, { done: false })], { sets: 3, reps: 5, weight: 60 })]);
  const { profile } = migrate(v1([{ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' }], [1, 2, 3].map(skipped)));
  const x = profile.workouts[0].exposures[0];
  assert.ok(x.prescriptionId && x.kind !== 'legacy');          // converted, not legacy
  assert.equal(x.excludedFromProgression, true);
  assert.equal(profile.progression['r1:o0']?.stalls ?? 0, 0);
  assert.equal(loadOf(nextPrescription(profile)), 60);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/lib/engine-audit.test.js -t P1` → FAIL (`stalls` 3).
Run: `cd api && node --test --test-name-pattern="P1 \(migration\)" test/migration-audit.test.js` → FAIL (`excludedFromProgression` false).

- [ ] **Step 3: Implement**

`frontend/src/lib/finish-session.js` — sostituisci la guardia e il return:

```js
    const worked = performed.length > 0   // v1 never saved an entry with no completed set (finish-workout.js)
    if (!exposure.excludedFromProgression && worked) {
      progression[exposure.trackId] = advanceProgression({ state, prescription: p, log: { id: exposure.exposureId, actual }, now: completedAt })
    }
```
```js
    return { ...exposure, completedAt, actual, audit, sourceAudit: { ...p.provenance }, ...(worked ? {} : { excludedFromProgression: true }) }
```

`api/migration/profile-migration.js`:
- vicino a `linkOf`: `const hasDoneWork = entry => list(entry.sets).some(row => isObj(row) && row.done && !isWarmupRow(row));` e `const lastWorked = d => d.links.findLast(l => !l.skipped)?.values;`
- nel link loop aggiungi al `d.links.push({ … })` il campo `skipped: !hasDoneWork(entry)` (il resto invariato: l'entry resta collegata). **Non** filtrare dentro `linkOf`: `migrateActive` lo chiama per entry in corso senza nulla di fatto.
- `finalizeDraft`: dove si legge l'ultimo link (`d.links.at(-1)?.values.weight` nella scelta del preset e `const last = d.links.at(-1)?.values;` per la regola viva) usa `lastWorked(d)`: il carico di partenza viene dall'ultima sessione in cui si è lavorato. `loads` per lo step può includere anche i link saltati.
- `ctx.linked.set(…)`: aggiungi `skipped: link.skipped` all'oggetto; in `migrateWorkout` il ramo `link` scrive `excludedFromProgression: !!link.skipped` (oggi `false`).
- `seedProgression`: prima riga del `for (const link of d.links)` → `if (link.skipped) continue;`.

- [ ] **Step 4: Run both suites**

Run: `cd api && node --test` e `cd frontend && npm test`. Verdi. Un test esistente che assumeva una entry `topW`-only come progressione va aggiornato: ora è convertita ed esclusa (D2).

- [ ] **Step 5: Docs + commit**

Riga in `docs/MIGRATION_TO_ENGINE_NOTE.md` («una entry senza lavoro completato è convertita ma esclusa dalla progressione, come in v1»); P1 e D2 risolti in `REPORT.md` §1.

```bash
git add frontend/src/lib/finish-session.js api/migration/profile-migration.js frontend/src/lib/engine-audit.test.js api/test/migration-audit.test.js docs/MIGRATION_TO_ENGINE_NOTE.md REPORT.md
git commit -m "fix(engine): an exercise skipped in a session is not a miss (P1)"
```

---

### Task 2: Migration fidelity and robustness (M1, M2, M3, M4, M6, M7, M8, M10, M13)

**Files:**
- Modify: `api/migration/profile-migration.js` — `onGrid`/`stepFor` (~l.73-77), `finalizeDraft` (loads, fingerprint), `performedOf`, `ruleFrom` (sets cap), `checkDates` in `migrateProfileV1ToV2`, the `routineIds` readers, output `unit`.
- Test: `api/test/migration-audit.test.js`

**Interfaces:**
- Consumes: Task 1's `lastWorked(d)` (live-rule fingerprint is taken from the last session that was actually worked).
- Produces: `stepFor(loads, inc, unit)` signature unchanged. New `ctx.liftedLoads: Map<exerciseId, number[]>`. `migrationAudit.unsupported` may now contain `{ field: 'date', path, value }`.

- [ ] **Step 1: Flip and extend the tests**

In `api/test/migration-audit.test.js` remove the `{ todo: … }` option from the M1, M2, M4, M3, M6, M7 and M8 tests, then append:

```js
test('M2 (lb): the step also divides the increment in pounds (+5 lb on 135 lb stays on 140)', () => {
  const s = v1([{ id: BENCH, sets: 3, reps: 5, weight: 135, prog: 'linear' }], [wk('w1', '2026-01-01', [entry(BENCH, { sets: 3, reps: 5, weight: 135 }, [row(5, 135), row(5, 135), row(5, 135)], { sets: 3, reps: 5, weight: 135 })])], { unit: 'lb' });
  assert.equal(loadOf(nextPrescription(migrate(s).profile)), 140);
});

test('M6 (no fallback date): a workout with an empty d and no start still migrates and is audited', () => {
  const { profile } = migrate(v1([], [{ id: 'w1', d: '', entries: [] }, wk('w2', '2026-01-06', [])]));
  assert.equal(profile.workouts.length, 2);
  assert.ok(profile.migrationAudit.unsupported.some(u => u.field === 'date' && u.path === 'workouts[0].d'));
});

test('M13: an invalid root unit ("lbs") migrates as kg and the profile says kg', () => {
  const { profile } = migrate(v1([], [], { unit: 'lbs' }));
  assert.equal(profile.unit, 'kg');
});

test('M10: routineIds [] with a scalar routineId keeps the routine association', () => {
  const s = v1([{ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' }], [wk('w1', '2026-01-01', [entry(BENCH, { sets: 3, reps: 5, weight: 60 }, [row(5, 60), row(5, 60), row(5, 60)], { sets: 3, reps: 5, weight: 60 })], { routineIds: [] })]);
  assert.deepEqual(migrate(s).profile.workouts[0].routineIds, ['r1']);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && node --test test/migration-audit.test.js` — expected: the flipped M-tests and the four new ones fail (they no longer report as `todo`).

- [ ] **Step 3: Rounding step (M1, M2, M4)**

Replace `onGrid`/`stepFor`:

```js
// v1 addStep treats a load within 0.1 of the grid as on it (one-decimal storage: 21.25 → 21.3)
const near = (v, step) => Math.abs(v - Math.round(v / step) * step) <= 0.1 + 1e-9;
// A step must also divide the increment, or load + inc is rounded off the load v1 prescribed.
const divides = (step, inc) => !(inc > 0) || Math.abs(inc / step - Math.round(inc / step)) < 1e-6;
function stepFor(loads, inc, unit) {
  return [...(inc > 0 ? [inc] : []), ...STEPS[unit]].find(step => divides(step, inc) && loads.every(v => near(v, step))) ?? 0.001;
}
```

`migrateActive` calls `onGrid(w, step)` (`const fit = …`): replace `onGrid` there with `near` — grep `onGrid` to make sure no other caller remains, then delete it.

In `migrateProfileV1ToV2`, right after `ctx` is built, collect every load actually lifted (M4):

```js
  ctx.liftedLoads = new Map();
  for (const w of workouts) for (const entry of list(w.entries)) if (isObj(entry)) for (const row of list(entry.sets)) {
    if (isObj(row) && row.done && !isWarmupRow(row) && num(row.w) > 0) ctx.liftedLoads.set(String(entry.id), [...(ctx.liftedLoads.get(String(entry.id)) || []), num(row.w)]);
  }
```
and in `finalizeDraft` change the `loads` line to
`const loads = [d.cfg.weight, ...d.links.map(l => l.values.weight), ...(ctx.liftedLoads.get(d.exerciseId) || [])].map(num).filter(v => v > 0);`.

- [ ] **Step 4: Ladder fingerprint (M3)**

In `finalizeDraft`, before `d.links = d.links.filter(…)`:

```js
  // The fingerprint every unedited log is stamped with is the one the live rule will have — the ladder
  // once the last load is 0 — or the first session after the reach-zero log reads as `plan_changed`.
  const lastValues = lastWorked(d);
  const liveFingerprint = planFingerprint(d.ruleFor(lastValues?.weight != null ? { weight: lastValues.weight } : {}));
```
and replace `unedited ? planFingerprint(d.ruleFor({}))` with `unedited ? liveFingerprint`.

- [ ] **Step 5: Cardio (M7), sets cap (M8), routineIds (M10), unit (M13), dates (M6)**

`performedOf`: replace the `reps`/`durationSeconds` lines and add speed:

```js
    reps: num(row.sec) != null || num(row.min) != null ? null : sides ? … (unchanged) : num(row.r),
    durationSeconds: least('sec') ?? (least('min') != null ? least('min') * 60 : null),
    ...(num(row.speed) != null ? { speed: num(row.speed) } : {}),
```
(keep the existing `sides` expression for `reps`; only prepend the `min` test.) Check `summarizeActual` in `api/engine/*` reads `speed`; if it does not, drop the `speed` line — the test only asserts `incomplete` and `durationSeconds`.

`ruleFrom`: `const MAX_SETS = 50;` next to `MAX_BW_SETS`, and `p.sets = fixed(Math.min(MAX_SETS, whole(v.sets) ?? 1));`.

Routine ids: add `const routineIdsOf = w => (Array.isArray(w.routineIds) && w.routineIds.length ? w.routineIds : w.routineId != null ? [w.routineId] : []);` and use it in `linkOf` (replace its local `routineIds` expression) and in `migrateWorkout` (`routineIds: clone(routineIdsOf(w))`).

Unit: in the `profile` literal, after `...clone(rest),` add `unit,`.

Dates: replace `checkDates` and its two call sites with

```js
  const dateFixes = [];
  const badMs = v => num(v) == null || !Number.isFinite(new Date(num(v)).getTime());
  // v1 data we cannot date is repaired from its sibling field and audited, never allowed to block the upgrade.
  const fixDates = (w, path) => {
    const out = { ...w };
    for (const key of ['start', 'end']) if (out[key] != null && badMs(out[key])) { dateFixes.push({ field: 'date', path: `${path}.${key}`, value: clone(out[key]) }); delete out[key]; }
    if (out.d != null && !Number.isFinite(Date.parse(`${out.d}T00:00:00Z`))) { dateFixes.push({ field: 'date', path: `${path}.d`, value: clone(out.d) }); delete out.d; }
    return out;
  };
  state = { ...state, workouts: Array.isArray(state.workouts) ? state.workouts.map((w, i) => (isObj(w) ? fixDates(w, `workouts[${i}]`) : w)) : state.workouts };
  if (isObj(state.active)) state = { ...state, active: fixDates(state.active, 'active') };
```
(`state` is a parameter, so reassigning is fine; do it before `const workouts = records(state.workouts)`.) `whenOf`/`dayOf` already fall back to `start`/epoch when `d` is missing. Finally set `unsupported: [...ctx.unsupported, ...dateFixes]` in `migrationAudit`, and grep `unsupported` in `frontend/src/views/MigrationGate.jsx` / `Settings.jsx`: if it renders `exerciseId`, make it fall back to `path` for entries with `field === 'date'`.

- [ ] **Step 6: Run both suites**

Run: `cd api && node --test` → green, 0 todo left for M1–M4, M6–M8. `cd frontend && npm test` → green (the migration tests in `useStore.migration*.test.jsx` run the same code).

- [ ] **Step 7: Docs + commit**

Mark M1–M4, M6–M8, M10, M13 fixed in `REPORT.md` §1; in the migration note list M9, M11, M12 as accepted, documented differences (typed `rir` beside `rpe`, combined session without `rid`, timed-hold back-off run).

```bash
git add api/migration/profile-migration.js api/test/migration-audit.test.js docs/MIGRATION_TO_ENGINE_NOTE.md REPORT.md frontend/src/views
git commit -m "fix(migration): v1 rounding grid, ladder fingerprint, dates, unit and caps (M1-M4, M6-M8, M10, M13)"
```

---

### Task 3: Formato compatto del profilo — codec lossless (M5, parte 1)

**Perché un codec e non dati legacy.** Misure sulla fixture M5 (1000 sessioni × 6 esercizi, `$SCRATCH/size.mjs`):

| | byte |
|---|---|
| v1 | 2,29 MB |
| v2 oggi | 16,87 MB (`workouts` 9,68 + `prescriptions` 7,18) |
| solo chiavi corte con nomi leggibili in stile v1 (`obs`, `res`, `w`, `r`, `rid`, `xid`…; con 1 carattere sarebbero 12,50 MB) | 13,59 MB (−19 %) |
| + campi derivabili tolti dalle righe (`prescribed`, `segments: []`, `unit` delle osservazioni e della resistenza) | 14,77 MB (−12 % da solo) |
| + parte invariante delle prescrizioni scritta una volta per traccia (6 template = 5 KB, invece di 6000 copie da ~350 B) | prescrizioni 7,18 → 3,99 MB |
| **tutto insieme, con i nomi leggibili — codec già provato su questa fixture** | **8,94 MB (−47 %, 3,9× v1 invece di 7,4×), round trip identico, 6 template** (con chiavi da 1 carattere sarebbero 8,00 MB: la leggibilità costa 0,9 MB) |

Le sole chiavi corte non bastano (−19 %), ma insieme alla struttura dimezzano il documento senza perdere nulla: nessuna riga, prescrizione, `actual` o `audit` viene scartata, nessuna voce diventa legacy. Una prescrizione di una traccia varia solo per `id`, `generatedAt`, `parameters`, `basis`, `rows`, `contentHash`: il resto (`increment`, `rounding`, `special`, `deload`, `planFingerprint`, `preset`…) è identico in tutte.

**Dove sta il formato compatto.** Cambiare il formato canonico in memoria toccherebbe ~34 file che leggono `resistance`/`observations` e 12 che leggono `rows`/`prefill`. Il codec invece vive ai confini (disco, rete, localStorage): in memoria il profilo resta quello di oggi, quindi **il comportamento dell'app non cambia** e i lettori non si toccano. Il Task 4 collega il codec ai confini.

**Files:**
- Create: `api/migration/profile-pack.js`
- Modify: `api/migration/profile-size.js`
- Test: `api/test/profile-pack.test.js`

**Interfaces:**
- Consumes: `ENGINE_SCHEMA` da `api/migration/profile-version.js`.
- Produces: `packProfile(profile): object` e `unpackProfile(doc): object`. Un profilo v1 o già pacchettizzato passa invariato (`pack` agisce solo su `engineSchemaVersion === ENGINE_SCHEMA` senza `packed`; `unpack` solo se `doc.packed === 1`). `syncSize(state)` misura il corpo **già pacchettizzato**: è ciò che viaggia e che nginx conta.

Forma pacchettizzata: `{ ...root, packed: 1, templates: { <hash>: <blocco invariante> }, prescriptions: { <id>: { _t: <hash>, ...variabile, chiavi corte } }, workouts: [...chiavi corte, righe snellite] }`. `unpack` restituisce righe con i default riempiti (`prescribed = setId != null`, `segments: []`, unità di default): equivalente per ogni lettore (`segments` è opzionale per `profile-validation.js`, i lettori usano `?.length`), non identico bit a bit per le righe scritte dal vivo che non avevano quei campi.

- [ ] **Step 1: Scrivere i test (falliscono: il modulo non esiste)**

`api/test/profile-pack.test.js` — riusa la fixture M5 estraendola in una funzione (copia le helper `wk/entry/row/v1` di `migration-audit.test.js`, sono 6 righe) e verifica:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORT, packProfile, unpackProfile } from '../migration/profile-pack.js';
import { assertSyncSize, syncSize } from '../migration/profile-size.js';
import { validateCanonicalProfile } from '../migration/profile-migration.js';
// …helpers e `bigProfile()` = migrazione della fixture M5 (1000 × 6)…

test('round trip: unpack(pack(x)) is the same profile, and packing is idempotent', () => {
  const x = bigProfile();
  const once = unpackProfile(packProfile(x));
  assert.deepEqual(once, x);                                   // la migrazione scrive già i campi pieni
  assert.deepEqual(unpackProfile(packProfile(once)), once);
  assert.ok(validateCanonicalProfile(once).ok);
});

test('the M5 history fits the sync cap', () => {
  assertSyncSize(bigProfile());                                // era il todo di M5
  assert.ok(syncSize(bigProfile()) < 9.5 * 1024 * 1024);
});

test('rows with sides, drops, rest-pause clusters, lb unit and free-form subtrees survive', () => { /* profilo con: riga sides L/R, segments non vuoti, clusters, resistance.unit 'lb' con root unit 'lb', observation con metric sconosciuto, exposure.muscleSnapshot con chiave 'value' e 'a' */ });

test('a key that collides with a short name disables packing instead of corrupting', () => {
  const x = bigProfile(); x.workouts[0].exposures[0].performance.sets[0].obs = 1;   // 'obs' è un nome corto
  assert.equal(packProfile(x), x);
});

test('the dictionary is unambiguous: short names are unique and never equal a long name or a real v2 key', () => {
  const shorts = Object.values(SHORT);
  assert.equal(new Set(shorts).size, shorts.length);
  assert.ok(shorts.every(s => !(s in SHORT)));
  // a real profile must actually pack: a silent collision would only show up as a too-big sync body
  assert.notEqual(packProfile(bigProfile()), bigProfile());
});

test('v1 and already-packed documents pass through', () => {
  const v1 = { unit: 'kg', routines: [], workouts: [] };
  assert.equal(packProfile(v1), v1);
  const p = packProfile(bigProfile());
  assert.equal(packProfile(p), p);
  assert.equal(unpackProfile(v1), v1);
});
```
Nel test «survive» le asserzioni sono `deepEqual(unpackProfile(packProfile(x)), x)`; costruisci `x` partendo da una migrazione con `row(…, { sides: { L: …, R: … } })`, `{ type: 'dropset', drops: [...] }`, `{ type: 'restpause', clusters: [...] }` (stesse forme di `migration-audit.test.js`, test «no logged row is lost»).

- [ ] **Step 2: Verificare che falliscano**

Run: `cd api && node --test test/profile-pack.test.js` → FAIL (`Cannot find module`).

- [ ] **Step 3: Implementare `api/migration/profile-pack.js`**

```js
// Lossless storage/wire form of a canonical (engine v2) profile: the same data in shorter text.
// The in-memory profile never changes shape; this runs at the edges (disk, network, localStorage).
import { ENGINE_SCHEMA } from './profile-version.js';

// Short names in the spirit of v1's `r`, `w`, `rid`: readable in a file or a network trace. Append-only:
// a short name never changes meaning, so every stored document stays readable. Unlisted keys
// (id, min, max, role, mode, rir, rows, …) are already short and keep their name.
export const SHORT = {
  value: 'v', observations: 'obs', resistance: 'res', status: 'st', metric: 'met', unit: 'u', reps: 'r', load: 'w',
  kind: 'k', excludedFromProgression: 'excl', setId: 'sid', derivedFromOutOfPlan: 'oop', sets: 's', prescriptionId: 'pid',
  occurrenceId: 'oid', performance: 'perf', completedAt: 'at', generatedAt: 'gen', restSeconds: 'rest', sourceLogId: 'src',
  exposureId: 'xid', exerciseId: 'eid', parameters: 'par', expression: 'expr', provenance: 'prov', routineId: 'rid',
  resolved: 'rsv', position: 'pos', trackId: 'tid', prefill: 'pre', actual: 'act', audit: 'aud', basis: 'bas'
};
const LONG = Object.fromEntries(Object.entries(SHORT).map(([long, short]) => [short, long]));
// Free-form subtrees (user/catalogue keys): never renamed, in either direction.
const FREE = new Set(['muscleSnapshot', 'legacyTarget', 'legacyPlanned', 'sg', 'warmup', 'intensifier', 'clusters', 'note']);
// The part of a prescription that is the same for every log of a track.
const INVARIANT = ['planRuleId', 'planRuleRevision', 'planFingerprint', 'exerciseId', 'trackId', 'preset', 'assisted', 'statusAtGeneration',
  'snapshot1RM', 'increment', 'completion', 'rounding', 'special', 'deload', 'trainingMax', 'target'];
const OBS_UNIT = { repetitions: 'reps', duration: 's', speed: 'kmh' };

const without = (o, key) => { const { [key]: _, ...rest } = o; return rest; };
const rename = (v, map, strict) => Array.isArray(v) ? v.map(x => rename(x, map, strict))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => {
    if (strict && k in LONG) throw new Error('pack-collision');   // a real key equal to a short name
    return [map[k] ?? k, FREE.has(k) ? x : rename(x, map, strict)];
  })) : v;

const slimRow = (r, unit) => {
  let o = { ...r };
  if (o.prescribed === (o.setId != null)) delete o.prescribed;
  if (Array.isArray(o.segments)) { if (o.segments.length) o.segments = o.segments.map(s => slimRow(s, unit)); else delete o.segments; }
  if (o.observations) o.observations = o.observations.map(ob => (ob.unit === OBS_UNIT[ob.metric] ? without(ob, 'unit') : ob));
  if (o.resistance?.unit === unit) o.resistance = without(o.resistance, 'unit');
  if (o.sides) o.sides = { L: slimRow(o.sides.L, unit), R: slimRow(o.sides.R, unit) };
  return o;
};
const fatRow = (r, unit) => {
  const o = { ...r };
  if (!('prescribed' in o)) o.prescribed = o.setId != null;
  o.segments = Array.isArray(o.segments) ? o.segments.map(s => fatRow(s, unit)) : [];
  if (o.observations) o.observations = o.observations.map(ob => (ob.unit === undefined && OBS_UNIT[ob.metric] ? { ...ob, unit: OBS_UNIT[ob.metric] } : ob));
  if (o.resistance && o.resistance.kind === 'external-load' && o.resistance.unit === undefined) o.resistance = { ...o.resistance, unit };
  if (o.sides) o.sides = { L: fatRow(o.sides.L, unit), R: fatRow(o.sides.R, unit) };
  return o;
};
const mapRows = (workouts, fn, unit) => workouts.map(w => (Array.isArray(w.exposures)
  ? { ...w, exposures: w.exposures.map(x => (x.performance?.sets ? { ...x, performance: { ...x.performance, sets: x.performance.sets.map(r => fn(r, unit)) } } : x)) } : w));

// Saves happen on every tap, but the store replaces `workouts` / `prescriptions` only when they change:
// pack each by reference once. (ponytail: identity cache, no invalidation needed while they stay immutable.)
const memo = new WeakMap();
const once = (obj, key, make) => {
  const hit = memo.get(obj);
  if (hit?.key === key) return hit.value;
  const value = make();
  memo.set(obj, { key, value });
  return value;
};

function packPrescriptions(all) {
  const templates = {}, index = new Map(), prescriptions = {};
  for (const [id, p] of Object.entries(all)) {
    const block = Object.fromEntries(INVARIANT.filter(k => k in p).map(k => [k, p[k]]));
    const key = JSON.stringify(block);
    if (!index.has(key)) { index.set(key, index.size.toString(36)); templates[index.get(key)] = block; }
    prescriptions[id] = rename({ _t: index.get(key), ...INVARIANT.reduce(without, p) }, SHORT, true);
  }
  return { templates, prescriptions };
}

export function packProfile(profile) {
  if (profile?.engineSchemaVersion !== ENGINE_SCHEMA || profile.packed === 1) return profile;
  const unit = profile.unit === 'lb' ? 'lb' : 'kg';
  const workouts = profile.workouts || [], prescriptions = profile.prescriptions || {};
  try {
    return {
      ...profile, packed: 1,
      ...once(prescriptions, '', () => packPrescriptions(prescriptions)),
      workouts: once(workouts, unit, () => mapRows(workouts, slimRow, unit).map(w => (Array.isArray(w.exposures) ? { ...w, exposures: rename(w.exposures, SHORT, true) } : w)))
    };
  } catch (e) {
    if (e.message === 'pack-collision') return profile;
    throw e;
  }
}

export function unpackProfile(doc) {
  if (doc?.packed !== 1) return doc;
  const { packed, templates, ...rest } = doc;
  const unit = rest.unit === 'lb' ? 'lb' : 'kg';
  const prescriptions = Object.fromEntries(Object.entries(rest.prescriptions || {}).map(([id, p]) => {
    const { _t, ...own } = rename(p, LONG, false);
    return [id, { ...templates[_t], ...own }];
  }));
  return { ...rest, prescriptions, workouts: mapRows((rest.workouts || []).map(w => (Array.isArray(w.exposures) ? { ...w, exposures: rename(w.exposures, LONG, false) } : w)), fatRow, unit) };
}
```
Nota: `contentHash` si calcola su `canonicalJSON`, quindi l'ordine delle chiavi dopo `unpack` è irrilevante. Il dizionario `SHORT` è esportato per il test. `_t` è l'unica chiave che non compare nel canonico: `unpack` la consuma.

`api/migration/profile-size.js`:

```js
import { packProfile } from './profile-pack.js';
export const MAX_SYNC_BODY = 16 * 1024 * 1024;
// What actually travels (and nginx counts): the packed form.
export const syncSize = state => new TextEncoder().encode(JSON.stringify({ state: packProfile(state), baseRev: Number.MAX_SAFE_INTEGER })).byteLength;
export function assertSyncSize(state) {
  if (syncSize(state) > MAX_SYNC_BODY) throw new Error('profile-too-large');
}
```

- [ ] **Step 4: Eseguire**

Run: `cd api && node --test test/profile-pack.test.js` → PASS. Poi togliere `{ todo: … }` dal test M5 di `migration-audit.test.js` e `node --test test/migration-audit.test.js` → PASS. Se `deepEqual` del round trip fallisce su una forma reale (non sulla fixture), **non** togliere il campo dal codec: aggiungi il caso al test e rendi `fatRow` simmetrico.

- [ ] **Step 5: Commit**

```bash
git add api/migration/profile-pack.js api/migration/profile-size.js api/test/profile-pack.test.js api/test/migration-audit.test.js
git commit -m "feat(migration): lossless compact storage form of the v2 profile (M5)"
```

---

### Task 4: Collegare il codec ai confini (M5, parte 2)

Il profilo in memoria resta canonico; si pacchettizza solo quando esce dal processo e si spacchetta quando entra. Un solo punto per confine, tutti da sostituire con le stesse due funzioni.

**Files:**
- Create: `frontend/src/lib/state-codec.js`
- Modify: `api/server.js` (righe ~129, ~1741 letture; ~2156 scrittura; body di `PUT /api/data` e risposta di `GET /api/data`; `POST /api/data/migrate-engine-v2` ~2084)
- Modify: `frontend/src/store/useStore.js` (`localStorage` KEY: ~225, ~266, ~293, ~300, e ogni `JSON.stringify(S)` verso KEY/`SYNC_KEY`), `frontend/src/lib/mobile.js` (`nativeSave`/`nativeLoad`), `frontend/src/lib/api.js` (push/pull dello stato)
- Modify: `mcp/src/state.js:25`
- Test: `api/test/profile-pack.test.js` (round trip su disco), `frontend/src/lib/mobile-backup.test.js`, `frontend/src/store/useStore.migration*.test.jsx` (devono restare verdi)

**Interfaces:**
- Consumes: `packProfile`, `unpackProfile`, `syncSize` (Task 3).
- Produces: `frontend/src/lib/state-codec.js` esporta `stringifyState(S): string` (= `JSON.stringify(packProfile(S))`) e `parseState(raw: string): object` (= `unpackProfile(JSON.parse(raw))`, cattura gli errori come fa oggi il chiamante). Il file di stato sul server e quello del dispositivo sono pacchettizzati; **gli export di backup restano canonici** (portabili) e l'import accetta entrambe le forme.

- [ ] **Step 1: Test che falliscono**

In `api/test/profile-pack.test.js`: scrivere un profilo con la funzione di salvataggio del server e rileggerlo con quella di lettura (estrai in `server.js` `saveState(uid, state)` / `loadState(uid)` se non esistono già, esportandole per i test come fanno gli altri test di server) e verificare `deepEqual` col canonico + che il file su disco contenga `"packed":1` e sia < 9,5 MB per la fixture M5. In `frontend/`: un test su `state-codec.js` (`parseState(stringifyState(S))` deepEqual per un profilo con `workouts` migrati) e uno in `useStore.migration*.test.jsx` che, dopo `confirmMigration`, `localStorage.getItem('gym_state_v1')` contiene `"packed":1` e `useStore.getState().S` è canonico.

- [ ] **Step 2: Server**

- Lettura (`api/server.js:129` e `:1741`): `JSON.parse(fs.readFileSync(...))` → `unpackProfile(JSON.parse(...))`. Il `stateCache` (`:381`) tiene il canonico.
- Scrittura (`:2156`): `atomicWrite(stateFile(user.id), JSON.stringify(packProfile(body.state)))`.
- Ingresso: in `PUT /api/data`, subito dopo `readBody`, `body.state = unpackProfile(body.state)` **prima** di `assertSyncSize`/validazione/merge. Uscita: `GET /api/data` risponde col pacchettizzato; il client lo spacchetta in `api.js`.
- `POST /api/data/migrate-engine-v2` (`:2084`): `assertSyncSize(profile)` resta com'è (ora misura il pacchettizzato).
- `MAX_BODY` (`:76`) resta `MAX_SYNC_BODY`: il corpo che arriva è già quello compatto.

- [ ] **Step 3: Client**

Creare `frontend/src/lib/state-codec.js`:

```js
import { packProfile, unpackProfile } from '../../../api/migration/profile-pack.js'
export const stringifyState = S => JSON.stringify(packProfile(S))
export const parseState = raw => unpackProfile(JSON.parse(raw))
```
(stesso schema di import dell'engine in `frontend/src/lib/prescription/index.js`). Sostituire in `useStore.js` ogni `JSON.stringify(S)`/`JSON.parse(localStorage.getItem(KEY))` verso `KEY` (e verso la copia di sync) con le due funzioni; **non** toccare `LOCAL_BACKUP_KEY` (copia v1 intatta) né `ACTIVE_KEY`. Stessa sostituzione in `mobile.js` (`nativeSave`/`nativeLoad`/`nativeLoadText` consumer) e nel corpo/risposta di push/pull in `api.js`. `buildProfileBackup` (`export-profile.js`) non cambia.

- [ ] **Step 4: MCP**

`mcp/src/state.js:25`: `unpackProfile(JSON.parse(...))` con `import { unpackProfile } from '../../api/migration/profile-pack.js'`. Il server MCP gira dal checkout, non dall'immagine Docker (vedi CLAUDE.md): verificare con `cd mcp && npm test`. Se qualcuno lancia l'MCP da un pacchetto separato, il file di stato pacchettizzato è comunque leggibile perché il formato è documentato nel commento di `profile-pack.js`.

- [ ] **Step 5: Eseguire tutto**

`cd api && node --test`, `cd frontend && npm test`, `cd mcp && npm test` → verdi. Avvio manuale facoltativo (`docker compose up -d --build`): migrare un profilo, ricaricare, controllare che `data/state-<uid>.json` contenga `"packed":1` e che l'app mostri la stessa storia.

- [ ] **Step 6: Doc e commit**

`docs/SELF_HOSTING.md` (il file di stato ora è compatto, i backup restano leggibili) e `docs/MIGRATION_TO_ENGINE_NOTE.md`; `REPORT.md`: M5 risolto sul fronte sync (tetto ≈ 1.800 sessioni × 6 esercizi, da ≈ 950). **Resta aperto, e va detto nel REPORT**: la quota `localStorage` (~5 MB) per ospiti web — 9 MB per 1000 sessioni la supera ancora (a ~550 sessioni); gli utenti con account hanno la copia sul server, gli ospiti Capacitor il file nativo. Se serve chiuderla: gzip nativo (`CompressionStream`, 345 KB per la stessa fixture) o IndexedDB, come lavoro separato.

```bash
git add api/server.js frontend/src mcp/src api/test docs REPORT.md
git commit -m "feat(sync): store and send the v2 profile in its compact form (M5)"
```

---

### Task 5: Progressione come in v1, con dati migrati (P2, P3, P4)

**Principio.** Nessun dato legacy: la storia v1 viene **convertita** (prescrizioni congelate, `actual`, stato seminato da `seedProgression`) e il motore, letto da quei dati, deve proporre ciò che proponeva v1. Il comportamento dell'app non cambia: si correggono le tre regole del motore dove divergono da v1 e si prova la parità **sui profili migrati**, non solo sulle sessioni vive. Perché i dati convertiti bastino senza campi nuovi: la prescrizione migrata ha già `prefill.sets/reps` = ciò che v1 chiedeva (target), `actual.load`/`performance.sets` = ciò che è stato sollevato, e `seedProgression` fa girare `advanceProgression` su ogni sessione, quindi lo stato nuovo (`stallBest`) si semina da solo.

**Files:**
- Modify: `api/engine/advance.js` (`hit`, `initialProgressionState`, blocco stall)
- Modify: `api/engine/generate.js` (`increments`, `climb`, `prefill`)
- Modify: `api/engine/context.js` (esporta `bestLoad`)
- Modify: `api/migration/profile-validation.js` / `api/engine/canonical.js` solo se hanno una whitelist delle chiavi di `ProgressionState` (`grep -n stalls`)
- Test: `frontend/src/lib/engine-audit.test.js` (P2–P4 vive), `api/test/migration-audit.test.js` (parità su profili migrati), test esistenti in `frontend/src/lib/prescription/` e `api/test/` che codificano il vecchio comportamento

**Interfaces:**
- Consumes: Task 1 (una sessione senza lavoro non avanza la traccia).
- Produces: `ProgressionState.stallBest: number|null` (solo `double`); `hit(p, a)` senza confronto di carico; `bestLoad(log, assisted): number|null` esportata da `context.js` = il carico di lavoro completato più pesante della sessione (più leggero su una macchina assistita), con ripiego su `log.actual.load` per i log senza righe. Il carico successivo dopo un incremento guadagnato parte da `bestLoad`, come `readSession.weight` in v1.

- [ ] **Step 1: Test del motore (falliscono)**

In `frontend/src/lib/engine-audit.test.js` trasforma tutti gli `it.fails(` in `it(`, aggiorna il commento d'intestazione, e aggiungi:

```js
describe('P3 — a stagnating double still deloads', () => {
  it('three sessions at the same short reps deload', () => {
    const S = profile(), occ = double(50)
    for (const day of [0, 1, 2]) finish(S, start(S, occ, day), day, rows => { doAll(rows); rows.forEach(s => { s.r = 5 }) })
    expect(prescriptionOf(S, start(S, occ, 3)).parameters.load.resolved.value).toBeLessThan(50)
  })
})
describe('P4 — mixed loads in one session', () => {
  it('60, 60, 50 continues from the heaviest set (v1: 62.5)', () => {
    const S = profile(), occ = linear(60)
    finish(S, start(S, occ, 0), 0, rows => { doAll(rows); rows.forEach((s, i) => { s.w = i === 2 ? 50 : 60 }) })
    expect(prescriptionOf(S, start(S, occ, 1)).parameters.load.resolved.value).toBe(62.5)
  })
})
```
Run: `cd frontend && npx vitest run src/lib/engine-audit.test.js` → 7 falliscono (il «stagnating» passa già).

- [ ] **Step 2: Test di parità sui profili migrati (falliscono)**

In `api/test/migration-audit.test.js` aggiungi, con le helper già presenti (`v1`, `wk`, `entry`, `row`, `migrate`, `nextPrescription`, `loadOf`), una sezione «parity with v1 on a migrated history». **Valori attesi presi da v1, non dal motore v2**: estrai v1 in una cartella temporanea e calcola una volta i numeri.

```bash
SCRATCH=<scratchpad>; git archive main frontend/src | tar -x -C $SCRATCH
# poi uno script che importa $SCRATCH/frontend/src/lib/progression.js e chiama
# nextPrescription(S, cfg, routine) sui profili v1 qui sotto (vedi REPORT.md §4, "Method")
```
Casi (storia v1 → prossima sessione di v1, tabella del REPORT §4):

| storia v1 (linear, +2,5, plan 60×5) | atteso v1 |
|---|---|
| sollevato 70 × 5 pulito su target 60 | peso 72,5 |
| sollevato 50 × 5 pulito su target 60 | peso 52,5, nessuno stallo |
| set 60, 60, 50 nella stessa sessione | peso 62,5 |
| ladder (trazioni): 3 set prescritti, ultimo non fatto | 3 set |
| ladder: reps 10, 10, 4 | stesso target (10) |
| double 50 kg, mira 8: minime 5, 6, 7 in tre sessioni | peso 50 (nessun deload), mira 8 |
| double: minima 9 su mira 10 | mira 10 |

Se v1 contraddice il REPORT, vince v1: correggi il numero e la riga del REPORT. Ogni caso: `migrate(v1(...)).profile` → `nextPrescription(profile)` → `assert.equal(loadOf(p) | p.prefill.reps | p.rows.length, atteso)`. Le entry hanno `target` e `planned` come nei test M1–M4 così da essere *collegate* (convertite), non legacy.
Run: `cd api && node --test test/migration-audit.test.js` → i casi P2–P4 falliscono.

- [ ] **Step 3: P4 — il carico sollevato è la base (`context.js`, `advance.js`, `generate.js`)**

`context.js`:

```js
/** The heaviest completed work load of a log (the lightest, on an assistance machine): v1's readSession.weight. */
export function bestLoad(x, assisted) {
  const loads = (x?.performance?.sets || []).filter(r => isWork(r) && r.resistance?.kind === 'external-load').map(r => r.resistance.value)
  return loads.length ? (assisted ? Math.min(...loads) : Math.max(...loads)) : x?.actual?.load?.value ?? null
}
```
(esportala anche da `api/engine/index.js`). `advance.js` — `hit` giudica set e ripetizioni, come v1:

```js
// At least what was prescribed, on the rows that decide: sets and reps (or seconds), as v1 judged a
// session. The load lifted is not part of it — generate.js builds the next load from what was lifted.
function hit(p, a) {
  const rows = decidingRows(p)
  const actual = targetActual(p, a)
  if (a.incomplete) return false
  return a.sets >= Math.max(p.parameters.sets.min, p.rows.length) && actual != null && actual >= Math.min(...rows.map(r => targetRange(p, r).min))
}
```
`generate.js` — importa `bestLoad` da `./context.js` e sostituisci `if (increments) expression = applyIncrement(...)` con:

```js
  if (increments) {
    const lifted = bestLoad(lastLog, assisted)
    if (expression.mode === 'absolute' && lifted > 0) expression = { ...expression, value: lifted }
    expression = applyIncrement(expression, { ...rule.increment, value: rule.increment.value * (state?.incrementMultiplier ?? 1) }, { snapshot1RM, resolvedTarget: target.resolved?.value ?? null, assisted })
  }
```
Il deload (`deloadedLoad`, riga `lifted: lastLog?.actual?.load?.value`) non cambia.

- [ ] **Step 4: P3 — double (`advance.js`, `generate.js`)**

`advance.js`: aggiungi `stallBest: null` a `initialProgressionState` e sostituisci il corpo del blocco `if (DELOAD_GATES.includes(gate))` (tenendo il commento esistente):

```js
    const missed = !hit(p, log.actual)
    const at = gate === 'seconds' ? p.parameters.durationSeconds?.min ?? null : log.actual.load?.value ?? p.parameters.load.resolved?.value ?? null
    const got = targetActual(p, log.actual)
    const sameRun = missed && base.stalls > 0 && base.stallLoad === at
    // v1 stallCount (!93): at one weight, beating the best of the run is progress, not a stall.
    const improved = p.preset === 'double' && sameRun && got != null && got > (base.stallBest ?? Infinity)
    next.stalls = !missed ? 0 : sameRun ? base.stalls + (improved ? 0 : 1) : 1
    next.stallLoad = missed ? at : null
    next.stallBest = missed ? (sameRun ? Math.max(base.stallBest ?? 0, got ?? 0) : got ?? null) : null
    next.readyToDeload = missed && !!p.deload && next.stalls >= p.deload.after
```
`generate.js`: il double sale dall'ultimo risultato dopo qualunque sessione (v1: `low + 1`), con la mira dentro la finestra:

```js
  const climb = !reset && carry && !deload && !increments && !!state && (rule.preset === 'double' || (unnamedLadder && state.clean))
  let climbedReps = Math.max(p.reps.min, Math.min(p.reps.max, (last.reps ?? p.reps.min) + (perSide ? 2 : 1)))
```
`stallBest` è seminato da `seedProgression` perché passa da `advanceProgression`: nessuna modifica alla migrazione.

- [ ] **Step 5: P2 — ladder (`generate.js`)**

Sopra `const prefill`:

```js
  // An unclean ladder session asks for the same thing again (v1 `reached`): sets and reps are what was
  // prescribed, not the weakest set that was managed. The athlete's own `startFrom: 'last'` still wins.
  const asked = rule.preset === 'bodyweight_ladder' && fromLast && !climb && startFrom !== 'last' ? lastPrescription?.prefill : null
```
e in `prefill`: `sets: climb ? climbedSets : asked?.sets ?? (fromLast ? (last.sets || p.sets.min) : p.sets.min)`, `reps: climb ? climbedReps : deload?.reps ?? asked?.reps ?? (fromLast ? (last.reps ?? p.reps.min) : p.reps.min)`.

- [ ] **Step 6: Eseguire e sistemare i collaterali**

`cd frontend && npm test` e `cd api && node --test`. Attesi: aggiornare (uno per uno, elencandoli nel corpo del commit) i test che codificano «carico minore ⇒ mancato» o «incremento dal carico prescritto» in `frontend/src/lib/prescription/{advance,generate,context,deload}.test.js` e `api/test/*`; ogni altro rosso è un bug reale: si corregge il codice. `hit` cambia per tutti i preset (piramidi comprese, nuove in v2 e senza controparte v1): controllare che nessun test di piramide dipenda dal carico dell'ancora.

- [ ] **Step 7: Doc e commit**

`docs/MIGRATION_TO_ENGINE_NOTE.md` §6: riscrivi gli esempi senza assumere sollevato = target e aggiungi il caso 60 → 70 ⇒ 72,5; segna P2–P4 risolti in `REPORT.md`.

```bash
git add api/engine frontend/src/lib/engine-audit.test.js frontend/src/lib/prescription api/test docs/MIGRATION_TO_ENGINE_NOTE.md REPORT.md
git commit -m "fix(engine): v1 progression semantics for ladder, double and lifted load, proven on migrated history (P2-P4)"
```

---

## Self-Review

- **Coverage:** P1 (Task 1), M1–M4/M6–M8/M10/M13 (Task 2), M5 (Tasks 3–4), P2–P4 (Task 5). Non corretti, da documentare: M9, M11, M12 (differenze minori accettate). Aperto e dichiarato: quota `localStorage` degli ospiti web (Task 4, step 6).
- **Nessun legacy:** Task 1 converte ed esclude; il vecchio ripiego «demozione a legacy» (compattazione per traccia) è stato rimosso; Task 5 prova la parità su profili migrati.
- **Coerenza dei nomi:** `lastWorked` (Task 1→2), `packProfile`/`unpackProfile`/`syncSize` (Task 3→4), `stringifyState`/`parseState` (Task 4), `bestLoad`/`stallBest` (Task 5) sono definiti prima di essere usati.
- **Rischi:** il codec cambia il file di stato su disco (letto da server, MCP, client): per questo l'unpack è l'identità sui documenti non pacchettizzati e i test coprono i confini. Task 5 cambia `hit` per ogni preset: i test collaterali si rivedono uno per uno.
