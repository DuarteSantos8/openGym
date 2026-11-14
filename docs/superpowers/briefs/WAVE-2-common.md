# Wave 2 common instructions (EP-03, EP-04, EP-05a)

Dispatched 2026-11-14 by the orchestrator. Base: `next/integration` at `42d75a41` (EP-00, EP-01
and EP-02 merged), plus the orchestrator's docs-only commits. Your brief is the approved, bounded
design for your task. The epic file under `docs/superpowers/plans/` is only an outline.

The section "Common rules for every openGym Next task" in `docs/superpowers/briefs/EP-02.md`
applies to you in full (read first, way of working, hard limits, verify before handoff, git).
The points below override it where they differ.

## Environment

### Codex continuation authorization (2026-11-14)

The owner explicitly approved waiving the unavailable Windows-only shared-policy, skill-writer
and RTK prerequisites for this cloud run, and using Codex agents through Cloudroom instead of
the unavailable draftbus server. Use local Linux tools and Cloudroom child-thread messaging.
Do not use or resume Claude. This exception does not waive project scope, privacy, review,
test evidence, dependency approval, or protected-branch restrictions. Independent review may
use a separate Codex agent; the old cross-vendor wording does not require using Claude.

The original EP-03 and EP-05a Claude attempts stopped during inspection, before source edits;
EP-04 stopped at the now-waived prerequisite. New Codex assignments supersede those attempts.

- You are in your own isolated cloud checkout on your own branch. Use that branch. Do not use or
  push to any branch another thread owns, `main`, or `next/integration`.
- Do not spawn agents. Do not edit `docs/superpowers/progress.md`; the orchestrator owns it.
- Node 22 is the reference (CI and the Dockerfiles use it). If `node -v` is not 22, install the
  official Node 22 tarball under `~/tools` and put it first on `PATH`. Report the exact version.
- Install existing dependencies in root, `frontend`, `api`, `mcp` with `npm ci`. No new
  dependencies at all in this wave. If you think you need one, stop and say so in the handoff.
- Run one heavy suite at a time and cap workers (`npx vitest run --maxWorkers=3`).
- GitHub Actions cannot run on this fork right now (dispatch answers 422 "Actions has been
  disabled"). Your local Node 22 runs are the evidence, so quote real counts.
- Baseline on `42d75a41`, Node 22.23.5, measured by the orchestrator on 2026-11-14:
  see `docs/superpowers/progress.md`. Any failure you see that is not in that baseline is yours.
- Never feed exercise media to an AI tool. For browser checks, use a synthetic profile and block
  `/exercise-media/` requests before taking screenshots.
- Stop only processes you started, by PID. Give a headless browser its own `--user-data-dir`.
  Stop your servers before you finish.

## Order of work

1. Read the documents listed in EP-02's common rules plus `docs/product/DATA_CONTRACTS.md`.
2. Inspect the real code. Write `docs/superpowers/plans/<EPIC>-tasks.md` with the confirmed file
   list, interfaces and the tests you will write. Commit it before any source change.
3. RED commit (failing tests, failure output quoted in the commit body), then GREEN commit, per
   behaviour. The reviewer checks this order in `git log`.
4. Full verification (the command list in EP-02's common rules), one suite at a time.
5. Push your branch. Open a **draft** PR against `next/integration` titled `EP-0X: ...`, with
   What/Why, files, tests with real counts, evidence paths, limitations. Do not merge anything.

## Handoff (your final message)

Report only what you ran and saw:

- Branch, head commit, draft PR number.
- Files changed, grouped by purpose. Any file outside your authorized paths, and why.
- RED and GREEN commits per behaviour.
- Exact commands and results: frontend, api, mcp counts; build; locale and source-string checks;
  generator checks. Node version.
- Browser evidence paths, if your task has UI.
- Everything UNVERIFIED or BLOCKED, with the reason.
- Integration notes for the orchestrator: locale keys added, shared files touched, follow-ups.
