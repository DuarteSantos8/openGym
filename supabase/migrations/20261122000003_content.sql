-- Ironvane Cloud edition: content packs served by the hosted service (premium programmes, demo
-- packs). The free Learn content is bundled with the app and never comes from here.

create table public.content_items (
  id text primary key,
  kind text not null check (char_length(kind) between 1 and 32),
  locale text not null default 'en',
  tier text not null default 'free' check (tier in ('free', 'pro')),
  published boolean not null default false,
  body jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.content_items enable row level security;

revoke all on public.content_items from anon, authenticated;
grant select on public.content_items to anon, authenticated;

-- Free and published: anyone, signed in or not.
create policy content_free on public.content_items
  for select to anon, authenticated using (published and tier = 'free');

-- Pro and published: only with a live `pro` entitlement.
create policy content_pro on public.content_items
  for select to authenticated using (published and tier = 'pro' and public.has_entitlement('pro'));

create trigger content_items_touch before update on public.content_items
  for each row execute function public.touch_updated_at();
