-- LOCAL TESTING ONLY. Never run against a Supabase project: it already has all of this.
-- The few things a plain PostgreSQL needs before the migrations apply and rls.sql can run:
-- Supabase's three roles, an auth.users table and auth.uid().

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);

-- As on Supabase: the caller's id is the `sub` of the request's JWT claims.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase grants everything in `public` to its roles by default; the migrations must be the
-- ones to take it back, so the shim grants it too.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
