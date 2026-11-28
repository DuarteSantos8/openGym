# Rollback (EP16-T04)

Every openGym Next epic is **additive**:
- new files;
- one section in `views/Addons.jsx`, one CSS block, one roadmap row;
- for EP13, one coach data category that is off by default.

None of them migrates or rewrites user data. The labs write nothing:
- **Progression lab:** "Writes nothing".
- **Movement lab:** frames are never saved or sent.
- **3D map:** reads workouts only.

So removing an epic means reverting its code. No data repair is needed.

## Keep one revert point per epic

Merge the integration PR (#25) with **"Create a merge commit"**, not squash or rebase. Then each epic stays a single merge commit on `main`:

| Epic | Merge commit on `next/integration-20261115` |
|---|---|
| Docs (plan, ADRs, NEXT-STEPS, AGENTS.md) | `f173fbb13` |
| EP13 coach nutrition context | `5feae7218` |
| EP09 progression lab | `ddfaffb51` |
| EP10 movement lab (MediaPipe) | `e94036cae` |
| EP12 3D muscle map | `4cb93efa9` |

After #25 merges, the same commits are on `main` (`git log --first-parent --merges main`).

## Revert one epic

```bash
git switch -c revert/EP12 origin/main
git revert -m 1 <merge-commit>        # -m 1 keeps main's side
cd frontend && npm ci && npx vitest run --maxWorkers=8 && npm run build \
  && npx vitest run scripts/check-bundle-syntax.test.mjs
# push, open a draft PR, merge it like any other change
```

**Revert in reverse merge order** when reverting more than one (EP12 → EP10 → EP09 → EP13). EP10 and EP12 share lines in `Addons.jsx` and `addons.css` with EP09, so reverting out of order can conflict.

## Tested (2026-11-15)

On a scratch worktree from `next/integration-20261115`, I reverted the EP12 merge (`git revert -m 1 4cb93efa9`):
- the revert applied cleanly;
- no file in `frontend/src` or `frontend/public` still mentions EP12; `three` is gone from `package.json`;
- `npm ci` OK; full suite 934 files / **10495 tests passed**;
- the build is OK, with no `anatomy/` assets in `dist`; the Safari 15.5 bundle check passes.

## Epic-specific notes

- **EP10:**
  - `public/mediapipe/` is created at build time by `scripts/stage-mediapipe.mjs` (gitignored). After a revert, delete any stale local copy; nothing is in the repo.
  - The Vite telemetry-strip plugin goes with the revert. That's correct, because the library goes too.
- **EP12:**
  - Reverting removes the CC BY-SA model and its `ATTRIBUTION.md` together, so no licence obligation is left behind.
- **EP13:**
  - A user who had turned the "nutrition" coach category on keeps that flag in their stored consent after a revert.
  - The reverted code no longer knows the category, so it is never shared. That is safe, but not separately tested.

## A deployed server

Self-hosters run images. To roll back without waiting for a revert PR, redeploy the previous image tag (or `git checkout` the previous release and rebuild). The `./data` folder needs nothing, because no epic changed its format.
