-- 0004_commerce_kv.sql — entitlement store for the paid-download flow.
--
-- A simple strongly-consistent KV (the commerce code's storage contract),
-- holding entitlement records and derived pointers:
--   entitlement:<checkout_session_id>          → record (jsonb)
--   email:<HMAC-SHA256(normalised_email)>      → entitlement key (string)
--   payment-intent:<stripe_payment_intent_id>  → entitlement key (string)
--   event:<stripe_event_id>                    → processed marker
--   restore:<SHA-256(random_restore_token)>    → pending restore grant
-- No card data and no raw email is ever stored; keys are server-derived.
--
-- Access model: RLS enabled + FORCED with NO policies — anon and
-- authenticated roles can do NOTHING here; only the server's service-role
-- client touches entitlements. Idempotent; safe to re-run.

create table if not exists public.commerce_kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.commerce_kv enable row level security;
alter table public.commerce_kv force row level security;

comment on table public.commerce_kv is
  'Paid-download entitlements (service-role only; no client policies by design).';
