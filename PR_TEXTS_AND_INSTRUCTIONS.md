# Split of #312: PR texts and instructions

Three stacked PRs replace #312. All three are pushed to the fork `giulioleuci/openGym-contrib`
and all target upstream `DuarteSantos8/openGym` `main`.

| PR | Branch | Tip | Open as |
|---|---|---|---|
| 1 | `pr1-engine-dual-format` | `c2396328` | ready for review |
| 2 | `pr2-api-v2-activation` | `5ff62133` | draft |
| 3 | `pr3-editor-failure-templates` | `4263623d` | draft |

**Author.** Open all three from the `giulioleuci` GitHub account. The commits are authored by
`giulioleuci <leuci.giulio@gmail.com>` (11) and Rick Li `<13340631+rickdiculousli@users.noreply.github.com>`
(5, cherry-picked with `-x`, his authorship kept). No commit or text below carries a Claude
co-author, session or "Generated with" line; keep it that way when you edit, or the CLA bot rejects.

## Before you open anything

- **Decide on `REPORT.md`.** It is the internal audit from #312 (verdict "not yet absolutely
  robust") and lands in the repo root through PR 2. To drop it:
  ```bash
  git -C openGym-motore-generico switch pr2-api-v2-activation
  git -C openGym-motore-generico rm REPORT.md
  git -C openGym-motore-generico commit -m "chore: drop the internal audit report"
  git -C openGym-motore-generico rebase --onto pr2-api-v2-activation 5ff62133 pr3-editor-failure-templates
  git -C openGym-motore-generico push --force-with-lease origin pr2-api-v2-activation pr3-editor-failure-templates
  ```
  Then use the new tips in the "review only the commits after" lines below.

## Steps

1. **PR 1.** Open
   <https://github.com/DuarteSantos8/openGym/compare/main...giulioleuci:openGym-contrib:pr1-engine-dual-format>.
   Paste the PR 1 title and body below. Create it as a normal PR. Note its number.
2. **PR 2.** Open
   <https://github.com/DuarteSantos8/openGym/compare/main...giulioleuci:openGym-contrib:pr2-api-v2-activation>.
   Paste the PR 2 title and body, replacing `#PR1` with PR 1's number. Choose **Create draft
   pull request**. Note its number.
3. **PR 3.** Open
   <https://github.com/DuarteSantos8/openGym/compare/main...giulioleuci:openGym-contrib:pr3-editor-failure-templates>.
   Paste the PR 3 title and body, replacing `#PR1` and `#PR2` with their numbers. Create it as a
   draft.
4. **Fill in the forward links.** PR 1's body names `#PR2` and `#PR3`, and PR 2's names `#PR3`;
   those numbers only exist now. Edit both bodies and replace them.
5. **#312.** Post the comment at the end of this file on #312 (replace the three numbers), then
   close #312.
6. **CLA.** If the CLA bot comments on a new PR, sign it from the `giulioleuci` account.
   If the bot also lists Rick Li, his commits need his own signature: ask him on the PR.
7. **Tell me the PRs are open.** I then delete the local `split/1`, `split/2`, `split/3`,
   `split/full` and `split/reorder` branches (never pushed).

GitHub shows all of PR 1's commits inside PR 2, and PR 1 + PR 2 inside PR 3, because a fork
cannot target another fork's branch. The "review only the commits after" line in each body
tells reviewers where their part starts.

## After each merge

When PR 1 merges (same for PR 2, then PR 3):

```bash
cd openGym-motore-generico
git fetch https://github.com/DuarteSantos8/openGym.git main
git rebase --onto FETCH_HEAD c2396328 pr2-api-v2-activation          # c2396328 = PR 1's tip
git rebase --onto pr2-api-v2-activation 5ff62133 pr3-editor-failure-templates   # 5ff62133 = PR 2's old tip
git push --force-with-lease origin pr2-api-v2-activation pr3-editor-failure-templates
```

Then edit PR 2's body: drop the "Depends on" line and mark it **Ready for review**. If upstream
squash-merges PR 1, the `--onto … c2396328` form above is still right: it replays only PR 2's
own commits.

## Known CI state

- The `build-api-docs.mjs --check` step (GitHub `test.yml`, GitLab) fails on upstream `main`
  too: the generator writes `v=27`, every page says `v=28`. The split keeps `v=28`, so that step
  stays as red as it is on `main`.
- Not run locally: the Docker image build-and-boot jobs and Node 22 (local runs used Node 20).

---

## PR 1

**Title**

```
feat(engine) [1 of 3]: deterministic prescription engine, v1 → v2 converter and dual-format readers
```

**Body**

```markdown
**Part 1 of 3.** This PR, #PR2 and #PR3 replace #312, which was split into three at @DuarteSantos8's request to make it easier to review. **They must be reviewed and merged strictly in order: this one first, then #PR2, then #PR3.** Each one builds on the one before.

## Scope

- `api/engine/`: the v2 training engine, pure and runtime-neutral (rules, programs, load, warm-ups, deload, audit, prescription generation, progression advance), with its unit and golden tests in `frontend/src/lib/prescription/`.
- `api/migration/`: the v1 → v2 profile converter (`profile-migration.js`), the compact storage pack, and the size and validation checks, with tests in `api/test/`.
- `frontend/src/lib/state-codec.js`: wraps the storage pack for the device copy. It is wired in PR 2.
- Readers that only need a workout's entries go through `legacyEntriesOf`. It returns a v1 workout's entries unchanged and reads a v2 workout's exposures back in the same shape. Converted: effort, muscles, recovery, FIT export, Health Connect, Coach cohort, Structural Balance, the share card, Library usage.
- `api/Dockerfile`, `web/Dockerfile`, `.gitlab-ci.yml` and `api/scripts/check-core-loadable.mjs` list `api/engine` and `api/migration`.

**Nothing in the app calls the engine or the converter yet.** The store, the API, the workout screen and the finish path still run on v1 (`progression.js`, `finish-workout.js`), and no request carries the engine schema header. A v1 profile behaves exactly as on `main`.

Changes from the split proposal: the active-workout split (`gym_active_v1`) and the store's codec wiring moved to PR 2. In the code they are tied to the migration gate, so a v1-only version would have been new code.

Shims: none.

## Review fixes folded in (from @rickdiculousli's review of #312)

- Readers still on `w.entries` went blank after the migration (Structural Balance, share card, Library usage): [comment](https://github.com/DuarteSantos8/openGym/pull/312#issuecomment-6158695197). Rick's commit is cherry-picked with his authorship. Each reader has a test on a migrated workout, plus one added for Structural Balance's weigh-in check.

## Checks

`cd frontend && npm test` · `npm run build` · `node scripts/check-locales.mjs` · `node scripts/check-source-strings.mjs` · `cd api && npm test` · `cd mcp && npm test && npm run check:node-loadable` · `node api/scripts/check-core-loadable.mjs` · `node scripts/build-coach-assets.mjs --check`, all green. `build-api-docs.mjs --check` fails on `main` too (the generator writes `v=27`, the pages say `v=28`); not touched here.
```

## PR 2 (draft)

**Title**

```
feat(engine) [2 of 3]: activate v2, API migration endpoint and legacy cleanup
```

**Body**

```markdown
**Part 2 of 3.** This PR, #PR1 and #PR3 replace #312, which was split into three at @DuarteSantos8's request to make it easier to review. **They must be reviewed and merged strictly in order: #PR1, then this one, then #PR3.** Each one builds on the one before.

**Depends on #PR1; review only the commits after `c2396328`.** Draft until #PR1 merges, then rebased onto `main`.

## Scope

- The app runs on the engine from PR 1. A profile carries `engineSchemaVersion: 2`. Starting a session freezes one prescription per occurrence (`session-start.js`, `session-ui-adapter.js`). Finishing it logs exposures and advances each track (`finish-session.js`).
- The store keeps the workout in progress in its own key (`gym_active_v1`, mirrored to its own file on the phone) and writes the device copy through `state-codec`. `pushState` sends `X-OpenGym-Engine-Schema`.
- A v1 profile is converted once, automatically at launch, behind a progress-only `MigrationGate`. The browser and the phone keep their untouched v1 copy. The server converts its own file through `POST /api/data/migrate-engine-v2`, keeping `state-<uid>.pre-engine-v1.json`. `engineGate` answers `409 migration-required` / `409 upgrade-required`.
- `progression.js` and `finish-workout.js` are removed, and `no-legacy-progression.test.js` keeps them out. The Coach, stats, plan share, history import, FIT, Health Connect, the watch and widgets, and the MCP server read the v2 shape. `docs/MIGRATION_TO_ENGINE_NOTE.md` documents both data models.
- What v1.4.2 added on the v1 model is carried over to v2.

Shims from PR 1 removed here: none (PR 1 adds none).

## Review fixes folded in (from @rickdiculousli's review of #312)

| Finding | Fix |
|---|---|
| [Critical: tab join reads the packed saved copy raw](https://github.com/DuarteSantos8/openGym/pull/312#discussion_r4265751535) | Rick's commit, cherry-picked |
| [Critical: header missing from the CORS preflight](https://github.com/DuarteSantos8/openGym/pull/312#discussion_r4265771030) | Rick's commit, cherry-picked. The header name is one constant (`ENGINE_SCHEMA_HEADER`) read by `api.js`, the preflight and `engineGate` |
| [High: a v1 doc from an old API gets adopted as v2](https://github.com/DuarteSantos8/openGym/pull/312#discussion_r4265771131) | Rick's commit, cherry-picked |
| [High: one v1 write after a failed attempt locks the migration out](https://github.com/DuarteSantos8/openGym/pull/312#discussion_r4265771214) | A v1 source that differs from the first backup is backed up beside it (`.r<rev>` on the server, `.t<ts>` on the browser and phone copies, an equal or missing stamp included). The browser keeps only the newest `.t` copy. A non-v1 or newer backup is still refused. `profile-too-large` is refused before any backup is written |
| [High: `engineGate` parses the state file on every poll](https://github.com/DuarteSantos8/openGym/pull/312#discussion_r4265771337) | The gate reads the stat cache, so a poll costs a stat. The cache key gains the inode, so a file renamed over the state is read again. PUT keeps its second gate call after the body (it stops a slow old-client upload from landing over a completed migration), and that call is a stat now too |
| [High: CSV/Hevy history import mangles every duration](https://github.com/DuarteSantos8/openGym/pull/312#discussion_r4265771424) | Rick's commit, cherry-picked, plus an RIR round-trip test |
| [High: Hevy routine import turns cardio into "1 × 8 reps"](https://github.com/DuarteSantos8/openGym/pull/312#discussion_r4265771542) | Cardio gets the rule and the cardio block the migration writes. A timed hold gets `mode: 'time'` |

Also from the split's own review: deleting an account now removes its `state-<uid>.pre-engine-v1*.json` backups, and the migration note, the API reference and its rollback steps describe the backup rule above.

Each fix has a test that fails without it.

## Checks

Same as PR 1, all green.
```

## PR 3 (draft)

**Title**

```
feat(engine) [3 fo 3]: routine editor redesign, sets to failure, five new templates and the 1RM blend
```

**Body**

```markdown
**Part 3 of 3.** This PR, #PR1 and #PR2 replace #312, which was split into three at @DuarteSantos8's request to make it easier to review. **They must be reviewed and merged strictly in order: #PR1, then #PR2, then this one.** Each one builds on the one before.

**Depends on #PR2; review only the commit after `5ff62133`.** Draft until #PR2 merges, then rebased onto `main`.

## Scope

- Routine editor redesign: the routine page and the exercise sheet follow the redesign mock (tabs, summary views, muscle distribution), with the rule editor (`RuleEditor.jsx`) on the sheet.
- Sets to failure: any sets, not only the last (a list of set numbers or all of them; `failure-selection.js`, `FailureSets.jsx`). Shared plans carry the choice.
- Five new progression templates (`top_set_backoff`, `accumulation_intensification`, `density`, `double_controlled`, `undulating`) and refined presets.
- 1RM: the blend of the formulas as the default estimate, with a low–high range beside every estimate.
- Locale keys (18 locales) and docs for these features.

No review fixes are expected here; all of them landed in PR 1 and PR 2.

With this PR merged, `main` matches #312 plus the review fixes. Supersedes #312.

## Checks

Same as PR 1, all green.
```

## Comment for #312

```markdown
@DuarteSantos8 as you asked, I've split this PR into three smaller ones so it's easier to review:

1. #PR1 — the training engine, the v1 → v2 converter and the readers that understand both formats. Nothing is wired in yet, so a v1 profile behaves exactly as on `main`.
2. #PR2 (draft) — switches the app to v2: the automatic migration at launch, the server's migration endpoint and the engine-schema gate, and the removal of the old progression code.
3. #PR3 (draft) — the routine editor redesign, sets to failure, the five new progression templates and the 1RM blend.

They're stacked. Each one passes the test suites on its own. Because a fork can't target another fork's branch, GitHub shows the earlier PRs' commits inside the later ones; each description says which commit its own part starts after. When one merges, I'll rebase the next onto `main` and mark it ready for review.

Every finding from @rickdiculousli's review is fixed in the PR that owns that code, each with a test that fails without the fix, and his five commits keep his authorship. Once all three are merged, `main` matches this PR plus those fixes.

I'm closing this PR in favour of the three above. Thanks!
```
