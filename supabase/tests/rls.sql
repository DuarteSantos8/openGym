-- Row level security, proven (docs/next/adr/0010-backend-hybrid.md). Plain SQL, no extension:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
--
-- Everything happens in one transaction that is rolled back, so it leaves nothing behind and is
-- safe against a local stack. The first failed expectation raises and stops the script; reaching
-- the last line means every one held. supabase/tests/run-rls-local.sh runs it on a throwaway
-- PostgreSQL with no Supabase at all.

begin;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'RLS expectation failed: %', what; end if;
end $$;

-- Runs `stmt` and expects PostgreSQL to refuse it for lack of privilege.
create function pg_temp.denied(stmt text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'RLS expectation failed (was allowed): %', what;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- Two accounts. A pays; B's subscription has run out.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test');

select pg_temp.expect((select count(*) = 2 from public.profiles), 'the trigger makes a profile for every new user');

insert into public.customers (user_id, stripe_customer_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cus_A'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cus_B');
insert into public.subscriptions (id, user_id, status, current_period_end) values
  ('sub_A', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', now() + interval '20 days'),
  ('sub_B', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'canceled', now() - interval '3 days');
insert into public.entitlements (user_id, feature, source, expires_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pro', 'stripe', now() + interval '20 days'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pro', 'stripe', now() - interval '3 days');
insert into public.webhook_events (id, type) values ('evt_1', 'customer.subscription.updated');
insert into public.content_items (id, kind, tier, published, body) values
  ('free-1', 'guide', 'free', true, '{}'), ('pro-1', 'programme', 'pro', true, '{}'),
  ('pro-draft', 'programme', 'pro', false, '{}'), ('free-draft', 'guide', 'free', false, '{}');

-- ───────────────────────────── signed in as A ─────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

select pg_temp.expect((select count(*) = 1 from public.profiles), 'A sees one profile');
select pg_temp.expect((select bool_and(id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') from public.profiles), 'and it is A''s own');
update public.profiles set display_name = 'Ada', experience = 'beginner' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.expect((select display_name = 'Ada' from public.profiles), 'A can change their own name and level');
update public.profiles set display_name = 'hacked' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select pg_temp.denied($$update public.profiles set node_uid = 'someone-else'$$, 'A cannot link themselves to another API user');
select pg_temp.denied($$update public.profiles set id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'A cannot change their id');
select pg_temp.denied($$insert into public.profiles (id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc')$$, 'A cannot make a profile');
select pg_temp.denied($$delete from public.profiles$$, 'A cannot delete a profile');

select pg_temp.expect((select count(*) = 1 and bool_and(stripe_customer_id = 'cus_A') from public.customers), 'A sees only their own customer');
select pg_temp.expect((select count(*) = 1 and bool_and(id = 'sub_A') from public.subscriptions), 'A sees only their own subscription');
select pg_temp.expect((select count(*) = 1 from public.entitlements), 'A sees only their own entitlement');
select pg_temp.denied($$insert into public.entitlements (user_id, feature, source) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'everything', 'promo')$$, 'A cannot grant themselves a feature');
select pg_temp.denied($$update public.entitlements set expires_at = null$$, 'A cannot extend an entitlement');
select pg_temp.denied($$delete from public.entitlements$$, 'A cannot delete an entitlement');
select pg_temp.denied($$update public.subscriptions set status = 'active'$$, 'A cannot edit a subscription');
select pg_temp.denied($$insert into public.customers (user_id, stripe_customer_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cus_X')$$, 'A cannot write a customer');
select pg_temp.denied($$select * from public.webhook_events$$, 'A cannot read the webhook ledger');
select pg_temp.denied($$insert into public.webhook_events (id, type) values ('evt_x', 'x')$$, 'A cannot write the webhook ledger');

select pg_temp.expect(public.has_entitlement('pro'), 'A has pro');
select pg_temp.expect(not public.has_entitlement('other'), 'A has nothing they were not granted');
select pg_temp.expect((select array_agg(id order by id) = array['free-1', 'pro-1'] from public.content_items), 'A reads published free and pro content, no drafts');
select pg_temp.denied($$insert into public.content_items (id, kind, body) values ('x', 'guide', '{}')$$, 'A cannot publish content');

-- ───────────────────────────── signed in as B ─────────────────────────────
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';

select pg_temp.expect((select display_name is null from public.profiles), 'A''s attempt to rename B changed nothing');
select pg_temp.expect((select count(*) = 1 and bool_and(id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') from public.profiles), 'B sees only B');
select pg_temp.expect((select count(*) = 0 from public.subscriptions where id = 'sub_A'), 'B cannot see A''s subscription');
select pg_temp.expect((select count(*) = 0 from public.entitlements where user_id <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'B cannot see A''s entitlement');
select pg_temp.expect(not public.has_entitlement('pro'), 'an entitlement past its end grants nothing');
select pg_temp.expect((select array_agg(id order by id) = array['free-1'] from public.content_items), 'B reads free content only');

-- ───────────────────────────── not signed in ─────────────────────────────
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select pg_temp.denied($$select * from public.profiles$$, 'a visitor cannot read profiles');
select pg_temp.denied($$select * from public.customers$$, 'a visitor cannot read customers');
select pg_temp.denied($$select * from public.subscriptions$$, 'a visitor cannot read subscriptions');
select pg_temp.denied($$select * from public.entitlements$$, 'a visitor cannot read entitlements');
select pg_temp.denied($$select * from public.webhook_events$$, 'a visitor cannot read the webhook ledger');
select pg_temp.denied($$select public.has_entitlement('pro')$$, 'a visitor cannot ask about entitlements');
select pg_temp.expect((select array_agg(id order by id) = array['free-1'] from public.content_items), 'a visitor reads published free content only');

-- ───────────────────────────── the service ─────────────────────────────
reset role;
set local role service_role;
reset request.jwt.claims;

insert into public.entitlements (user_id, feature, source) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pro', 'promo');
select pg_temp.expect((select count(*) = 3 from public.entitlements), 'the service reads and writes every entitlement');
select pg_temp.expect((select count(*) = 1 from public.webhook_events), 'the service reads the webhook ledger');
update public.profiles set node_uid = 'api-user-1' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.expect((select count(*) = 1 from public.profiles where node_uid = 'api-user-1'), 'the service links a profile to an API user');

-- ───────────────────────────── account deletion ─────────────────────────────
reset role;
delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.expect((select count(*) = 0 from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'deleting the user deletes the profile');
select pg_temp.expect((select count(*) = 0 from public.customers where stripe_customer_id = 'cus_A'), 'and the customer');
select pg_temp.expect((select count(*) = 0 from public.subscriptions where id = 'sub_A'), 'and the subscription');
select pg_temp.expect((select count(*) = 0 from public.entitlements where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'and the entitlements');

-- Every table in `public` has row level security on. A new table without it fails here.
select pg_temp.expect(
  (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'every public table has row level security enabled');

rollback;
\echo RLS: all expectations held
