# ADR 0008: A separate Cloud edition; the default build keeps the charter unchanged

- Status: accepted (2026-11-22, owner go-ahead on the plan's defaults in `../BEGINNER-CLOUD-PLAN.md`)
- Context: the owner wants accounts on Supabase and a paid tier through Stripe. The charter (`AGENTS.md` §4, `START-HERE.md` Part B §1) says local-first, no telemetry, no third-party runtime calls, and lists "backend replacement, a mandatory managed DB, an auth/sync redesign" as out of scope unless approved. Every E2E test fails on a request that leaves the machine. Supabase and Stripe are third-party runtime calls.

## Decision

Two editions from one codebase, chosen at build time:

| | Default edition | Cloud edition |
|---|---|---|
| Build | `VITE_EDITION` unset (or anything but `cloud`) | `VITE_EDITION=cloud` |
| Who runs it | self-hosters, the offline apps, the public demo | the hosted Ironvane service only |
| Third-party runtime calls | none, as today | Supabase (auth, Postgres, Edge Functions) and Stripe Checkout / Customer Portal, nothing else |
| Accounts | the app's own (passkeys, password, OIDC, guest) | the same, plus Supabase Auth as a way to sign in |
| Paid features | none; everything is unlocked | free tier plus Pro (ADR 0011) |
| Telemetry | none | none |

Rules that make this safe:

1. **Cloud code lives under `frontend/src/lib/cloud/` and is only reached through `import()` behind `isCloud()`** (`frontend/src/lib/edition.js`). Nothing outside that folder may import it statically or name a hosted provider: `frontend/src/lib/edition.test.js` reads the source tree and fails on either. So the default build cannot contain the Supabase client, a Supabase or Stripe address, or a paywall.
2. **The default E2E guard is not weakened.** A second Playwright project for the cloud build may allow exactly these origins and nothing else: the project's own `https://<ref>.supabase.co`, `https://js.stripe.com`, `https://checkout.stripe.com`, `https://billing.stripe.com`.
3. **The API changes nothing unless `SUPABASE_URL` is set.** With it unset, `api/` behaves byte for byte as before (`api/supabase-jwt.js` is not consulted).
4. **Self-hosted means everything.** No feature is paywalled in the default edition, now or later.
5. **No telemetry in either edition.** Stripe and Supabase see what they must to do their job; the app adds no analytics.

## What this amends

`AGENTS.md` §4 "Charter" and `START-HERE.md` Part B §1 gain one sentence: the Cloud edition is the one approved exception to "no third-party runtime calls", limited to the origins above. "Backend replacement" and "auth/sync redesign" stay out of scope: ADR 0010 adds Supabase beside the existing API, it replaces nothing.

## Consequences

- Upstream mergeability is kept: the cloud work is additive files plus one flag.
- Two builds to test. CI runs the default build as before; the cloud build's E2E runs only where a Supabase project and Stripe test keys exist (never in a fork PR from outside).
- Rollback: unset `VITE_EDITION` on the hosted deploy. The default edition is the fallback and needs no migration.
