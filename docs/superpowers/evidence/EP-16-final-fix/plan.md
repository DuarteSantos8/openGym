# Confirmed final bounded correction plan

Assigned worktree `/code/openGym-fork/.worktrees/mvp-final-fix`, branch
`fix/mvp-final-review`, base `3864f39e`. Complete final verdict and EP-04/EP-05b briefs read.
Only I1 (insecure-origin UUID capability) and M1 (module-guide drift) are in this wave.

- `frontend/src/lib/nutrition/entry.js`: private UUID creator; preserve native randomUUID
  when present, otherwise use genuine crypto.getRandomValues with RFC 4122 v4 version/variant
  and hyphenated format. No suitable shared UUID-v4 fallback exists: push.js uses a hyphenless
  device ID and coach-local.js permits insecure randomness. Neither is suitable for diary IDs.
- Adjacent capability tests exercise manual and confirmed lookup createEntry paths with real
  Web Crypto entropy, native parity, valid/distinct IDs and unchanged source snapshot/hash.
  Focused component tests exercise real store saves and duplicate-submit guards without native
  randomUUID. Commit actual RED before changing runtime; then GREEN.
- `docs/MODULES.md`: replace stale no-lookup description, link existing operator documentation,
  include server lookup/strict stored-module gate and qualify missing-key defaults for opt-in.
  No artificial failing documentation test.
- Evidence under this directory only. Record commands, exits/counts, source SHA-256, RED/GREEN
  commits, browser capabilities and limitations. Do not edit parent manifest, ledger or verdicts.

Node v22.23.5; existing dependency symlinks only after identical root/frontend/api/mcp lockfile
checks. No installs, dependencies, agents, live provider requests, protected writes, deploy,
push, PR or rebase. One heavy job at a time; focused Vitest maxWorkers=2, build/static checks.
Parent owns the affected final full frontend acceptance run and independent scoped review.

Browser: apply browser-harness skill; own API33107 / preview5180 / CDP9327, throwaway data and
profile. Use sandbox non-loopback HTTP address, verify isSecureContext=false and absent native
randomUUID without deleting it or marking the origin secure. Build the unchanged candidate and
reproduce failed manual/lookup Save, then rebuild and verify both after correction, persistence,
distinct meal IDs/provenance and no duplicate submit. Use only committed EP-05b synthetic HTTPS
transport preload, block exercise media before capture, and seed a synthetic session (no claim
of password/passkey enrollment). Close tab/own daemon and stop only owned PIDs after the browser
command actually completes; remove throwaway credentials/data. Trim evidence EOF whitespace.
