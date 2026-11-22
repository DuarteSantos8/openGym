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

## First deploy, in order (owner only; nothing here has been run against a real project)

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
| **Not** checked | Anything against a real Supabase project or real Stripe: the platform's key headers, the Deno entry points, CLI commands, Checkout and Portal pages, live webhooks. Step 7 above is where that happens |
| Not built yet | The sign-in screen and paywall in the app, wiring `api/supabase-jwt.js` into the server, account linking, account deletion and export, native store billing. See `docs/next/BEGINNER-CLOUD-PLAN.md` |
