# Cloud handoff 7: openGym sync user listing for the hub

Repo: `steradrian/gains` (fork of openGym). Work only in the Node API in `api/`, never in `frontend/`. Branch: `feat/sync-users` off the latest `main`. Open one PR into `main`. Stop when the PR is open and CI is green; the owner's main session reviews and merges. Another cloud agent may be working on `api/` audit logging (`fix/tests-and-sync-audit`), so keep your changes in the sync routes.

## Context
"Gains" runs a gateway called "hub" next to openGym. Its sync worker calls openGym's `/api/sync/*` routes (`api/sync-routes.js` and nearby files) with short-lived ES256 hub tokens: `aud=opengym-sync`, `scope=sync`, a `jti` replay cache, and `sub` = the openGym user id. The hub has no way to list openGym's users. It only learns about someone after that person opens the app and the frontend calls the hub's `sync/now`. So a person who logs a workout on another device, or comes back after a while, isn't polled.

## Task
1. Add a sync-only route that lists the users the hub may sync. For example, `GET /api/sync/users?since=<rev>` returns the openGym user id, a `disabled`/`gone` state, and a change marker for each user, paginated. Follow the style and verification of the existing `/api/sync/*` routes.
   - Return only what the hub needs: no names, emails or passkeys.
   - Put a privacy note in the route's comment.
2. The token for this route can't name one user. Decide how it's authorised: for example a hub token with `sub` set to a service principal and `scope=sync-list`, or a separate audience. Write the decision down in the PR body and in `docs/` next to the existing sync token docs, then implement it with the same signature, expiry, audience and jti checks as the other sync routes. Refuse it everywhere else.
3. Tests:
   - a valid token lists users;
   - a wrong scope or audience is refused;
   - a replay is refused;
   - disabled and deleted users appear with their state;
   - pagination is stable under concurrent changes.

## Rules
- Make file changes only with your editor tools, never sed, awk, python or heredocs.
- Run the full api test suite (and the repo's root test script, if it covers `api/`), and report the real exit codes.
- Don't change existing sync routes' behaviour.
- Commit trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`. Stage specific paths. No version bumps.
- In the PR body, also list what the hub needs to change to use the route; the hub repo is separate.
