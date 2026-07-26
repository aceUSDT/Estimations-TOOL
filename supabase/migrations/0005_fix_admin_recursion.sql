-- 0005_fix_admin_recursion.sql — fix infinite RLS recursion + a column-name
-- collision bug, both found by live-testing gate #8 (no cross-tenant reads)
-- against a real database.
--
-- Bug 1 (infinite recursion, SQLSTATE 42P17): 0002's `member_write` policy on
-- organization_members checks "is this user an owner/admin of this org?" with
-- a RAW subquery against organization_members itself:
--
--   using (exists (select 1 from public.organization_members m
--                  where m.org_id = org_id and m.user_id = auth.uid() ...))
--
-- Because that policy applies `for all` (every command, including the
-- implicit reads Postgres performs while evaluating the policy itself), this
-- subquery must itself be RLS-checked against organization_members — which
-- requires evaluating member_write again — forever. is_org_member() (used by
-- member_select) avoids this correctly via SECURITY DEFINER; member_write's
-- own raw subquery never went through that bypass. Confirmed live: owner
-- `postgres` genuinely has BYPASSRLS (ruled out as the cause) — the bug is
-- structural, not a privilege issue.
--
-- Bug 2 (silently-always-false, plain SQL bug): 0002's `org_update` policy on
-- organizations reads:
--
--   using (exists (select 1 from public.organization_members m
--                  where m.org_id = id and m.user_id = auth.uid() ...))
--
-- The unqualified `id` was meant to mean organizations.id (the row being
-- updated), but organization_members ALSO has its own `id` column, and Postgres
-- resolves an unqualified column against the innermost scope first — so `id`
-- silently means `m.id`, not the outer table's id. `pg_policies` confirms the
-- live definition really does read `m.org_id = m.id`. Result: org_update could
-- practically never match, so no owner/admin could ever update their org.
--
-- Fix: a second SECURITY DEFINER helper, is_org_admin(), mirroring
-- is_org_member()'s already-correct pattern — used by BOTH broken policies.
-- This fixes the recursion (member_write) and the column collision
-- (org_update) with the same change, since routing through the function
-- removes the raw self-referencing subquery in both places.

create or replace function public.is_org_admin(check_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = check_org and m.user_id = auth.uid() and m.role in ('owner','admin')
  );
$$;

drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations
  for update to authenticated
  using (public.is_org_admin(id));

drop policy if exists member_write on public.organization_members;
create policy member_write on public.organization_members
  for all to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));
