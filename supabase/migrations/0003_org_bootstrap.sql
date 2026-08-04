-- 0003_org_bootstrap.sql — fix the org-membership bootstrap.
--
-- Found by walking the live auth flow: with 0002's policies a brand-new user
-- can INSERT an organization (created_by = auth.uid()), but CANNOT insert
-- their own row into organization_members, because member_write requires them
-- to ALREADY be an owner/admin of that org. Result: the creator is locked out
-- of their own org (projects, documents, jobs all require membership) — a
-- silent authorization dead-end.
--
-- Fix: a SECURITY DEFINER trigger that enrols the creator as 'owner' the
-- moment an organization row is inserted. SECURITY DEFINER lets the trigger
-- write the membership row past RLS; it only ever inserts the creator's own
-- id, so it cannot be abused to grant membership to anyone else.
-- Also backfills any orgs created before this migration.

create or replace function public.enrol_org_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.organization_members (org_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (org_id, user_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_org_enrol_creator on public.organizations;
create trigger trg_org_enrol_creator
  after insert on public.organizations
  for each row execute function public.enrol_org_creator();

-- Backfill: ensure every existing org has its creator as an owner member.
insert into public.organization_members (org_id, user_id, role)
select o.id, o.created_by, 'owner'
from public.organizations o
where not exists (
  select 1 from public.organization_members m
  where m.org_id = o.id and m.user_id = o.created_by
)
on conflict (org_id, user_id) do nothing;
