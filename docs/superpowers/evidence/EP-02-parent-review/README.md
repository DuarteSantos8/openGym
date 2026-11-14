# EP-02 parent review, 2026-11-14

Initial implementation reviewed: `12f8e8d4`. Parent ran the component suite under Node22: 10/10 passed. In real Chromium, the existing synthetic guest profile received weigh-ins of 80kg on November13 and 79.5kg on November14 through normal UI controls. The resulting accessible group name was `Body weight: 79.5 kg 0.5`, omitting the decrease direction; visible text contained a down arrow. This confirmed the code-review finding. Under emulated reduced motion both the metric and sheet computed `animation-name: none`. [Captured observations](initial-browser.json). The parent stopped both temporary servers and closed its test tab.

At corrected head `c0393641`, static corrections are under independent re-review. Parent visually inspected the committed `after/bodyweight-light-320.png`; the changed card is visible and readable. However, `after/stats-dark-390.png` shows Home, with the Home tab selected. Multiple Stats/Settings files have identical sizes to Home, including baseline captures. These are mislabeled evidence and do not establish those screens were checked. The owner has been instructed to recapture actual routes with a per-image manifest.

Other pending gates: clean console/network with a running disposable API (the owner's first run deliberately produced502s); actual set/rest/save/reload interaction assertions (CSS regex tests do not establish this); final frontend suite/build evidence; independent final review. No EP-02 acceptance or merge is claimed.

## Corrected runtime checkpoint

At `c0393641`, parent Node v22.23.5 focused checks passed 26 tests across 5 files (new primitives/motion scope, Home metric/weight card, ink colors), exit 0. The production build also passed with `RAYON_NUM_THREADS=2 npm exec --yes --package=node@22 -- npm run build`. Baseline `bd1ab806` was built in the same checkout/environment to avoid mixing compression settings. [Measured comparison](bundle-node22.json): entry JS +713 raw / +266 gzip bytes, CSS +1301 raw / +320 gzip; 154 JS/CSS files under `dist/assets` on each side, total +2057 raw / +669 gzip. Gzip uses Node zlib defaults; absolute values differ from baseline-report compression settings, so only this within-run comparison is used. Both builds emitted the existing large-chunk and ineffective dynamic-import warnings. No new dependency.

The owner separately reports a full Node 24.22.1 run: 7,855 tests / 655 files, exit 0. This is explicitly not a Node22 full-suite claim. Browser evidence remains under correction.

## Evidence recheck at 49fa90cb

Draft PR6 now exists. Runtime source is unchanged from c0393641; later changes are tests/documentation/evidence and merges of parent documentation. Routes in the refreshed manifest are correct, and the Stats image now shows Stats. However, parent visual inspection of `after/stats-dark-390.png` shows the light theme. Several dark/light images are byte-identical; the manifest records the requested theme without verifying the observed DOM theme. The six bodyweight/RTL/200%-zoom images still named by the README were deleted in this commit.

The committed browser probe now asserts rest countdown, save/reload and native Enter/Space activation, but the set/start/save actions use DOM `.click()`, bypassing pointer hit-testing; it also depends on an uncommitted `/tmp/cap/state.json`. The owner has been asked to correct the capture theme assertions, restore the missing evidence, and commit a self-contained fixture/script using native pointer actions and measured focus stops. Full-suite repetition is not needed for these evidence-only corrections. Expected guest `/api/me`401 responses are disclosed and are distinguished from unexpected failures. EP-02 evidence remains unaccepted.
