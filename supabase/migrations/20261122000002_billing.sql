-- Ironvane Cloud edition (docs/next/adr/0011-payments-iap.md): who pays for what.
--
-- Written only by the Edge Functions with the secret key (which bypasses row level security).
-- A signed-in user can read their own rows and nothing else; nobody but the service can write.

create table public.customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id text primary key,                       -- Stripe's subscription id
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  source text not null default 'stripe' check (source in ('stripe', 'revenuecat')),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_id on public.subscriptions (user_id);

create table public.entitlements (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (char_length(feature) between 1 and 64),
  source text not null check (source in ('stripe', 'revenuecat', 'promo')),
  expires_at timestamptz,                    -- null: no end
  updated_at timestamptz not null default now(),
  primary key (user_id, feature, source)
);

-- Every Stripe event id, written before the event is acted on (supabase/functions/stripe-webhook).
create table public.webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.entitlements enable row level security;
alter table public.webhook_events enable row level security;

revoke all on public.customers, public.subscriptions, public.entitlements, public.webhook_events from anon, authenticated;
grant select on public.customers, public.subscriptions, public.entitlements to authenticated;
-- webhook_events: no grant and no policy. Only the service role ever sees it.

create policy customers_select_own on public.customers
  for select to authenticated using ((select auth.uid()) = user_id);
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy entitlements_select_own on public.entitlements
  for select to authenticated using ((select auth.uid()) = user_id);

create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();
create trigger entitlements_touch before update on public.entitlements
  for each row execute function public.touch_updated_at();

-- Whether the caller has a live entitlement to `wanted`. For policies on paid content: it runs
-- as its owner so the policy does not depend on the caller's own right to read entitlements.
create function public.has_entitlement(wanted text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = (select auth.uid())
      and e.feature = wanted
      and (e.expires_at is null or e.expires_at > now())
  );
$$;

revoke all on function public.has_entitlement(text) from public, anon;
grant execute on function public.has_entitlement(text) to authenticated;
