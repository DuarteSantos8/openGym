# ADR-0006 EP10: on-device pose analysis with MediaPipe
Decision: **GO-WITH-CONSTRAINTS** · Date: 2026-11-14 · Owner decision: bundle the model (Soren)

## Choices
| Item | Decision |
|---|---|
| Library | `@mediapipe/tasks-vision` **1.2.3**, exact pin, Apache-2.0 |
| Model | `pose_landmarker_lite` float16 v1, 5,777,746 bytes, SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| Delivery | **Bundled.** `frontend/scripts/stage-mediapipe.mjs` (run by `predev`, `prebuild`, `prebuild:mobile`) copies the classic WebAssembly runtime (`vision_wasm_internal.js/.wasm`, 14.7 MB) and downloads the model once at build time, checksum-verified, into `public/mediapipe/` (gitignored). Nothing is fetched from Google at run time. ~20 MB added to the web build and the native apps |
| Offline build | The stage step warns and exits 0; the Lab answers "The pose model is not in this build" and nothing else is affected |
| Loading | `@mediapipe/tasks-vision` is a lazy chunk (154 KB) loaded only when Start camera is tapped |

## Telemetry finding (blocking, fixed)
MediaPipe Tasks 1.2.3 builds an internal usage-stats logger for every task (no public opt-out; `enableLogging` is not the trigger) that POSTs protobuf to `https://odml.pa.googleapis.com/v1/log` every 60 s and on `close()`. Found by the real-browser smoke test. Fix: `frontend/scripts/vite-no-mediapipe-telemetry.mjs` rewrites that single call in the vendor bundle into a no-op at build and dev time (`optimizeDeps.exclude` so dev is covered) and **fails the build** if the expected code is not there exactly once. The built `dist/` contains no `odml.pa.googleapis.com`.

## Evidence (2026-11-14, installed Chrome via Playwright, fake camera, guest profile, production build)
- Frames processed 3.5 s after Start; Stop → "Camera off"; no console errors.
- **External requests: none** (before the fix: one to `odml.pa.googleapis.com`).
- Unit tests: `pose-core` 13, `pose-session` 10, `MovementLab` 6, telemetry plugin 3.

## Not yet done
Real phones (Android WebView, iOS Safari), low light and thermal behaviour, other movements than the squat, review/export of a session (EP10-T04), and an upgrade procedure: any MediaPipe bump must pass the plugin test and the smoke test again.
