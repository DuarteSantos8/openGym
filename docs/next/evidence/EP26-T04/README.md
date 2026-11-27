# EP26-T04: Skill ladders from Learn

**Task:** 11.02c / EP26-T04. **Target:** Ubuntu 24.04 loopback production preview, Node 26.13.1, default web edition, disposable guest. **Base:** `6f118ed6b600abf65ad914dd9cb2bb5029a856d4` (`origin/main`). **Branch:** `next/EP26-learn-ladder`.

## Journey and fixture

Learn → **Skill ladders** opens the existing easier-to-harder sequences as a read-only sheet. It uses `allLadders` and `reachedRung` from `frontend/src/lib/ladders.js` and subscribes to the current workout store. Library retains its training and editing controls. The sheet explains that reached markers describe logged sets and do not assess technique or readiness.

The synthetic fixture starts with empty history: the card says **Not started** and each step says **Not reached**. A completed set for `0025` outside the ladder and an incomplete set for `0725` leave all seven steps unreached. Then two completed sets for `0662`, with a more recent lower rung (`0659`), leave four steps reached and three unreached. The test adds a stale personal ladder with no resolvable steps and checks that it does not appear as an unusable card. The library test verifies the original rung counts and IDs through the app’s existing text index.

## Red → green

Before implementation, `npx playwright test e2e/learn-ladders.e2e.mjs --project=chromium --trace=off` ran on the base build using a local preview. Both the 390 px and 1440 px cases failed at the same assertion:

```text
Error: expect(locator).toBeVisible() failed
Locator: getByRole('button', { name: 'Skill ladders', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found
```

The journey checks keyboard open, Page Down scroll, Tab to Close, Escape and restored focus. After a service-worker-controlled offline reload, it reopens twice and checks each rung’s text status. Axe checks the dialog against WCAG 2.0/2.1 A/AA tags. The screenshot step checks that the dialog has no media elements; exercise-media routes are blocked. Captures use synthetic workouts only.

## Verified locally

| Check | Result |
|---|---|
| Base `npx vitest run --maxWorkers=8` | 994 files / 11,130 tests passed. |
| `npx vitest run src/lib/ladders.test.js src/views/Learn.test.jsx` | 16 passed, including built-in IDs, the exercise without a ladder, and highest-rung history. |
| `npx playwright test e2e/learn-ladders.e2e.mjs --trace=off` | 6 passed: Chromium, iPhone WebKit and Pixel Chromium at 390 px and 1440 px. No axe violations in the dialog. |
| `npm run build`, `node scripts/check-season-clock.mjs dist`, `npx vitest run scripts/check-bundle-syntax.test.mjs` | Passed; the Safari 15.5 syntax guard passed all 8 tests. |
| Locale, strict source-string and native-localization checks | Passed; all four new strings appear in 25 packs. |

## Screenshots

- [390 × 844, dark, offline](learn-ladders-390-dark.png)
- [1440 × 900, dark, offline](learn-ladders-1440-dark.png)

## Release handoff

No schema, feature flag, permissions, or cloud-only import changes. To roll back, omit or revert the feature patch; ladder and workout data require no migration. Owner approval covers implementation; independent review and the draft PR are owner follow-ups. Native-language review and a real-device run are still open. Hosted CI and deployment need the owner’s PR/release workflow. The Cloud E2E follow-up can reuse the synthetic fixture and the Learn sheet entry with the linked profile’s workout history.
