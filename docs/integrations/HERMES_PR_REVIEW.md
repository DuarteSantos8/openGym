# Hermes PR reviewer — integration and verification

This is a documentation-only integration test. No application source, dependencies, CI workflows, deployment settings, or merge rules are changed here.

## Runtime

The existing Hermes Agent runs on the user's Windows workstation. Its native scheduler polls open pull requests in `sorensadrgit-art/openGym` every 15 minutes while the workstation and Hermes gateway are running. It uses the locally configured Hermes inference model. GitHub Actions is not required for the poller.

The scheduler runs a dedicated Python script under the Hermes script directory in no-agent mode. The script fetches PR metadata and changed-file patches using the already authenticated GitHub CLI; then invokes Hermes non-interactively using the restricted web toolset and without persistent instruction files. The script — not the model — is responsible for any GitHub mutation.

## Strict review-only boundary

The script contains one permitted GitHub write: POST a pull-request review with `event=COMMENT`. It cannot merge, approve, push commits, close PRs, edit code, or deploy. It never checks out or executes submitted code. It requires the expected GitHub account, rejects stale PR head commits, verifies its own review marker before posting, and records reviewed commit SHAs to avoid duplicates.

Reviews include the current commit SHA, any supported actionable findings, and an explicit coverage limitation. Large patch sets receive bounded, production-first excerpt reviews rather than unsupported claims of complete coverage. Model output is schema-validated before posting.

## Inspection and operations

- `hermes status` checks the local Hermes gateway and inference configuration.
- `hermes cron list` shows the Hermes GitHub PR Review - openGym job and its enabled/paused status.
- `python hermes_pr_review.py --check` runs a read-only poll of pending PR heads from the script directory.
- `python -m unittest -q test_hermes_pr_review.py` runs the local safety tests.
- Pausing the Hermes cron job stops future automatic reviews; no GitHub configuration needs to be removed.

## Verification and limitations

This draft PR exists solely to verify a real GitHub COMMENT review without merging. The resulting review will appear under the authenticated GitHub account with a Hermes heading, not as a separately named GitHub App. A distinct reviewer identity requires a dedicated GitHub App installation and its own restricted credentials.

The worker depends on the workstation remaining online. Migrating to a VPS later requires verifying the VPS Hermes runtime and credentials separately. No sensitive credentials are stored in this repository.
