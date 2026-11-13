# Cloud continuation evidence, 2026-11-13

Application commit: `cefce38b4` (`next/integration`, EP-00 merged). These are baseline observations, not verification of EP-01 or EP-02.

## Browser smoke

Environment: Linux, Node v24.22.1, installed lockfiles with `npm ci` in root/frontend/api/mcp. Chromium controlled through browser-harness/CDP; Vite on localhost:5173, API on localhost:3000 using a fresh temporary DATA_DIR. Guest profile and all workouts are synthetic. Exercise media URLs were deliberately blocked to avoid presenting licensed imagery to AI tools.

Observed UI steps:

1. Open app with fresh browser storage; choose Continue without account; skip tour.
2. Load Full Body starter plan and start today's Full Body C workout.
3. Enter 40 kg and mark the first 10-rep set done. UI shows 1/16 sets and 400 kg; localStorage records the completed set. See [set-logged.json](set-logged.json).
4. Disable networking with CDP Network.emulateNetworkConditions; mark the second set done. Stored second set remains 40 kg × 10, completed. See [offline-set.json](offline-set.json). This verifies logging in an already-loaded app, not cold-start PWA availability.
5. Restore networking; Finish → Finish and save. Completion screen reports 2 sets and 800 kg.
6. Nice! → Home → Settings → Data & backup → Export backup (JSON). Browser downloads `opengym-backup-2026-11-13.json` (6,153 bytes). Parse the actual file and assert one workout, two completed 40 kg × 10 sets, 800 kg total, and active=null. See [backup-verification.json](backup-verification.json), including download hash.
7. Reload the page. The saved workout and active=null remain. See [reload-verification.json](reload-verification.json).

All seven checks passed. Servers and the test tab were stopped afterward. No production data, account or external service was used. No screenshots were generated. Console/network error capture, backup re-import, authenticated sync/passkeys, mobile devices, responsive/accessibility QA, and staging rollback remain unverified by this smoke run. Media requests were intentionally blocked, so this is not a media-loading pass.

## Existing CI independently reconfirmed

[Run 43498778572](https://github.com/sorensadrgit-art/openGym/actions/runs/43498778572), queried through the GitHub connector during this continuation: changes, mcp, images, api, catalogue, frontend, android, report and tests-ok all completed successfully. The images job includes API boot and web-to-API nginx checks. This is existing Linux Node 22 baseline evidence; no new workflow was dispatched. It does not establish a staging deployment, real-device behavior or an EP-01 pass.

## Wave 1

- EP-01: Codex child `thr_bpakqa9djc`, isolated branch `room/ep-01-data-contracts-and-sync-9djc`; parent approved bounded plan. Test/implementation review pending.
- EP-02: Claude child `thr_pdf8xwsevy` blocked by its five-hour provider limit, reset reported at 23:20 UTC. Task was not resent. No implementation or test success claimed.
- Main remains unchanged. The old Windows-only branch is intentionally outside this fresh build, per the prior approved plan.
