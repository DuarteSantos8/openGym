# openGym Next: Complete Build Plan — Master Document

This single-file export combines the project documents and 17 actionable epic outlines. Its source remains in the bundled folder.

# openGym Next — Full Superpowers Build Plan

**Planning date:** 2026-11-13  
**Target repository:** https://github.com/sorensadrgit-art/openGym  
**Verified current baseline:** only `main`, SHA `68dad18f8ffaa20e8d69d936f9acd16233098b3d`, matching upstream. Old PRs #1/#2 closed without merges.  
**Build status:** Documentation/planning package only; no new implementation, PR or deployment was performed while creating this package.

## Read in this order

1. `docs/product/PRODUCT_SPEC.md` — product intent, user journeys, MVP and design constraints.
2. `docs/product/ARCHITECTURE_DECISIONS.md` — the core technical trade-offs and source-of-truth rules.
3. `docs/superpowers/plans/2026-11-13-opengym-next-master.md` — complete roadmap, dependencies, phase exits and release gates.
4. `docs/product/QUALITY_GATES.md` — verification and test matrix.
5. `docs/product/LICENSE_PRIVACY_REGISTER.md` — source/model/media/licensing risks.
6. `docs/superpowers/plans/EP-00-baseline.md` through `EP-16-release.md` — 17 independent implementation outlines.
7. `CLAUDE_START_HERE.md` — ready-to-paste agent handoff.

## The process

Use Superpowers: brainstorm/approve a bounded feature design → isolated worktree → refine its epic plan into small specific implementation steps → write failing tests → implement → verify → independent review → draft PR. Prefer code simplicity and evidence over large dependency installations.

**Important:** This package is a *program roadmap plus detailed epic outlines*. Superpowers' strict per-feature plan expects exact file paths, interfaces, and individually checkable code/test steps after that feature's design is approved and its current source is inspected. Proposed file paths here must be checked against the repository before writing. Do not hand all 17 epics to an agent as a single unreviewed bulk job.

## GitHub usage

Claude Code can use a fresh cloud workspace attached to `sorensadrgit-art/openGym`, starting at `main`. Create a new feature worktree and branch only after checking current SHA; use focused draft PRs. This ZIP is not automatically saved to the GitHub repository. If you want these files under your repo, copy the `docs/` tree to a docs-only branch and open a draft PR for review.

## First milestone

**EP-00 Baseline, Recovery and CI**. Record a clean upstream test/build baseline with exact evidence. Then execute EP-01 data contracts and EP-02 design only within reviewed, independently testable changes. Release MVP requires diary and food lookup before advancing to optional 3D/ML/AI experiments.



