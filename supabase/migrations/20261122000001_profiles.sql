-- Ironvane Cloud edition (docs/next/adr/0010-backend-hybrid.md): the profile row.
--
-- One row per Supabase Auth user, made by a trigger when the user is. Training data does NOT
-- live here: it stays in the app's own API (state-<uid>.json). This row is who the account is in
-- the hosted service, and `node_uid` is the link to the API's user, written by the service role
-- only when an existing account is linked.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  experience text check (experience is null or experience in ('beginner', 'intermediate', 'advanced')),
  node_uid text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Privileges first, policies second: a role needs both to do anything.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- Only these two columns are the user's to change. `node_uid` and `id` are not.
grant update (display_name, experience) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- No insert or delete policy: the row is made by the trigger below and goes with the auth user.

create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
