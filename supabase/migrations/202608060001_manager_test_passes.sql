create table if not exists public.manager_test_passes (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'Manager evaluation',
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.manager_test_passes enable row level security;
alter table public.manager_test_passes force row level security;

create or replace function public.redeem_manager_test_pass(p_token_hash text)
returns table(pass_id uuid)
language sql
security definer
set search_path = public
as $$
  update public.manager_test_passes
  set redeemed_at = now()
  where token_hash = p_token_hash
    and redeemed_at is null
    and expires_at > now()
  returning id;
$$;

revoke all on public.manager_test_passes from public, anon, authenticated;
revoke all on function public.redeem_manager_test_pass(text) from public, anon, authenticated;
grant execute on function public.redeem_manager_test_pass(text) to service_role;

comment on table public.manager_test_passes is
  'Single-use manager demo passes. Only SHA-256 token hashes are retained.';
