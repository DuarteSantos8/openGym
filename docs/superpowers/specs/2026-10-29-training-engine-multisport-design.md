# Design: metrics, structured sessions, and adaptive progression in engine v2

Date: 2026-10-29

Status: draft for design approval. This document specifies future behavior; it does not implement it.

Repository: `openGym-motore-generico`. Baseline inspected: `91d601a74`, branch `pr3-editor-failure-templates`.

## 1. Intent and accepted scope

Extend the existing training engine so presets can express more sports, more varied sessions, and different progression policies within one exercise, while retaining deterministic prescriptions and readable history.

The user selected proposals 3, 4, 5, 7, and 8 from the preceding discussion and requested a specification for the five delivery milestones below. Only those capabilities are included. No alternative feature proposals are part of this design.

| Milestone | Accepted capability | Result |
| --- | --- | --- |
| A | Semantic versioning, stable identity, and decision explanations | An explicit foundation for compatible extensions |
| B | General metrics and personal reference values | Relative prescriptions that work across sports |
| C | Results and progression state per set group | Independent progression within one exercise |
| D | Ordered session blocks, finite repetition, and explicit recovery | Intervals, circuits, and fixed-start protocols |
| E | Immutable prescription revisions during a session | Adaptation of work that has not started |

Simulation, replay verification, and compatibility checks support these milestones throughout. They are part of the accepted proposal 8.

The user accepted the capabilities and milestone sequence, not every field name or policy in this document. Concrete design choices below are the specification author's proposed defaults, subject to approval of this draft.

### 1.1 Goals

- Preserve the distinction between the rule, the prescription, actual performance, and progression state.
- Express targets with explicit units, comparisons, aggregation, and missing-data behavior.
- Resolve relative targets against a specific personal reference and freeze the result.
- Allow separate groups to earn separate progression decisions.
- Represent the order and timing of work and recovery inside a session without confusing them with longitudinal program phases.
- Adapt only future work, retaining the prescription that governed each completed unit.
- Explain and simulate decisions using the same pure engine used in real sessions.
- Deliver each milestone through authoring, execution, persistence, history, and relevant readers.

### 1.2 Boundaries

This specification defines engine capabilities and the minimum product support required to use them. It does not authorize application implementation, introduce a general-purpose programming environment, or require a new external service or device integration.

An existing imported program that cannot be edited losslessly must retain its current protection against destructive template reconstruction. Supporting these milestones does not require replacing that protection with a general program editor.

Continuous sensor-driven adaptation, high-frequency signal storage, and structured workout export to external devices are outside the initial delivery. They may consume the resulting contracts later. Milestone E initially adapts at confirmed work-unit boundaries.

## 2. Existing architecture and constraints

The current implementation already provides:

- Runtime-neutral, dependency-free modules in `api/engine` and `api/migration`.
- Rules containing phases, set groups, progression operators, exits, and completion conditions.
- Frozen, content-hashed prescriptions created by `generatePrescription`.
- Performance observations plus an `actual` summary and execution audit.
- Per-track state updated by `advanceProgression` and reconstructed by `replayProgression`.
- Append-only 1RM records and prescription snapshots of the reference used.
- Separate, device-local active-session persistence; completed sessions enter profile synchronization.
- Existing superset ordering, round recovery, per-set rests, and unilateral handling.

Relevant limitations verified in the baseline:

| Boundary | Current behavior | Design implication |
| --- | --- | --- |
| `api/engine/rules.js` | Closed metric lists; phase-owned operators; a recognized preset name is required | Extend validation and the existing declarative model |
| `api/engine/audit.js` | One deciding summary, primarily based on minimum reps or duration | Evaluate targets at their declared scope before aggregating |
| `api/engine/program.js` | Groups expand into prescribed rows | Retain group identity in expanded execution units |
| `frontend/src/lib/session-ui-adapter.js` | Prescribed rows are recognized through positional `rN` identifiers | Introduce stable identity without rewriting old prescriptions |
| `frontend/src/lib/finish-session.js` | A track advances once from its last counted exposure in a workout | Evaluate all intended group/block work before advancing that track |
| `api/engine/context.js` | Replay invokes the current progression implementation | Dispatch through an explicit semantics version |
| `api/engine/one-rm.js` | The newest record is selected by exercise | General references need context and temporal eligibility |
| `frontend/src/lib/heart-rate.js` | Some set windows and HR summaries are reconstructed after the session | Distinguish retrospective estimates from decision-time measurements |
| `api/migration/profile-pack.js` | Packing specializes prescribed fields and current profile schema | Every new persisted structure needs a lossless round trip |
| `api/server.js`, `api/migration/profile-version.js` | The gate distinguishes legacy and engine-aware clients, not all future semantics | Add a gate that older clients cannot bypass accidentally |
| `frontend/src/lib/sync-merge.js` | Dictionaries and derived progression have specific merge behavior | Extend collision handling, dictionary union, and replay together |

Constraints retained for every milestone:

1. No new runtime dependency is required. No TypeScript, linter, or formatter is introduced.
2. The core receives timestamps, identifiers, catalogue-derived context, and observations as arguments. It does not access storage, clocks, randomness, sensors, or the network.
3. Existing rule semantics and saved prescription hashes remain unchanged unless a user explicitly adopts a newer rule behavior.
4. Configuration is validated strictly. Actual performance remains recordable even when it differs from the prescription.
5. Missing, estimated, skipped, and out-of-target data must not be silently converted into one another.
6. The packed full-profile sync limit remains 16 MiB. Failed validation or size checks must leave the saved profile intact.
7. Native shells, the browser, the API, and MCP must agree on the records they read. Existing shared-core loading checks remain mandatory.

## 3. Shared contracts

The following names describe logical contracts. The implementation plan may choose file layout and encoding, provided the behavior and persistence requirements remain intact.

| Contract | Responsibility |
| --- | --- |
| Metric definition | Dimension, supported units, conversions, value domain, and legal operations |
| Observation | A recorded value, its unit, source, timing, and relevant measurement quality |
| Target | A metric, scope, comparison, threshold or range, aggregation, and missing-data policy |
| Reference record | A dated personal benchmark with context and provenance |
| Reference snapshot | The exact reference and conversion inputs used to resolve a prescription |
| Evaluation | Target-level evidence and a result of met, unmet, or unknown |
| Decision | The rule, evidence, result, and state or prescription change it produced |
| Group state | Progression values and counters owned by a stable phase/group identity |
| Session block | A bounded execution structure separate from longitudinal phases |
| Prescription revision | An immutable successor describing changes to future work |

Use fixed, validated operations. Targets require comparisons such as at least, at most, within a range, or membership in an ordered difficulty scale. Scope aggregation supports all required units or an explicit minimum count of them. This is only the evaluation vocabulary required by the selected capabilities.

Any unsupported operation, metric/unit combination, scope reference, or reference dependency must produce an actionable configuration error before execution. Engine outcomes store reason codes and values; localized prose is produced at the UI boundary.

## 4. Milestone A: compatibility, identity, and explanations

### 4.1 Version contracts

Keep three independent concepts:

- Profile schema: the persisted and transported data contract.
- Rule revision: edits to a user's rule.
- Engine semantics version: the interpretation of comparisons, operators, aggregation, progression, and rounding.

Existing rules and prescriptions without an explicit semantics version are interpreted as semantics 1. Their existing fingerprints, hashes, and historical payloads are not rewritten merely to add the default.

New extended rules use semantics 2. Every new extended prescription, derived decision, and revision identifies that version. Evaluation and replay dispatch to the matching supported behavior. Unsupported versions are refused before evaluation or mutation; they are never approximated with the newest version.

The proposed profile schema for extended records is `engineSchemaVersion: 3`. This is a data-format version, not a rename of the existing engine. A must supply the compatibility boundary before B-E can write extended records. Ordinary v2 profiles remain usable until explicitly upgraded; creating an extended plan requires the upgrade first.

The updated API checks the actual document schema and the client's declared supported schema, rather than treating every header value greater than or equal to 2 as equivalent. A schema-2 client cannot read or overwrite a schema-3 profile through normal sync. A capable client may still work with schema-2 data using semantics 1.

The upgrade must be deterministic, preserve the original profile backup, validate both canonical and packed output, and be atomic across the relevant local/server transaction. The existing v1-to-v2 conversion remains unchanged and precedes this upgrade where necessary. Mixed-schema documents are never merged directly. A supported schema-2 copy is converted to the same schema before reconciliation; an old client receives an upgrade-required response.

A legacy active session must be finished or explicitly cancelled before the profile upgrade. It is never discarded or silently converted into an extended execution. Native mirrors, guest data, backups, stashes, imports, and sign-in merge paths must honor the same rule.

Within schema 3, rules and profiles declare the capabilities required by the records actually present. A partially upgraded client must refuse unsupported authoring/execution or profile writes, preserve the source, and identify the missing capability. It must not silently strip a block, observation, revision, or reference during a round trip.

### 4.2 Stable identity

Preserve `occurrenceId`, `trackId`, `exposureId`, and prescription identity. Add stable logical identity for phase/group owners and execution units.

- A group owner is identified by phase ID plus group ID, never by array position.
- A block definition has a stable ID. A repeated instance also carries its iteration path.
- A logical prescribed set/work unit has an execution ID that survives insertion or reordering of unrelated units.
- Left/right performances can share a logical set identity and retain side identity, preserving the existing rule that a bilateral obligation requires both sides.
- Display order is separate from identity.

For legacy prescriptions, an adapter resolves `rN` against the original frozen prescription and exposure. It must not reinterpret the same identifier against a newly reordered plan. Do not regenerate historical rows or alter their hashes.

### 4.3 Decision evidence

A decision record contains a stable decision ID, triggering completion/event identity, semantics version, rule revision, scope, evidence references and values, outcome, reason code, and the resulting change. Records should refer to immutable sources instead of copying the full profile or entire prior state.

Distinguish at least: advanced, held, reduced, phase changed, completed, and unknown because required evidence was unavailable. State that did not change still needs an explanation when a progression evaluation took place.

Retried evaluation of the same logical completion produces the same decision and state once. Persistence adapters cannot award progress again by generating a new random decision ID for a retry.

History shows the original decision and identifies later correction/reconciliation where relevant. Replaying edited history may rebuild current derived state, but it does not replace the target or live adaptation that governed a completed historical unit.

Replay judges each accepted performance against its own frozen effective targets and advances from the values prescribed for that exposure, while rebuilding sequential counters and phase/group state from accepted earlier history. It does not regenerate later historical prescriptions from a counterfactual earlier state or subtract previously earned increments from later recorded loads. For example, successful 100 kg and 102.5 kg prescriptions originally leave 105 kg under a 2.5 kg success increment. Correcting the first result to a miss still leaves 105 kg if the second result meets its own 102.5 kg target; earlier counters are rebuilt, but the second session really performed that prescribed work. Deleting the second session instead leaves the state produced by the remaining first session. Reconciliation results are distinguishable from the original recorded decisions.

### 4.4 Acceptance criteria

- A1: All existing prescription golden fixtures retain their original contents and hashes under semantics 1.
- A2: An unversioned legacy rule resolves to semantics 1; an unknown version fails without changing profile data.
- A3: A schema-2 client cannot read or overwrite extended schema-3 data, and unsupported capability writes are refused.
- A4: Upgrade failure, an oversized packed result, or a legacy active session leaves the original profile and session available.
- A5: Reordering unrelated groups does not attach a saved result to a different group or set.
- A6: Duplicate completion input produces one advancement and one logical decision.
- A7: Decision explanations can be rendered using stored codes and evidence without rerunning current rules.

## 5. Milestone B: metrics and personal references

### 5.1 Metric definitions and observations

Retain existing observations as recorded facts. Add only the metadata needed for evaluation: source kind, measurement time/window where known, availability time when material to a decision, and measured/manual/estimated status. Quality requirements belong to the target; they are not inferred from a plausible-looking number.

Initial extended support covers the following metrics alongside existing reps, sets, load, and difficulty:

| Metric | Storage/display contract | Initial evaluation support |
| --- | --- | --- |
| Duration | Seconds | At least, at most, or within a range |
| Distance | Metres; convert display units at boundaries | Per-unit distance and selected-scope total |
| Speed | km/h to reuse current storage; pace is a display conversion | Explicit speed thresholds/ranges |
| Power | Watts | Per-unit supplied mean and declared range |
| Cadence | Unit qualified by sport, such as rpm or strokes/min | Per-unit supplied value and range |
| Heart rate | bpm, with supplied summary type | Explicit average/maximum target, only with eligible evidence |
| Recovery duration | Seconds, with measured/manual/estimated origin | Per-recovery threshold/range |
| Perceived effort | Scale and domain identified | Scale-compatible comparisons |

Load retains the declared kg/lb unit and existing assistance/bodyweight meaning. New metrics do not cause historical loads to be normalized or rehashed. Ordered difficulty scales use named levels and scale identity; arithmetic on an arbitrary grade label is invalid.

An observation's zero value is not missing. Validation rejects non-finite configuration values and incompatible units. Performance that cannot satisfy an evaluator remains visible and receives an unknown evaluation rather than fabricated data.

Different effort domains remain distinct. Strength RIR/RPE behavior keeps its legacy semantics; session or endurance effort must identify its own scale and must not implicitly pass through `10 - RPE` conversion.

### 5.2 Targets and aggregation

A target declares the metric, required scope, comparison, threshold/range, aggregation, and missing-data behavior. A range includes both boundaries. Unit conversion precedes comparison. Rounding of prescribed targets is declared per metric or equipment; display rounding does not decide success.

First evaluate each required unit against its own target, then apply scope aggregation. This preserves different targets in a pyramid or mixed interval block. Supported scope outcomes are all required units met or at least a configured number met. Missing required units contribute unknown evidence unless the rule explicitly treats a skipped required unit as unmet.

Numeric aggregates initially include sum, minimum, maximum, and explicitly weighted mean where the needed weights exist. A mean of means without compatible weights is not an eligible aggregate. Ratios require their operands and zero-denominator behavior to be declared.

For a new target, the default missing-data behavior is hold the dependent automatic decision and explain why. A rule may explicitly ignore an optional target or allow a manual observation. Existing semantics-1 missing-effort behavior is preserved.

Examples of independent obligations: complete 400 m, finish within a time range, and take the prescribed recovery. Completing the work and meeting all targets are different facts.

Imported HR averages/maxima cannot establish time in a zone. Estimated set timing cannot prove an accurately measured recovery interval. Late-arriving measurements may improve retrospective analysis; they do not become evidence that a live decision had at the time.

### 5.3 Personal reference records

A general reference record contains:

| Field | Meaning |
| --- | --- |
| Stable record ID | Immutable reference identity |
| Kind and metric | For example, strength maximum, power benchmark, or speed benchmark |
| Value and unit, or zone boundaries | Typed quantities compatible with the target |
| Context | Sport and relevant exercise, variant, equipment, or test protocol |
| Measured time | When the result describes the athlete |
| Availability/provenance | When and how it became available; manual, measured, or derived |
| Derivation metadata | Method/version and source record IDs for derived values |

Add references alongside `oneRepMaxes` first. An adapter exposes existing 1RM records through the common resolution contract without deleting, duplicating, or rewriting the historical dictionary.

Corrections create a new record with a supersession relationship. Retirement is separate immutable metadata, not an in-place change to a benchmark's measured value. Retired records remain resolvable by frozen prescriptions. References derived from an edited or deleted source are reconciled for future selection without changing prior snapshots.

The rule selects an explicit record or the latest compatible, non-retired record eligible for the session's declared reference date. Compatibility includes kind, unit dimension, sport, and required context. Ties use a documented deterministic record-ID ordering. An explicitly selected record still must be temporally and dimensionally valid.

For a live prescription, eligibility requires a measurement no later than session start and availability no later than prescription generation. For a backfilled session, the measurement cutoff remains that session's date; the snapshot records that resolution happened later. Replay always uses the frozen selection, never a current lookup. A required missing, incompatible, or stale reference blocks generation of the affected relative prescription with a specific repair action; it never resolves to zero. Missing observations when evaluating an already resolved target follow the target's missing-data policy instead.

Automatic enrichment from a health-data import updates retrospective measurements only; it does not silently change a completed session's accepted decision inputs or progression. An explicit history correction can accept additional eligible observations for reconciliation, with a new audit revision. Original live-decision evidence remains unchanged.

Optional freshness limits are rule parameters; no universal physiological expiry is invented by the engine. A fixed reference can remain pinned throughout a cycle. A new external test does not silently replace it.

### 5.4 Relative resolution

Initially support absolute targets and a percentage of a compatible scalar reference. Resolve the expression into a concrete threshold/range and freeze the reference identity, selected value/unit/context, conversion, rounding, and final target.

For example, 95-100% of a 250 W reference resolves to 237.5-250 W before any declared equipment rounding. A later 270 W record affects only future prescriptions whose selection policy permits it.

Training max remains a program-owned value. A cycle increment to training max is not a new measured personal benchmark. Reference-based resolution must preserve this distinction.

### 5.5 Acceptance criteria

- B1: Equivalent supported unit inputs evaluate identically; display-unit changes do not alter frozen targets.
- B2: Shorter time can satisfy an at-most target while longer time satisfies an at-least hold target.
- B3: Per-unit evaluation preserves heterogeneous targets before scope aggregation.
- B4: A zero, missing observation, skipped required unit, and estimated observation remain distinguishable.
- B5: A later-dated reference cannot influence a backfilled prescription for an earlier date.
- B6: Replacing or retiring a reference does not alter a prescription that already used it.
- B7: A missing/incompatible reference produces a precise error or hold, never a default numeric target.
- B8: General references and observations survive canonical validation, pack/unpack, merge, backup, and supported exports.
- B9: Existing 1RM, assistance, bodyweight, and unilateral behavior remains unchanged under semantics 1.

## 6. Milestone C: progression per group

### 6.1 Ownership and evaluation

An extended progression operator identifies its owner: the phase's existing shared anchor or one stable group. Group-owned progression reads that group's prescribed work and results only. A single value must not have two writers at the same boundary.

Group state stores only its owned values and counters, such as current load/reps, successes, and stalls. Identity is phase ID plus group ID. Reordering retains ownership. A new group starts from its declared values. Removing a group stops future evaluation but retains historical records. Renaming an ID represents removal plus addition, not an implicit transfer of progress.

Separate group evaluation from phase completion. A phase may require all designated groups, a named deciding group, or an explicit minimum number. Non-deciding groups are still logged and explained. Missing data in an optional group cannot block an unrelated group's progression.

Expected set counts and unilateral completeness are computed within each scope. Reusing the current exposure-wide required-set count for every group is invalid.

### 6.2 Progression boundary

The existing once-per-track-per-workout guarantee remains. At finish, assemble the intended group results from eligible work before computing the track's next state. A group is evaluated once for its logical completion, not once for every row or block iteration.

For extended groups deliberately present in multiple exposures of the same track, aggregate their declared required units before evaluating. Unprescribed extra work, warm-ups, and explicitly excluded work do not earn automatic group progression. Semantics 1 retains its current last-counted-exposure behavior.

Aggregation is allowed only when all contributing extended exposures share the same base rule ID, rule revision, semantics version, phase ID, and immutable base program definition. Material prescription revisions from E may differ because they share that base contract. A session combination that would mix different base contracts for the same track is rejected before it starts; those exposures can be logged as separate sessions. In-session rule edits apply to future sessions and do not replace the active base contract. Entirely legacy combinations retain semantics 1. An incompatible extended combination in an import is rejected intact; if encountered in existing data, history remains readable but automatic reconciliation of that track is refused with a precise error rather than choosing a rule arbitrarily.

Operators inside one owner keep the existing chain behavior unless their extended contract explicitly defines a different accepted operation. This milestone does not silently convert a legacy chain into simultaneous progression.

Phase transitions take place after the designated group decisions. State is preserved for an owner that reappears with the same identity; a rule edit that changes its starting values or metric domain starts that owner's values and counters from the new declaration. Changes to a step size or target threshold apply prospectively without relabelling historical decisions. Removed owners are never inherited by position.

### 6.3 Required example

One exercise has a top group, back-off group, and technical group. The top group can earn a load increment, the back-off group can earn a rep increment, and the technical group can remain fixed. A back-off miss holds its own values while an independently successful top group advances, unless the phase explicitly requires joint success.

### 6.4 Acceptance criteria

- C1: Two groups can produce different advancement/hold decisions in one exposure.
- C2: Required-unit counting and left/right completeness are scoped to the relevant group.
- C3: A group reorder preserves state; a new group does not inherit another group's counters.
- C4: Excluded, warm-up, and extra work cannot earn unintended progress.
- C5: Multiple blocks or exposures do not double-advance an owner.
- C6: Finish, history correction, deletion, and merged-history replay produce the same derived group state for the same accepted facts.
- C7: Incompatible phase, base-rule, or semantics contracts for the same track cannot be aggregated; different effective revisions of one valid base contract remain supported.

## 7. Milestone D: structured sessions

### 7.1 Structure and responsibilities

Introduce session execution blocks distinct from program phases. Program phases select the longitudinal prescription; blocks order execution within it.

The initial block vocabulary consists of sequence, finite repeat, work, recovery, and manual completion. A work block references an occurrence/group and declares its termination criterion and targets. A session-level sequence can reference multiple occurrences to express a circuit; each occurrence retains its exercise and progression track.

One expanded work block executes exactly one logical prescribed row/set, not the entire referenced group. During prescription generation, expanded work instances consume that group's prescribed rows in declared execution order. The number consumed must equal the group's declared prescribed row count; mismatches are configuration errors, not implicit multipliers. Each instance is bound to its row before execution, so skipping or reordering work cannot shift later results onto another target. A per-side set still requires its declared sides to complete that logical row.

For example, a group declaring six interval rows scheduled by `repeat 6 [work(group), recovery 90 s]` produces six work units and six recovery units, twelve execution units total. Repeating a single work block six times against a group declaring three rows is invalid. To schedule eighteen work units, the group must declare eighteen rows and the blocks must explicitly expand to eighteen work units, such as six rounds of three work units. Blocks schedule the prescribed rows; they do not repeat an entire group implicitly.

Termination initially supports elapsed work duration, distance reached, prescribed repetition completion, or explicit manual completion. Finishing a unit records completion even if its performance targets were unmet. Phase advancement never occurs simply because the execution cursor moved to the next block.

Repetition expansion produces stable instance identities, not new long-term tracks. Execution scheduling may interleave occurrences; progression waits for the evaluation boundary defined in C.

Reuse existing superset behavior for equivalent round-based structures. Existing superset definitions, rest overrides, and set-specific rests retain their current meaning. Do not route a legacy session through changed timing semantics just because blocks are available.

### 7.2 Timing

Support both:

- End-to-start recovery: the next work starts after a recovery measured from the prior work's end.
- Start-to-start cadence: subsequent work is scheduled relative to the previous scheduled start.

For fixed-start work, an overrun starts the next unit when the athlete is ready, records lateness, and re-anchors subsequent starts to that actual start. It does not silently mark missed work completed or create a burst of catch-up starts. This is the proposed initial overrun policy.

A pause stops the active execution clock and shifts future scheduled starts by the pause duration. Preserve actual wall timestamps and pause intervals separately so elapsed time, active work, and recovery remain distinguishable. Resume after backgrounding or restart uses persisted timing facts and current input time, not a decrementing counter assumed to have kept running.

Record starts/ends when known. Manually entered or estimated timing is labelled as such and is evaluated only when the target allows that evidence. An inferred timestamp must not be promoted to a measured interval.

### 7.3 Bounds and interruption

All repeats are finite. The proposed initial shared bounds are nesting depth 4 and 256 expanded execution units per session, including recovery. Retain existing phase/group/operator limits and the 50 prescribed work-row limit per occurrence. Validate expanded size before starting; never truncate a program to fit.

Skipping work is an explicit action with a recorded disposition. A partially finished session retains completed units and the dispositions of remaining required units. Repeated-block state, cursor, timestamps, observations, and identities survive local active-session persistence and native mirroring. The active session remains device-local.

Targets requiring a capability that is unavailable can use manual entry only if the rule permits it. Otherwise execution must identify the unmet requirement before the affected work starts.

### 7.4 Required examples

- Six repetitions of 400 m work plus 90 seconds recovery, with a declared time target per work unit.
- A finite EMOM with start-to-start timing and visible overruns.
- Three circuit rounds alternating two occurrences with recovery after the round.
- A duration-based work unit with an independent power or speed range.

### 7.5 Acceptance criteria

- D1: Work completion, target success, and longitudinal progression remain independent events.
- D2: Each repeated instance has a stable identity and belongs to the intended occurrence/group.
- D3: End-to-start and start-to-start protocols produce the documented different schedules.
- D4: Pause, backgrounding, restart, and overrun do not duplicate or silently complete work.
- D5: An oversized or over-nested structure fails before execution without modifying the plan.
- D6: The current superset rest and unilateral tests continue to pass unchanged for legacy sessions.
- D7: Completing six intervals produces one intended progression evaluation for their owner, not six increments.
- D8: Block expansion consumes exactly the declared logical work rows and rejects count mismatches; the six-interval example expands to twelve total execution units.

## 8. Milestone E: adaptations during a session

### 8.1 Trigger and allowed effect

Initially evaluate adaptations only after confirmed completion of a work unit or group. The input is the immutable source prescription, the accepted completion event, eligible observations available at that boundary, and the current revision/state.

An adaptation may change the target load, repetitions, duration, or recovery of pending units, or omit a bounded tail of optional work according to the preset. It cannot change the exercise identity or completed performance. Continuous sensor triggers and generation of unbounded additional work are excluded from this milestone.

Dependencies between group results and future targets must be explicit and acyclic. An adaptation can use earlier confirmed work, never later work or observations imported after its decision boundary. Conflicting writes to one future target are rejected during rule validation.

### 8.2 Immutable revisions

Preserve the original prescription. Each applied adaptation creates an immutable revision containing its ID, root and parent prescription IDs, semantics version, trigger identity, decision/evidence, target execution IDs, concrete changed targets, and content hash.

Persist the complete effective prescription for each material revision using existing prescription storage and packing. The revision chain provides provenance; execution and history do not depend on reconstructing an unbounded patch chain.

Every started/completed work unit references the effective prescription revision that governed it. Once a unit has started, its target is fixed for that execution; any actual deviation is logged separately. Later revisions may affect pending units only. Parent links form one validated chain for the locally active session, and every referenced unit and revision must resolve.

Applying the same completion twice returns the same revision and does not multiply changes. Persist the completion, decision, revision, and cursor transition as one recoverable local update. A crash between operations cannot leave a completed unit pointing to a missing prescription.

### 8.3 Overrides and corrections

A manual target override on pending work takes precedence over later automatic adaptations to that field. It is recorded as a revision with source `manual`. The athlete can explicitly clear that override to resume automatic updates; the engine never overwrites it silently.

If an earlier result is corrected before any affected work starts, a new revision may recalculate pending targets. If affected work has started, retain its governing target and explain that only remaining pending work can change. Previously applied revisions and decisions remain historical facts.

Rule-omitted optional work is not a skipped required set and must not create a false shortfall. Required work cannot be relabelled optional after completion merely to produce a successful result.

At session finish, progression uses actual performance against each unit's governing effective target, plus the rule's declared group criteria. It must not evaluate all units against the initial root targets or only the last revision. Replay uses the same recorded revision bindings.

### 8.4 Required example

A top set is initially prescribed at 100 kg, followed by back-off work at 90% of the actual top-set load. The athlete confirms 105 kg. The engine resolves 94.5 kg and rounds to 95 kg on the declared 2.5 kg grid. A revision applies 95 kg to pending back-off units. The original top-set prescription and the 105 kg observation both remain visible.

Reprocessing the top-set completion must not produce another revision or compound the percentage. Editing that result after a back-off set has started cannot rewrite the target that governed that set.

### 8.5 Acceptance criteria

- E1: A confirmed earlier result can change pending work through one traceable immutable revision.
- E2: Duplicate trigger input is idempotent across resume and retried persistence.
- E3: Completed or started units retain their original effective target bindings.
- E4: Manual overrides survive automatic adaptations until explicitly cleared.
- E5: Late/retrospective observations cannot be injected into original live-decision evidence.
- E6: Rule-omitted optional work and athlete-skipped required work remain distinct.
- E7: Finish and replay evaluate each unit against its governing revision and agree on next group state.
- E8: Revision records survive packing, merge, backup, history editing, and supported readers without dangling references.

## 9. Simulation and verification

Simulation invokes the same pure resolution, execution, evaluation, adaptation, and progression functions as production. It supplies explicit identifiers, timestamps, references, and synthetic performances. It does not implement another progression algorithm and does not mutate the user's saved plan, references, active session, or history.

The minimum product output is a table of prescribed targets, supplied results, decisions/reasons, and next values for the selected scenario. Show scenario assumptions. Simulations are conditional examples, not forecasts of athletic performance.

Expose simulation incrementally: A supports legacy decision/replay inspection; B adds references and metric targets; C adds group outcomes; D adds block execution; E adds revisions. Do not require an unsupported future milestone to ship an earlier one.

Required scenarios include consistent success, partial group success, missing effort/reference, unit conversion, skipped work, duplicate completion, interruption/resume, a corrected earlier result, and a newer personal reference. Include legacy assistance, bodyweight ladders, and unilateral cases in compatibility coverage.

Cross-cutting invariants:

1. Identical supported inputs produce identical content and decisions.
2. A logical completion earns progression at most once.
3. Recorded targets and original decision evidence do not change because a rule, reference, or evaluator was updated.
4. Replaying accepted history reconstructs the same derived state as finishing that history in order.
5. Finite configured structures terminate within declared expansion limits.
6. Required identities and revision/reference links remain resolvable after supported transformations.
7. Canonical-to-packed-to-canonical round trips preserve the complete supported meaning and existing hashes.
8. Unknown versions/capabilities fail without destructive fallback.

Use existing Vitest and API test arrangements. Reuse the installed property-testing dependency where generated cases substantively exercise these invariants. Keep golden fixtures for semantics 1 and small explicit examples for the new behavior.

## 10. Integration and delivery requirements

Each milestone is complete only when the affected paths below support it or explicitly refuse an unsupported operation without losing data.

| Surface | Required responsibility |
| --- | --- |
| `api/engine` | Validation, generation, evaluation, progression, version dispatch, reference resolution, and replay |
| `api/migration` and server gate | Schema handling, canonical validation, packing, size checks, and compatible read/write access |
| Session start, repeat, merge, and finish | Correct identities, scopes, revision bindings, and once-per-track advancement |
| Active-session storage/native mirror | Recoverable cursor, timing, decisions, and revisions |
| Frontend/API merge and unit conversion | Immutable-record collisions, reference retirement, group state replay, and links |
| Existing plan editor and configuration sheets | Minimum fields for shipped capabilities; preserve programs that cannot be edited losslessly |
| History, statistics, and records | Correct units/scopes and effective historical targets; do not label all new metrics as strength volume |
| Plan share, backup, import, CSV/text/print/FIT readers | Preserve supported meaning or state an explicit limitation; reject plan imports requiring unsupported semantics |
| MCP and Coach boundaries | Read supported typed facts; disclose unsupported extended plans instead of translating them into an unrelated legacy policy |
| Web/mobile packaging and canonical GitLab CI | All shared modules load and the supported builds include them |

Human-facing configuration shows metric units, the chosen personal reference and date, missing-data behavior, block order/timing, and the reason for an adaptation. Reuse current UI controls, localization, and accessibility patterns. Technical version numbers do not belong in the normal workout flow unless they explain an incompatibility the user must resolve.

A plan export preserves reference requirements and selection policy. It does not embed another athlete's private reference history. The recipient binds their own compatible reference; absence is reported before relative generation.

Only fields of the correct dimension are converted when profile units change. Never convert watts, time, distance, cadence, or a difficulty index as if they were kg/lb. Existing immutable prescription unit handling remains covered by round-trip tests.

Immutable records union by identity. Identical duplicates deduplicate. Different content under the same ID must be deterministically remapped together with all dependent links or refused intact; last-write-wins cannot silently replace an immutable prescription, reference, or revision. Progression caches are rebuilt from accepted merged history. Reference retirement/supersession participates in reconciliation and cannot disappear on an older copy's sync.

Keep stored evidence compact. Store the supplied summary and provenance needed to reproduce a decision; do not add high-frequency sample arrays to each observation or duplicate full profile snapshots in decisions. Enforce the existing packed size limit before saving/upgrading, and verify packing behavior for the new schema explicitly.

## 11. Delivery sequence and design choices

The accepted delivery order is A -> B -> C -> D -> E. Simulation and integration coverage grow with each milestone. An implementation plan may divide a milestone into reviewable changes, but cannot expose dependent behavior before its compatibility and persistence paths work.

The following defaults were chosen by the specification author and need to be assessed when approving this draft:

| Choice | Proposed behavior |
| --- | --- |
| Extended profile format | Schema 3; semantics 1 remains supported; new extended rules use semantics 2 |
| Missing required evidence | Hold the dependent automatic decision by default |
| Benchmark update | Snapshot selection; no retroactive replacement; fixed-cycle references remain pinned |
| Group ownership | Stable phase/group IDs; explicit shared versus group-owned values |
| Block limits | Depth 4, 256 expanded session units, existing 50 work rows per occurrence |
| Fixed-start overrun | Record lateness, start when ready, re-anchor following starts |
| Initial adaptation boundary | Confirmed work-unit/group completion; pending work only |
| Revision storage | Immutable effective snapshots using existing prescription packing |
| Manual override | Overrides automatic changes to that field until explicitly cleared |

The builder may decide module layout, exact JSON encoding of these logical contracts, internal function names, and UI composition using existing components. Those choices must preserve the specified invariants, bounds, identity, compatibility, and acceptance criteria. They do not authorize additional capabilities.

## 12. Repository references

- [Engine rules and validation](../../../api/engine/rules.js)
- [Prescription generation](../../../api/engine/generate.js)
- [Group expansion](../../../api/engine/program.js)
- [Evaluation and performance summary](../../../api/engine/audit.js)
- [Progression](../../../api/engine/advance.js)
- [Context and replay](../../../api/engine/context.js)
- [1RM records](../../../api/engine/one-rm.js)
- [Canonical profile validation](../../../api/migration/profile-validation.js)
- [Packing and unpacking](../../../api/migration/profile-pack.js)
- [Profile size boundary](../../../api/migration/profile-size.js)
- [Session start](../../../frontend/src/lib/session-start.js)
- [Session UI adapter](../../../frontend/src/lib/session-ui-adapter.js)
- [Session finish](../../../frontend/src/lib/finish-session.js)
- [Superset execution](../../../frontend/src/lib/supersetFlow.js)
- [Heart-rate provenance and estimated windows](../../../frontend/src/lib/heart-rate.js)
- [Client reconciliation](../../../frontend/src/lib/sync-merge.js)
- [Existing model and migration reference](../../MIGRATION_TO_ENGINE_NOTE.md)
