<!-- Thanks for the PR! Keep it to one thing; small PRs get merged fastest. -->

### What and why
<!-- One or two sentences. Link the issue: Fixes #123 -->

### Affected user journey
<!-- Who uses this, where they start, and what changes for them. -->

### Changed files
<!-- Group the files by purpose. -->

### Schema and feature flags
<!-- Data/schema version, migration and older-client impact; flags and defaults. Say none when applicable. -->

### Tests
<!-- List each command, result (including failures/skips), and environment (OS, Node, browser/device). Link logs. -->

### Screenshot evidence for UI
<!-- Attach before/after evidence for UI changes, or say no UI change. Exclude exercise media. -->

### Licence and media impact
<!-- Sources and licences for new code, data or models; media rights and privacy impact. Say none when applicable. -->

### Deployment and rollback
<!-- Deployment steps, recovery/rollback steps, and any data that cannot be rolled back. -->

### Limitations
<!-- Blocked checks, known limits and follow-up work. Do not label unrun checks as passed. -->

### Epic plan
<!-- Link the relevant file under docs/superpowers/plans/. -->

### Where did you try it?
- [ ] Web app (browser / home-screen PWA)
- [ ] iPhone app (simulator, your own device, or TestFlight)
- [ ] Apple Watch app
- [ ] Android app (APK or emulator)
- [ ] Self-hosted server (docker compose)
- [ ] Only tests, no UI change

### Checklist
- [ ] Tests added or updated (`cd frontend && npm test`, `cd api && npm test`)
- [ ] New UI text goes through `t()` and is in every locale pack (`node scripts/check-locales.mjs`)
- [ ] Screenshots or a short clip for UI changes (no exercise animations in them, please)
- [ ] I signed the [CLA](../CLA.md) (the bot asks on your first PR)
