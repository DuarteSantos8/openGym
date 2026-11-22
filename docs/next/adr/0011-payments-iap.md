# ADR 0011: Payments: Stripe on the web first, store billing later

- Status: accepted (2026-11-22, owner go-ahead on the plan's defaults)
- Context: Pro needs a way to pay. The web app can use Stripe directly. The iPhone and Android apps are bound by the stores' own billing rules, which are in active litigation and differ by region (re-check before any native purchase UI ships).

## Decision

1. **Phase A: web and PWA only.** Stripe Checkout for subscribing, the Stripe Customer Portal for everything after (cancel, card, invoices). Both are opened by Edge Functions; the app never sees a secret key.
2. **Native builds ship without purchase UI** in Phase A. A Pro entitlement bought on the web still unlocks in the app, because the entitlement belongs to the account, not the device.
3. **Phase B, when store listings exist:** RevenueCat as the one entitlement layer over StoreKit, Play Billing and Stripe. Its webhooks write `entitlements(source = 'revenuecat')`; the table already has the column.
4. **Entitlements, not price ids, decide access.** The webhook turns Stripe's state into rows in `public.entitlements`; the app asks "does this account have `pro`?" and nothing else.
5. **Works offline.** The app caches a signed token (`entitlement-token`, ES256, about a week plus a week's grace) and checks it locally. When it lapses the account is Free again and **no data is removed**.

## What Pro is, and is not

Free forever, in every edition: logging, every plan, Find my plan, Learn, exercise guidance and safety content, local backup and export, the Coach with your own key, self-hosted sync. Nothing needed to train safely is ever paid.

Pro candidates (hosted convenience and owner-made content, never locked core code): hosted sync and backup, a hosted Coach with no key to set up, extra 3D demo packs, extra form-check patterns, premium programmes, advanced analytics, cosmetic themes.

Self-hosted: everything unlocked. This is also the honest position: the code is AGPL, anyone can rebuild it without a paywall, so Pro sells a service and content, not a switch.

Starting price, to be confirmed by the owner: 3.99 a month or 29.99 a year, in line with loggers (Hevy, Strong), not with plan generators.

## Rules

- Checkout shows the price, the renewal and how to cancel before the button. No pre-ticked extras, a visible close.
- Anonymous (guest) sessions cannot start a checkout.
- The webhook verifies Stripe's signature, records the event id before acting, and re-reads the subscription from Stripe, so replays and out-of-order events end in the right state.
- No secret in the repository, a bundle, a log or an export. `supabase secrets set …` and the host's environment only.

## Not decided here

Store developer accounts and bundle ids for Ironvane (upstream's App Store listing and its AGPL App Store exception belong to upstream's copyright holder), tax settings, and the exact Pro feature list. Each needs the owner.
