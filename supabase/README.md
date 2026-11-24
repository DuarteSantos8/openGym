# Ironvane Cloud edition: Supabase and Stripe

Only the hosted service uses this folder. A self-hosted or offline openGym / Ironvane never
touches it: the default build makes no third-party request and has no paid tier
(`docs/next/adr/0008-cloud-edition.md`). The decisions behind what is here are ADR 0008 to 0011.

## What is here

| Path | What it is |
|---|---|
| `migrations/` | The schema: `profiles`, `customers`, `subscriptions`, `entitlements`, `webhook_events`, `content_items`, each with row level security |
| `tests/rls.sql` | Proves the security rules: who can read and write what, as two users, a visitor and the service |
| `tests/run-rls-local.sh` | Runs `rls.sql` on a throwaway PostgreSQL. No Supabase, no Docker |
| `functions/_shared/` | The functions' logic as plain modules: Stripe signature check and requests, subscription to entitlement, the signed entitlement token, the four handlers |
| `functions/<name>/index.ts` | Three lines each: hand the request to the handler |
| `tests/*.test.mjs` | Every handler path against a pretend project and a pretend Stripe |
| `functions/_shared/account.js`, `http.js` | Account export and deletion, and what every function shares (replies, the secret-key database client, "who is calling") |
| `tests/live*.test.mjs` | The same things against a real project. Skipped unless one is named in the environment |

Training data is **not** here. Workouts, routines and settings stay in the app's own API
(`state-<uid>.json`). Supabase holds who the account is and what it pays for.

## Run the tests

```bash
node --test supabase/tests/*.test.mjs     # the functions; also runs inside `cd api && npm test`
supabase/tests/run-rls-local.sh           # the security rules; needs initdb, pg_ctl, psql (PostgreSQL 15+)
```

PostgreSQL refuses to start as root. In a root shell (a container), copy the folder somewhere
the `postgres` user can read and run the script as that user:

```bash
cp -r supabase /tmp/sb && chmod -R a+rX /tmp/sb && runuser -u postgres -- /tmp/sb/tests/run-rls-local.sh
```

## The functions

| Function | Called by | Does |
|---|---|---|
| `create-checkout-session` | the app, signed in | `POST { priceId }` → `{ url }` of a Stripe Checkout page. Guests are refused, the price must be on the allow-list, someone already subscribed gets 409 |
| `create-portal-session` | the app, signed in | `POST` → `{ url }` of the Stripe Customer Portal for the caller's own customer |
| `entitlement-token` | the app, signed in | `POST` → `{ token, features, exp }`: a signed note the app checks offline (`frontend/src/lib/cloud/entitlement.js`) |
| `export-account` | the app, signed in | `POST` → the caller's own rows as one JSON document. Never anyone else's, never the payment provider's customer id |
| `delete-account` | the app, signed in | `POST { confirm: "check" }` checks eligibility without deleting. `POST { confirm: "delete" }` checks again and removes the caller's account and every row with it. Both refuse while a subscription is running. An optional `subject` must match the caller or the function returns `403 subject_mismatch` |
| `stripe-webhook` | Stripe | Verifies the signature, writes the event id down, re-reads the subscription from Stripe and makes the rows match |

No SDK is used: `fetch` and Web Crypto only. That is on purpose. The code depends on no library
version, and the same files run under `node --test`.

## Secrets (set in Supabase, never in a file here)

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=… \
  STRIPE_WEBHOOK_SECRET=… \
  STRIPE_PRICE_IDS=price_…,price_… \
  APP_ORIGIN=https://<the web app's origin> \
  ENTITLEMENT_SIGNING_JWK='<private P-256 JWK>'
```

`SUPABASE_URL` and the service key are provided to Edge Functions by the platform; the handlers
read `SUPABASE_SECRET_KEY` or, failing that, `SUPABASE_SERVICE_ROLE_KEY`.

A key pair for the entitlement token (the private half is the secret above; the public half goes
into the web build as `VITE_ENTITLEMENT_PUBLIC_JWK`):

```bash
node -e "import('./supabase/functions/_shared/token.js').then(async m => console.log(JSON.stringify(await m.generateKeyPair(), null, 2)))"
```

Run it on your own machine and paste the two halves straight into where they go. Do not commit
the output. `api/test/no-secrets.test.js` fails the build on a committed key.

## On a real project (2026-11-23)

A project exists and the following ran against it. Its address and publishable key are not in this repository: they go in the cloud build's environment (`.env.example`).

| | |
|---|---|
| Applied | All four: `…_profiles`, `…_billing`, `…_content`, `…_advisors` (the last after the owner confirmed it, since it replaces two policies) |
| Deployed | `export-account`, `delete-account` (both check the caller themselves, so the platform's own token check is off for them) |
| Live tests | `tests/live.test.mjs` and `tests/live-account.test.mjs`: 10 tests, all passing. They are skipped unless the project is named in the environment |
| Advisors | After `…_advisors`: performance has nothing to report. Security has one note left: `webhook_events` has row level security and no policy, on purpose (only the service reads it). The other, leaked-password protection being off, went when it was switched on in the dashboard on 2026-11-23 (step 2 below) |

### Test users

The live tests need two confirmed users, and a third to delete. The project's built-in mail only delivers to its owner's own address, so make them in the SQL editor instead of signing up (pick your own addresses and passwords; keep them out of this repository):

```sql
with u as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '<email>', extensions.crypt('<password>', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
  returning id, email)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now() from u;
```

```sh
LIVE_SUPABASE_URL=https://<ref>.supabase.co LIVE_SUPABASE_KEY=sb_publishable_… \
LIVE_USER_A=<email>:<password> LIVE_USER_B=<email>:<password> [LIVE_USER_DISPOSABLE=<email>:<password>] \
node --test supabase/tests/live.test.mjs supabase/tests/live-account.test.mjs
```

### What only the owner can switch on

None of these can be done from the repository; each is a setting in the project's dashboard (or Vercel's). Those struck through are done. One is left: the OAuth server (it needs the API server's address).

1. ~~Confirm the `…_advisors` migration~~ Done, 2026-11-23.
2. ~~Leaked-password protection~~ On since 2026-11-23 (Authentication, Sign In / Providers, Email), on the free plan; the security advisor no longer asks for it. The minimum password length was raised from 6 to 8 at the same time, to match what the account screen asks for.
3. ~~Custom SMTP~~ Done, 2026-11-23: mail goes through Resend from `no-reply@` on a `mail.` subdomain the owner controls (verified there; four DNS records added at the DNS host). Set up through Resend's own Supabase integration, so the key was never typed or seen. Checked with a real sign-up to Resend's sink address: accepted, delivered, the link pointed at the app's account page, following it confirmed the account, a second use was refused, and the throwaway account was deleted. A reset email was not sent for real. The free plan there allows 100 emails a day.
4. ~~Email templates and URL configuration~~ Done for the preview, 2026-11-23: the confirm and reset links point at the app (`{{ .SiteURL }}/#/account?token_hash={{ .TokenHash }}&type=signup` and `…&type=recovery`), and the Site URL and the one allowed redirect are the cloud preview's address. Followed from a real email on 2026-11-23 (step 3). For production, set them again to the production address.
5. **OAuth server** (Authentication, OAuth Server), for ADR 0013: switch it on, set the authorization path to `/#/account`, register one client whose redirect is `<the API's origin>/api/oidc/callback`.
6. ~~`APP_ORIGIN`~~ Set on 2026-11-23 to the cloud preview's origin, and checked: the functions answer that origin and no other. For the record, it is a function secret holding the web app's origin. Without it a browser cannot call `export-account` or `delete-account` (they answer, but the browser's cross-origin check refuses the reply). One origin only for now.
7. ~~The cloud build's variables~~ Set on 2026-11-23 for the `next/cloud-preview` branch only (see "The cloud preview" below). For production they are still to set, in Vercel: `VITE_EDITION=cloud`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Setting them turns that deployment into the Cloud edition; the default build has none of this code.

### The cloud preview

The branch `next/cloud-preview` is the Cloud edition's preview deployment. Vercel builds it with `VITE_EDITION=cloud` and the project's address and publishable key, set as preview variables scoped to that one branch, so production and every other preview stay the default edition. The branch carries no changes of its own: bring it up to date with `git merge origin/main` and push. Its address is the branch's Vercel preview address, which is what `APP_ORIGIN`, the Site URL and the redirect URLs should name while it is the only cloud deployment.

## First deploy of the payment functions, in order (owner only; not run against real Stripe)

1. Create the Supabase project and the Stripe account (test mode first).
2. `supabase link --project-ref <ref>` then `supabase db push` (applies `migrations/`).
3. Run `tests/rls.sql` against the project's database before any user exists:
   `psql "<connection string>" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql` (it rolls back).
4. Set the secrets above. In Stripe: one product, a monthly and a yearly price; put both ids in `STRIPE_PRICE_IDS`.
5. Deploy: `supabase functions deploy create-checkout-session create-portal-session entitlement-token`
   and `supabase functions deploy stripe-webhook --no-verify-jwt` (Stripe sends no Supabase token;
   the function checks Stripe's own signature instead).
6. In Stripe, add the webhook endpoint `https://<ref>.supabase.co/functions/v1/stripe-webhook` for
   `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`,
   and set its signing secret as `STRIPE_WEBHOOK_SECRET`.
7. Try it with the Stripe CLI and test cards before any live key exists:
   `stripe listen --forward-to https://<ref>.supabase.co/functions/v1/stripe-webhook`.

## Checked here, and not checked here

| | |
|---|---|
| Checked | Schema applies to PostgreSQL 16; every RLS expectation in `rls.sql`; every handler path with a pretend Stripe and database; signature, token and JWT checks, each also verified to fail when the check is removed |
| Checked on a real project | See "On a real project" above: schema, row level security over REST as two users, sign-in and refresh through the app's own client, the two account functions as deployed, a real deletion |
| **Not** checked | Anything against real Stripe (Checkout and Portal pages, live webhooks, the four payment functions as deployed); sign-up and reset emails end to end; the OAuth server |
| Not built yet | The paywall, native store billing, more than one allowed origin for the functions. See `docs/next/BEGINNER-CLOUD-PLAN.md` |

## How the API learns who someone is

Through its own OIDC sign-in, pointed at this project (ADR 0013, proposed). In the Supabase
dashboard: enable the OAuth 2.1 server, set its authorization path to the app's consent page,
register one client whose redirect is `<the API's origin>/api/oidc/callback`. On the API:
`OIDC_ISSUER=https://<ref>.supabase.co/auth/v1` and `OIDC_CLIENT_ID=<that client>`. ADR 0013
lists the five things to check on the first real project. `api/supabase-jwt.js` is the tested
fallback if that route does not hold, and is used by nothing today.
