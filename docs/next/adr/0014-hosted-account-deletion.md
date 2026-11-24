# ADR 0014 — Delete the linked server profile before the hosted account

Status: draft prototype. Hosted fresh authentication is unverified.

The hosted account and its training profile live in two stores. Deleting the hosted identity
first removes the way to prove ownership of the training profile, including from a browser
that has never signed in to the server.

After typed confirmation, the Cloud account page starts the existing OIDC authorization
code flow with PKCE and fresh provider confirmation. The callback issues a short-lived,
one-use browser proof for the verified issuer and subject. It skips profile creation and
email linking. The caller must still hold the matching hosted session. The server checks
the proof, refuses to replace an unrelated session, and only opens an existing matching
profile. Verified absence also allows the hosted deletion to proceed.

The client uses the ordinary server account deletion route, including its provider proof,
last-admin guard and training removal. The route checks that the active profile still
matches the expected subject. After successful deletion or verified absence, the client
deletes the hosted account. On server failure, the hosted account remains available for
retry. If the hosted deletion fails after server deletion, retrying confirms the server
profile is absent without recreating it. The two stores do not provide a joint transaction.

The browser test uses the real API and a test issuer. The hosted Supabase issuer still
needs a disposable-account check before release. The local browser suite also exposed a
race with the account session watcher between sign-in and deletion on retry. The prototype
adds a 30-second deletion note for the same hosted account, restored once the server
deletion attempt finishes. A different hosted account still triggers the normal check.

## Hosted provider gate

The open-source Supabase OAuth authorize handler does not read prompt or max_age.
Accept deletion only when the verified ID token carries an authentication timestamp
inside the existing provider proof window. A successful redirect or existing hosted
session alone cannot establish recent authentication.

If the hosted issuer cannot provide that claim, use an explicit hosted reauthentication
step. The server would verify a proof with the configured issuer's JWKS, expected audience,
matching subject and a verifiable recent authentication event. A refreshed access token's
issue time is insufficient. Use the existing profile deletion and last-admin checks after
proof. Limit the proof to the deletion operation instead of opening an ordinary browser
session that the watcher can close. Confirm that profile deletion succeeded or the verified
identity has no server profile before deleting the hosted account. The owner must approve
the alternative before it is enabled.

Upstream Supabase Auth commit 10ef10789d1ee4fb422b448047e67e3e264c0482 passes
user.LastSignInAt as AuthTime in its OAuth token handler. This is source evidence.
The deployed issuer's ID token claim after a fresh password sign-in is still unobserved.
