# Final bounded MVP correction: I1 and M1

Assigned branch `fix/mvp-final-review`, worktree
`/code/openGym-fork/.worktrees/mvp-final-fix`, base `3864f39e3a33eaf491d9094300a3b93f15e89351`.
Complete final verdict read; no other runtime findings added to this one correction wave.
Parent owns scoped re-review and the corrected full frontend acceptance gate.

## Change and history

| Commit | Purpose | Observed result |
| --- | --- | --- |
| `12995194` | Confirm file/test/browser plan before changes | Plan only |
| `d3172713` | Capability and actual component Save RED | 4 failed / 33 passed; exit 1 |
| `82a13000` | Natural insecure HTTP production-browser RED | Both Saves fail; zero rows. Reproduction assertion exits 0 |
| `0a56181b` | UUID runtime GREEN | 37 passed / 0 failed; exit 0 |

I1 changes only `frontend/src/lib/nutrition/entry.js`: a private ID helper still calls native
`crypto.randomUUID()` when available. Otherwise it obtains 16 cryptographically random bytes
from `crypto.getRandomValues`, sets the RFC 4122 version-4 and variant bits, and emits the
canonical hyphenated UUID. No insecure entropy, timestamp, fingerprint-as-ID or dependency.
The existing push helper emits device IDs without UUID formatting and the coach helper permits
insecure randomness; neither is an appropriate reusable diary UUID helper.

Producer contracts, source snapshots, fingerprints, IDs on existing entries, default module
behavior and both UI call sites are unchanged. New domain tests use genuine Node Web Crypto,
check native-path dispatch, valid/distinct supported events and equality of all non-ID fields
across native/fallback paths. They verify deep source-copy preservation. Component tests use
the real store, exercise manual and confirmed-lookup Save without randomUUID, double-submit
guards, persistence, and repeated distinct meals retaining the same source fingerprint.

M1 updates only `docs/MODULES.md`: the optional signed-in/operator-enabled/synced Nutrition
lookup description and existing integration link; the server reader inventory and strict
stored `modules.nutrition === true` gate; and the opt-in missing-key exception. No artificial
documentation RED or runtime change was added for M1.

## Commands and results

All commands ran in the assigned worktree with
`/home/cloudroom-agent/tools/node-v22.23.5-linux-x64/bin` first on PATH: **Node v22.23.5**.
Root/frontend/api/mcp lockfiles matched the parent checkout byte for byte before linking their
existing node_modules into this worktree. No install or dependency change. Lockfile hashes are
in [verification.json](verification.json). Heavy jobs ran sequentially in retained TTY sessions.

| Command | Exit / observed result | Log |
| --- | --- | --- |
| `npm --prefix frontend test -- --maxWorkers=2 src/lib/nutrition/entry-uuid.test.js src/components/nutrition/FoodLookup.test.jsx` before fix | 1; **4 failed / 33 passed**, 2 files | `uuid-red.log` |
| Same focused command after fix | 0; **37 passed**, 2 files | `uuid-green.log` |
| Covering command below | 0; **171 passed**, 14 files, 8.40 s | `covering.log` |
| `npm --prefix frontend run build` before fix | 0; 1.66 s | `build-before.log` |
| `npm --prefix frontend run build` at `0a56181b` | 0; 2.51 s | `build-after.log` |
| `node frontend/scripts/check-locales.mjs` | 0; 19 packs × 3684 keys | `static.log` |
| `node frontend/scripts/check-source-strings.mjs --strict` | 0; 3030 source strings | `static.log` |
| `node scripts/catalogue/build.mjs --check` | 0; 5632 exercises in sync | `static.log` |
| `node scripts/build-coach-assets.mjs --check` | 0; 5632 exercises / 8 prompts in sync | `static.log` |
| `node scripts/build-api-docs.mjs --check` | 0; 93 endpoints / 34 schemas in sync | `static.log` |

```sh
npm --prefix frontend test -- --maxWorkers=2 src/lib/nutrition src/components/nutrition src/views/Nutrition.test.jsx src/store/useStore.nutrition.test.jsx src/store/useStore.contracts.test.jsx src/lib/contracts-fixtures.test.js src/lib/sync-contract-characterization.test.js
```

Build warnings are the existing large chunks and ineffective dynamic imports of Capacitor and
scan-web. Evidence EOF blank lines and the Vite reporter's trailing whitespace are trimmed;
substantive runner output is retained. Final `git diff --check 3864f39e` passes.

**No full suite was run here.** Parent explicitly owns one affected full frontend rerun on the
corrected, reviewed runtime. API/MCP source is unchanged; their prior full evidence can carry
forward under the parent's ruling. These focused passes are not a corrected full-suite claim.

## Real insecure-origin browser proof

Production Vite preview on **5180**, API on **33107**, isolated Chromium profile/CDP **9327**.
The browser used the sandbox's non-loopback origin **http://172.17.0.4:5180**. Both before and
after the fix, actual browser capability reads returned:

```json
{"origin":"http://172.17.0.4:5180","secure":false,"randomUUID":"undefined","getRandomValues":"function"}
```

No capability was deleted or replaced in the browser, and no secure-origin override flag was
used. `browser-seed.py` creates a synthetic signed session, local profile and server profile.
**Password/passkey enrollment was not tested.** Real API authentication, stored Nutrition gate,
lookup route/normalization, profile writes and reload run normally. The committed EP-05b
`synthetic-transport.mjs` preload intercepts provider HTTPS before DNS/network. There was **one
synthetic transport request** (later previews used the real server cache), **zero live provider
requests**. Exercise-media and browser HTTPS requests were blocked before navigation/capture.

Before correction, `browser-red.py` confirmed manual Save and confirmed lookup Save both show
“Could not save food”, with zero persisted entries. `browser-red.log` exits 0 because it asserts
the failures. Two earlier startup coordinate attempts failed before reaching Save; their logs
are retained as `browser-red-attempt.log` and `browser-red-attempt2.log`. Waiting for initial
boot/layout to settle allowed the actual reproduction; those attempts are not feature passes.

After correction, `browser-green.py` exits 0 and proves:

- Manual Save records 0.024 g protein and a supported v4 ID.
- Explicit synthetic lookup previews without saving; Save stores 250 mL, 100 kcal and known
  zero protein, omitting unknown carbohydrate. The original source is 40 kcal per 100 mL.
- Two pointer clicks per Save create only one entry. A later deliberate Save of the same product
  creates a second distinct lookup meal: three total entries, three valid distinct v4 IDs.
- Both lookup meals keep the same source snapshot and fingerprint. Real API state holds all
  three IDs; page reload retains them and their source snapshot/fingerprint.
- Captured window error/unhandled-rejection events remain empty across the corrected flow and
  reload. Expected pre-fix generic Save errors are recorded separately, not hidden.

Scripts are replayable with the specified seed and owned service configuration. Browser command:

```sh
BU_NAME=mvp-final-fix BU_CDP_URL=http://127.0.0.1:9327 browser-harness < docs/superpowers/evidence/EP-16-final-fix/browser-red.py
BU_NAME=mvp-final-fix BU_CDP_URL=http://127.0.0.1:9327 browser-harness < docs/superpowers/evidence/EP-16-final-fix/browser-green.py
```

Screenshots: [manual failure](before-manual-save-error-390.png),
[lookup failure](before-lookup-save-error-390.png), [saved entries after fix](after-manual-and-lookup-saved-390.png).
[browser-results.json](browser-results.json) contains assertions/capabilities;
[verification.json](verification.json) contains the synthetic saved rows and source hashes.

The GREEN browser command completed successfully and closed its owned tab **before** cleanup.
The named `mvp-final-fix` harness daemon was stopped with `--reload`. Only owned PIDs
58440/58441/58442 were stopped, and `.mvp-final-runtime` (data, profile, secret and cookie) was
removed after confirming those processes stopped. See [cleanup.json](cleanup.json).

## Source identity and remaining gates

Runtime source SHA-256 for `frontend/src/lib/nutrition/entry.js`:

- Before: `6b4ac21df2fba3e9a671f6deb65edf5f26147b8cfa7d9731cf29726d62edf515`
- After: `6d3bf2e5bcc79c3b98c12e1f0b6d4e3593e481168b3d0157cd45bd868d344081`
- Synthetic preload unchanged: `3da978bcdd985bcd960fc63336a81f59f0c532babfd18d2e33d7c2a0f1e6ccc9`

No additional runtime changes followed `0a56181b`. No subagent, live-provider call, protected
write, deployment, push, PR, GitHub review, rebase, progress-ledger or parent-manifest edit.
Independent scoped source review and corrected full frontend acceptance remain parent-owned.
Desktop Chromium/synthetic sessions do not certify physical/native devices, Safari, passkey
staging, Docker boot, CI/CLA or production release readiness. Existing external release gates
from the original verdict remain unchanged. Original reports were read, never edited.
