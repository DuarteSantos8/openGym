# ADR 0010: Supabase beside the API, not instead of it (hybrid)

- Status: accepted (2026-11-22, owner go-ahead on the plan's defaults)
- Context: three options were weighed for the Cloud edition (ADR 0008).

| | A: Supabase replaces the node API | **B: hybrid** | C: node API plus Stripe only |
|---|---|---|---|
| Work | very large: auth, sync, Coach, push, integrations, trainers, MCP and three watch protocols all talk to `api/server.js` | medium | small |
| Charter | breaks "backend replacement… auth/sync redesign" | needs ADR 0008 only | smallest change |
| Offline-first merge (`lib/sync-merge.js`, `api/sync-stamps.js`) | rebuilt on Postgres | unchanged | unchanged |
| Owner's goal (Supabase accounts, RLS, Stripe via Edge Functions) | yes | yes | no |
| Upstream mergeability | lost | kept | kept |

## Decision: B

```
PWA / Capacitor ──(cloud build only, lazy chunk)──> Supabase Auth
      │ Bearer <Supabase access token>                    │
      ▼                                                    ▼
node API (VPS): verifies the token against the     Postgres with RLS:
project's JWKS (api/supabase-jwt.js), maps `sub`   profiles, customers, subscriptions,
to its own user, keeps sync / Coach / push /       entitlements, content_items,
watches exactly as they are                        webhook_events
                                                           ▲
Stripe  <──>  Edge Functions: create-checkout-session, create-portal-session,
              stripe-webhook, entitlement-token
```

## Who owns what

| Data | Lives in | Written by |
|---|---|---|
| Training state (workouts, routines, settings, everything in `S`) | `state-<uid>.json` on the API, as today | the app through `/api/data`, merged by revision |
| Identity for cloud sign-in | Supabase `auth.users` | Supabase Auth |
| Profile row (display name, level, link to the API user) | `public.profiles` | the user (own row), `node_uid` by the service role only |
| Stripe customer, subscriptions, entitlements | `public.customers`, `subscriptions`, `entitlements` | Edge Functions with the service role only; the user can read their own rows |
| Webhook ledger | `public.webhook_events` | service role only; no policy, so nobody else can read it |
| Paid content packs | `public.content_items` | service role; readable free, or with a live `pro` entitlement |

Row Level Security is on for every table, and `supabase/tests/rls.sql` proves the cross-user cases.

## Consequences

- Passkeys, password, OIDC and guest mode keep working in both editions. A cloud user links once: signed in the old way, they present a Supabase token to `/api/link/supabase` (EP19-T05).
- Guests lose nothing: local state is pushed through the existing merge on first sign-in.
- Two systems to back up: the VPS data folder (already done) and Supabase (its own backups on the paid plan).
- Rollback: unset `SUPABASE_URL` on the API and `VITE_EDITION` on the web build. Training data never left the API, so nothing has to be migrated back.
- Self-hosting Supabase on the same VPS is possible but is about ten more containers for one person to run. Deferred.
