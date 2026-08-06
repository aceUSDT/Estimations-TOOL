drop function if exists public.redeem_manager_test_pass(text);

create function public.redeem_manager_test_pass(p_token_hash text)
returns table(pass_id uuid, expires_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update public.manager_test_passes
  set redeemed_at = now()
  where token_hash = p_token_hash
    and redeemed_at is null
    and expires_at > now()
  returning id, manager_test_passes.expires_at;
$$;

revoke all on function public.redeem_manager_test_pass(text) from public, anon, authenticated;
grant execute on function public.redeem_manager_test_pass(text) to service_role;
