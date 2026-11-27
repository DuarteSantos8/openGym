# ADR 0014 — Delete linked server profile before the hosted account

Status: merged (#90) and live. One deletion was verified on the hosted service on 2026-11-24, see Hosted verification.

The hosted account and its training profile live in separate stores. Remove the
training profile first while the hosted identity can still prove ownership.

Deployments without an app training server set `VITE_CLOUD_SERVER=off` in the
Cloud build environment. They delete through the hosted function directly.
Other Cloud deployments require the configured server to advertise support
in `oidc.deleteProfile` and the page to match its configured web origin.
Failure to reach or verify the server stops deletion.

After typed confirmation, the linked flow checks hosted deletion eligibility.
An active subscription stops the flow before any training is removed. The
browser then starts the OIDC authorization code flow with PKCE. The callback
verifies a recent `auth_time` in the signed ID token and issues a short-lived,
one-use HttpOnly proof bound to the verified issuer and subject.

On return, the client rechecks hosted eligibility and submits the deletion
proof with explicit confirmation. The API refuses disabled profiles, conflicts
with a different current session, and deletion of the last admin while other
profiles remain. It reuses the ordinary server removal logic. The proof never
opens a browser session. A verified absent profile also allows hosted deletion
to proceed. A local signed-in copy is cleared only when its profile ID matches
the deleted profile. Device-only workouts stay available.

After success or verified absence, the client requests hosted deletion. The
hosted function checks eligibility again. The stores have no shared transaction:
a subscription change or other hosted failure after preflight can still prevent
the final deletion. A retry verifies server profile absence and never recreates
the profile.

## Hosted verification

Deploy the updated `delete-account` Edge Function and the matching API before
activating the linked preview flow. Keep the existing preview build until the
deletion fixes and required release checks have merged and passed. An older
API lacks the capability flag and the older hosted function rejects preflight.
An older browser request lacks explicit confirmation and cannot use the new
proof endpoint to delete training.

Supabase Auth commit `10ef10789d1ee4fb422b448047e67e3e264c0482` passes
`LastSignInAt` as `AuthTime` in its OAuth token handler. A locally simulated
issuer verifies the flow in browser tests.

**Verified on the hosted service, 2026-11-24** (the owner, a disposable account, a private
window; read from the hosted project's request log and from both stores' counts):

- The updated function and the API of #90 were deployed first.
- Sign-up, confirmation and a first Continue made the account and a training profile
  (`/api/health` went from one profile to two).
- A fresh password sign-in, then Delete about 45 seconds later. The log shows the order this
  ADR describes: eligibility check, the delete trip to the issuer, eligibility again, and the
  account's removal answered 200. `/api/health` is back to one profile, the hosted project is
  back to its earlier number of accounts, and the consent on record went with the account.
- The API only issues the proof when the signed ID token carries a recent `auth_time`, so the
  hosted issuer does put one there and it followed the fresh sign-in.

Not tried on the hosted service: a deletion with an old sign-in (the API must refuse it as
stale; the hosted issuer does not read `prompt`, so it will not ask again by itself, see ADR
0013), signing up again with the deleted address, and a deletion in a browser that holds
workouts of its own.
