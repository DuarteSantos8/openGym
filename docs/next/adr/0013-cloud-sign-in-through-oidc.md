# ADR 0013: Cloud sign-in goes through the API's existing OIDC, with Supabase as the provider

- Status: proposed (2026-11-22). Supersedes the "API verifies a Supabase token" half of ADR 0010 if accepted. Needs one real Supabase project to confirm before it is accepted.
- Context: ADR 0010 planned new API code for the Cloud edition: verify a Supabase access token on the API (`api/supabase-jwt.js`, EP19-T04) and add a link endpoint and a guest upgrade (EP19-T05). Before wiring that into a 3,800-line server, two facts changed the picture.

## What is already there

1. **The API is already a complete OIDC relying party** (`api/oidc/`, upstream #130, `docs/SELF_HOSTING.md` "Sign in with your identity provider"). Set `OIDC_ISSUER` and `OIDC_CLIENT_ID` and it reads `<OIDC_ISSUER>/.well-known/openid-configuration`, runs the authorization-code flow with PKCE (S256), checks the ID token (ES256 or RS256, issuer, audience, nonce), creates the account or links it to a signed-in one, optionally links by verified email (`OIDC_EMAIL_LINKING`), issues the normal session, and hands the phone apps their session through `/api/oidc/app/redeem`. It has its own rate limits, audit entries and tests.
2. **Supabase Auth can be an OpenID Connect provider.** Its OAuth 2.1 server (public beta at the time of writing) offers the authorization-code flow with PKCE, ID tokens with the `openid` scope, a UserInfo endpoint, a JWKS endpoint and OIDC discovery at `https://<project-ref>.supabase.co/auth/v1/.well-known/openid-configuration` (Supabase docs, "OAuth 2.1 Server" and "Getting Started with OAuth 2.1 Server").

Put together, the link between a cloud account and the API's own user is **configuration, not new server code**:

```
OIDC_ISSUER=https://<project-ref>.supabase.co/auth/v1
OIDC_CLIENT_ID=<the client registered in the project's OAuth server>
OIDC_LABEL=Ironvane
OIDC_EMAIL_LINKING=true        # only if Supabase is set to require a confirmed email
```

## Decision

For the Cloud edition, people sign in to the API **through its existing OIDC flow, with the Supabase project as the provider**. No bearer-token path is added to `server.js`.

| ADR 0010 planned | Becomes |
|---|---|
| EP19-T04: wire `api/supabase-jwt.js` into the server | Not done. Set the four variables above |
| EP19-T05: `/api/link/supabase` and guest upgrade | Not built. The OIDC flow's own link mode and first-sign-in merge do it |
| EP19-T03: a sign-in screen | Still needed, and now also a consent page: Supabase sends the person to a page of ours (its `authorization_url_path`) to sign in and approve. Cloud edition only, under `frontend/src/lib/cloud/` and `components/cloud/` |

## Why

- **Less new code on the part that guards every account.** The OIDC module is upstream's, reviewed and tested. A second way to become a user is the kind of change that goes wrong quietly.
- **The phone apps and watches work unchanged**: they already redeem an OIDC sign-in.
- **Self-hosters keep exactly what they have.** Nothing is read unless `OIDC_ISSUER` is set, as today.
- **It keeps the fork mergeable.** No diff in `api/server.js`.

## What this costs

- Supabase's OAuth server is a public beta. If it changes or is withdrawn, the fallback is ADR 0010's original plan: `api/supabase-jwt.js` is kept, tested and unwired for exactly that case.
- One more redirect at sign-in than a direct token would need.
- The consent page is ours to build and keep accessible.

## To confirm on a real project before accepting (owner, then agent)

1. The `iss` in Supabase's ID token equals the `issuer` in its discovery document, character for character. The API insists on that (`api/oidc/jwt.js`).
2. Discovery lists `S256` and an ID-token algorithm the API accepts.
3. A public client (no secret, PKCE only) can be registered, or a secret is set as `OIDC_CLIENT_SECRET`.
4. `email_verified` is present when `OIDC_EMAIL_LINKING` is on.
5. The API's `Sign in with Ironvane` button completes a round trip on a preview deploy, on the web and in one phone build.

If 1 or 2 fails, this ADR is rejected and EP19-T04 goes ahead as first written.

## Not changed

Entitlements (ADR 0011) still key on the Supabase user id. The API knows that id as the OIDC `sub` it stores for the account, so a server-side Pro check can ask Supabase for that user's entitlements with no extra mapping table.
