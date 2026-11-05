# Migration to the v2 training engine: programmes, contract 1

## Programmes, contract 1

A v2 profile (`engineSchemaVersion: 2`) carries a second marker, `engineContractRevision`. A
profile without it is contract 0: its `S.programmes` and `S.programme` are still the shapes of
`frontend/src/lib/programmes.js`. Contract 1 stores them as engine definitions and runs. The
upgrade is `upgradeEngineContract(state, catalogue)` in `api/migration/programme-upgrade.js`, run
at the end of `migrateProfileV1ToV2`, so a v1 profile goes straight to contract 1. A contract-0
v2 profile is upgraded on its own (`migrationStatus(state).contractRequired`). Constants:
`ENGINE_CONTRACT = 1` and the header `X-OpenGym-Engine-Contract` (`profile-version.js`).

The upgrade is pure and deterministic. It reads no clock: "now" is the newest date in the profile
(its last workout, the run's start or pause). Every id comes from a source id: track
`t:<programme>:<occurrence>`, stage `s<week>`, run `run:<programme>:<startedOn>:<cycle>`,
events `<run>:pause` and `<run>:assign:<exposure>`. A contract-1 profile is returned as it is. The
output must pass `validateCanonicalProfile`, fit the 16 MiB packed sync limit and replay with
`deriveRun`, or the upgrade throws and the input stays as it was.

### Mapping

| Today | Contract 1 |
| --- | --- |
| `days` | `schedule: { mode: 'weeks', appts }` in the week's order, `day` kept as a label (never a deadline) |
| `sequence` (a loop counted in calendar weeks) | one appointment per routine of the loop each week, `needs: ['binding']`: a new start chooses appointments per week or a free rotation counted in rounds |
| each occurrence of a scheduled routine | its own track `t:<pid>:<oid>` with one stage per week, `s1` to `s<n>`; tracks are never linked |
| `t[exId].pct` on reps work with an external load | `own: 'set'`: the occurrence's phase at `percent_1rm`, its steps removed; `t['rid:exId']` replaces `t[exId]` whole |
| a %1RM on a rule whose groups are anchor percentages (pyramid, top set and back-off) | the same, the group ratios kept |
| a %1RM on training-max groups or explicit per-set loads | `own: 'inherit'`, the programme `needs: ['repair']` (summary reason `training-max` or `group-loads`) |
| a %1RM on bodyweight, assisted or timed work | `own: 'inherit'` (legacy ignored it) |
| `rpe` of the week or of the exercise | `effort: { mode: 'advisory', rpe }`, the exercise's first |
| an empty week | `own: 'inherit'`; after a fixed week its steps come back at a declared seed: the load where the ordinary track stands, the other metrics copied from the fixed week |
| `deload: true` with a %1RM | `kind: 'recovery', close: 'calendar'`, the percentage as authored, no further factor |
| `deload: true` without a %1RM | `kind: 'recovery', close: 'calendar'`, `own: 'inherit'` with `deload: { factor: 0.9 }` where a load is scaled (reps work under an external load), without one elsewhere |
| a routine kept out of progression | no track: it never took programme targets |
| a running `S.programme` | `S.programmeRuns[run:<pid>:<startedOn>:<cycle>]` with the definition (the run's bump applied), `policy: advance/advance`, `ack: 'legacy'`, `end: 'stop'`, references captured with `currentOneRm`, seeds from the ordinary tracks, `legacy.weekOffset` = weeks already spent; `S.programme = { runId, saved }` |
| `pausedOn` | a `pause` event at that date; the run starts in the paused week |
| a run past its last week | `legacy.weekOffset` = every week: the run reads as stopped |
| this week's sessions logged before the upgrade | `assign` events, each session once, earliest first, only onto appointments of its own routine; listed in the summary as `credit` |
| `cycle`, `bump` | kept on the run; the bump is added to its percentage stages only (capped at 110), never to kg, reps, seconds or group ratios |
| an occurrence whose own rule needs a 1RM | `occurrence.ref = currentOneRm(...)`, else `reference-missing` in the summary |
| a run whose programme is gone | `S.programme = { runId: null, saved }`: only the plan to put back |
| prescriptions, exposures, hashes, progression, 1RM records, Coach history | untouched |

### Legacy labels

The old calendar never held a week back, so a converted run keeps advancing after a failed or a
skipped week. That choice is stored as `ack: 'legacy'` on every run track, never as `'user'`: the
adoption notice (`summary` kind `legacy-choices`) shows it as preserved legacy behaviour, and a new
start asks for both choices. The end policy is `stop`, as the old programme was done after its last
week. The reference preference is the Config one (`S.refUpdates`, default ask); no reference
decision, review or acknowledgement is created.

### What cannot be recovered

- Which 1RM a past %1RM session was computed from: the old app read the best estimate of that day
  and stored none. Those sessions keep their own frozen prescriptions; the run captures the current
  1RM as its reference from now on.
- Whether a past week succeeded: weeks before the upgrade are counted as spent
  (`legacy.weekOffset`), never replayed as successes, failures or skips.
- Progression earned inside a %1RM week: the old policy stepped on from the weight lifted there.
  A converted inherited week after a fixed one opens where the ordinary track stood at the upgrade.
- Without a 1RM, a %1RM week fell back to the policy's weight. Now it waits for a reference
  (`reference-missing` in the summary) instead of guessing a load.
- A loop has no weekly appointments of its own: the conversion owes each of its routines once a
  week until the user binds it (`needs: ['binding']`).
- Programme entries the old app already ignored (no id) are not converted; the backup taken before
  the upgrade keeps them.
