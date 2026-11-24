
# Quality Gates and Evidence

All evidence is per commit, with command, environment, result and explicit failures. A check marked “blocked” is not a pass.

## G0 — Repository and scope
- [ ] Verify GitHub fork `main`, upstream SHA, current PRs and clean worktree.
- [ ] Create isolated feature worktree; list exact changed files before writing.
- [ ] Read current `CLAUDE.md`, `NOTICE.md`, `docs/ARCHITECTURE.md`, workflows and scripts.
- [ ] Document baseline suite status, any known upstream failures and license restrictions.

## G1 — Test-first logic
- [ ] Write outcome-focused test for the behavior; prove RED with real assertion.
- [ ] Implement minimum code; prove GREEN.
- [ ] Refactor without behavior change; run tests again.
- [ ] Add negative input and concurrency cases; use fixtures, not live user data.

## G2 — Data and security
- [ ] Schema version, sync conflict, deletion and migration tests.
- [ ] Backup/export/import/restore parity; old client can round-trip unknown new fields.
- [ ] Authorization and cross-user isolation; OAuth/token scopes and revocation where relevant.
- [ ] Provider allowlist/SSRF, bounded input, rate-limit and no sensitive log leak.
- [ ] User consent, opt-out, correct data source/provenance and provider outage experience.

## G3 — Frontend and native
- [ ] Functional browser E2E for at least one happy path, error path, offline or retry path.
- [ ] Screenshots inspected (not just generated), no console or network errors on tested flows.
- [ ] Keyboard, touch, 320px, reduced motion, contrast, focus management and i18n checks.
- [ ] Bundle and route-loading metrics compared with clean baseline.
- [ ] Android/iOS builds and real hardware verification for native sensors or cameras.

## G4 — Build and documentation
- [ ] Frontend Vitest suite and production build appropriate to scope.
- [ ] API `node --test` suite, MCP tests if affected, OpenAPI route coverage and docs generator.
- [ ] Source-generation/locale checks from repository instructions.
- [ ] Dependencies, model weights and third-party assets recorded with license and source.
- [ ] Documentation gives setup, privacy, limits, troubleshooting and rollback.

## G5 — Review, staging and release
- [ ] Draft PR with exact test logs, diff and implementation plan link.
- [ ] Spec-compliance review and independent code-quality/security review.
- [ ] Staging on isolated hostname with synthetic data; confirm passkeys and sync.
- [ ] Backup/restore and rollback rehearsal.
- [ ] Owner approval for merge/deploy/mobile release; no auto-merge of blocked features.

## Release test matrix
| Surface | Minimum verification |
| --- | --- |
| Browser desktop | Latest Chrome/Firefox + representative Safari where possible; logged-in, offline, backup |
| Mobile web | Modern Android Chrome / iOS Safari; responsive, touch and permission flows |
| Android app | Capacitor build, permissions, Health Connect/watch impact, offline and reconnect |
| iOS app | Capacitor build on macOS runner/device, Apple Health/watch and background behavior |
| Server | Node 22 and Docker on supported Linux, no real secrets in CI |
| Third-party | Local mock + staged real service contract, disconnect, revoke, timeout, retry |
| Accessibility | Screen reader/keyboard checks, WCAG 2.2 AA target, chart alternatives |
| Performance | Defined mid-tier reference device, meaningful baseline-relative thresholds |

Production is not authorized by this document.



