### What this changes

### Why

*Link the issue if there is one: `Closes #123`.*

### Checklist

- [ ] `npm test` passes in `frontend/` (and in `mcp/` if you touched it)
- [ ] `npm run build` succeeds
- [ ] User-facing strings are in every locale pack — `node scripts/check-locales.mjs`
- [ ] No new runtime dependency, or the MR explains why one is unavoidable
- [ ] CHANGELOG.md is left alone — release notes are written at release time

<!-- The pipeline runs the same checks on every MR. An APK build and a container build are
     available as manual jobs on the pipeline if your change needs one. -->
