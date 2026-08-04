-- 0002_rls_policies.sql — Row Level Security for every user-owned table.
-- RLS is ENABLED **and FORCED** (applies even to the table owner). There is
-- deliberately NO anon/public policy on any customer-data table. The service
-- role bypasses RLS by design and is confined to trusted Vercel server
-- routes; browsers only ever hold the publishable key, whose access is
-- exactly what these policies grant.
-- Ref: https://supabase.com/docs/guides/database/postgres/row-level-security

-- Helper exists from 0001: public.is_org_member(uuid)

-- organizations: members can read; only owners update; any authed user may create
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations
  for select to authenticated using (public.is_org_member(id));
drop policy if exists org_insert on public.organizations;
create policy org_insert on public.organizations
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations
  for update to authenticated
  using (exists (select 1 from public.organization_members m
                 where m.org_id = id and m.user_id = auth.uid() and m.role in ('owner','admin')));

-- organization_members: visible to fellow members; managed by owners/admins
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
drop policy if exists member_select on public.organization_members;
create policy member_select on public.organization_members
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists member_write on public.organization_members;
create policy member_write on public.organization_members
  for all to authenticated
  using (exists (select 1 from public.organization_members m
                 where m.org_id = org_id and m.user_id = auth.uid() and m.role in ('owner','admin')))
  with check (exists (select 1 from public.organization_members m
                 where m.org_id = org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));

-- profiles: self only
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
drop policy if exists profile_self on public.profiles;
create policy profile_self on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Membership-scoped tables: one uniform shape.
do $$
declare t text;
begin
  foreach t in array array['projects','documents','extraction_jobs','extraction_results',
                           'boards','devices','review_items','audit_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I
                    for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_member_write on public.%I', t, t);
    execute format('create policy %I_member_write on public.%I
                    for insert to authenticated with check (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_member_update on public.%I', t, t);
    execute format('create policy %I_member_update on public.%I
                    for update to authenticated using (public.is_org_member(org_id))
                    with check (public.is_org_member(org_id))', t, t);
  end loop;
end $$;

-- audit_events are append-only for members: no update policy → RLS denies
-- UPDATE/DELETE for authenticated users (service role writes are unaffected).
drop policy if exists audit_events_member_update on public.audit_events;
