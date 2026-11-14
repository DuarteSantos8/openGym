# openGym Next progress

This ledger tracks review state, not permission to start the next epic. Imported plans are unchanged outlines. EP-00 follows its narrower documentation/evidence task: no source fixes, workflow edits or feature TDD changes. Its baseline RED evidence records existing check failures; its GREEN evidence records the checks that actually passed. EP-00 was reviewed and merged in PR #4. Its Linux CI baseline passed; browser and deployment verification remain separately tracked. Wave 1 resumed in isolated cloud agents on 2026-11-13. The orchestrator owns this ledger.

| Task | Owner | Branch/commit | RED evidence | GREEN evidence | Review | Status | Blocker | Next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [EP-00](plans/EP-00-baseline.md) | Codex; orchestrator review | next/integration @ cefce38b | [Windows baseline findings](../product/BASELINE_REPORT.md#failure-classification) | [Linux Node 22 CI: all jobs passed](https://github.com/sorensadrgit-art/openGym/actions/runs/43498778572) | Fidelity/scope review complete; [PR #4 merged](https://github.com/sorensadrgit-art/openGym/pull/4) | Completed (docs/baseline) | Deployment rehearsal unverified; fork CLA configuration unresolved | [Guest workout/offline/export smoke passed](evidence/resume/README.md); retain authenticated and deployment gates |
| [EP-01](plans/EP-01-contracts.md) | Codex, thr_bpakqa9djc; orchestrator review | [Draft PR #5](https://github.com/sorensadrgit-art/openGym/pull/5), 8dc1a809 | Committed RED before each fix; see PR | Frontend 7,876; API 833; MCP 140; build/generators/locales and final GitHub Tests passed; [parent probes and browser smoke](evidence/EP-01-parent-review/README.md) | Parent findings corrected and rechecked; independent Pi/MiniMax review executing in thr_nv2up7xmgh | In Review | Independent verdict pending; fork CLA unresolved | Review at the final SHA before merge; replacement reviewer uses user-authorized minimax/MiniMax-M3.1-Flash |
| [EP-02](plans/EP-02-design.md) | Claude, thr_pdf8xwsevy; OpenCode reviewer thr_j2azi2kppd | room/ep-02-design-foundation-sevy @ 12f8e8d4 | Plan b6ab4d2f, RED 411ee4b4 before implementation | First implementation pushed; final tests/browser/bundle evidence pending | Independent implementation review started; parent flagged missing direction in Home metric accessible name | In Progress | No provider blocker; acceptance evidence pending | Correct findings and complete [brief](briefs/EP-02.md) gates; no merge yet |
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
