-- What the project's own security and performance advisors said about the first three
-- migrations, on the first real project (2026-11-23).

-- 1. has_entitlement ran as its owner (SECURITY DEFINER) and was callable over the REST API by any
--    signed-in user. It never needed the owner's rights: a signed-in user may already read their
--    own entitlement rows (entitlements_select_own), and that is all it looks at. As the caller,
--    row level security does the scoping and the function can do no more than its caller could.
create or replace function public.has_entitlement(wanted text) returns boolean
  language sql stable security invoker set search_path = ''
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

-- 2. content_items had two permissive SELECT policies for a signed-in user, so both ran on every
--    row. One policy per role instead: visitors read free published content, and a signed-in
--    user reads that plus pro content when entitled. The entitlement is asked once per query
--    (the scalar subquery), not once per row.
drop policy content_free on public.content_items;
drop policy content_pro on public.content_items;

create policy content_visitor on public.content_items
  for select to anon using (published and tier = 'free');

create policy content_signed_in on public.content_items
  for select to authenticated
  using (published and (tier = 'free' or (tier = 'pro' and (select public.has_entitlement('pro')))));
