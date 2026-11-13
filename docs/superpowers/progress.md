# openGym Next progress

This ledger tracks review state, not permission to start the next epic. Imported plans are unchanged outlines. EP-00 follows its narrower documentation/evidence task: no source fixes, workflow edits or feature TDD changes. Its baseline RED evidence records existing check failures; its GREEN evidence records the checks that actually passed. EP-00 was reviewed and merged in PR #4. Its Linux CI baseline passed; browser and deployment verification remain separately tracked. Wave 1 resumed in isolated cloud agents on 2026-11-13. The orchestrator owns this ledger.

| Task | Owner | Branch/commit | RED evidence | GREEN evidence | Review | Status | Blocker | Next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [EP-00](plans/EP-00-baseline.md) | Codex; orchestrator review | next/integration @ cefce38b | [Windows baseline findings](../product/BASELINE_REPORT.md#failure-classification) | [Linux Node 22 CI: all jobs passed](https://github.com/sorensadrgit-art/openGym/actions/runs/43498778572) | Fidelity/scope review complete; [PR #4 merged](https://github.com/sorensadrgit-art/openGym/pull/4) | Completed (docs/baseline) | Deployment rehearsal unverified; fork CLA configuration unresolved | [Guest workout/offline/export smoke passed](evidence/resume/README.md); retain authenticated and deployment gates |
| [EP-01](plans/EP-01-contracts.md) | Codex, thr_bpakqa9djc | room/ep-01-data-contracts-and-sync-9djc | Pending | Pending | Not started | In Progress | None reported | [Brief](briefs/EP-01.md); inspect file plan, then review implementation and tests |
| [EP-02](plans/EP-02-design.md) | Claude, thr_pdf8xwsevy | Isolated cloud child; no deliverable yet | Pending | Pending | Not started | Blocked | Claude five-hour plan limit; reset reported at 23:20 UTC, 2026-11-13 | [Brief](briefs/EP-02.md); do not resend task; await provider availability |
| [EP-03](plans/EP-03-analytics.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-04](plans/EP-04-diary.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-05](plans/EP-05-food-lookup.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-06](plans/EP-06-nutrition-services.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-07](plans/EP-07-activity.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-08](plans/EP-08-fittrackee.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-09](plans/EP-09-progression.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-10](plans/EP-10-pose.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-11](plans/EP-11-sensors.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-12](plans/EP-12-anatomy.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-13](plans/EP-13-ai-coach.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-14](plans/EP-14-automation.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-15](plans/EP-15-rehab.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
| [EP-16](plans/EP-16-release.md) | Unassigned | - | - | - | Not started | Backlog | - | Review epic dependencies and define bounded task |
