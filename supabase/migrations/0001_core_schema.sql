-- 0001_core_schema.sql — Estimation Tools core schema
-- Reviewable, repeatable (idempotent guards), never run automatically by the
-- app. Apply via `supabase db push` / SQL editor by the owner or CI with
-- explicit approval. No destructive statements (no DROP of user data).
--
-- Design notes (docs/MIGRATION_VERCEL_SUPABASE.md §4):
--  * UUID PKs, created_at/updated_at everywhere (trigger-maintained).
--  * Ownership via organizations + membership; RLS ENABLED + FORCED on every
--    user-owned table; policies are membership-based; NO public/anon access.
--  * Documents table stores METADATA ONLY — raw PDFs are never stored in
--    Postgres and are never uploaded automatically (local-first boundary).
--  * JSONB only where structure is genuinely variable (model payloads,
--    diagnostics). Boards/devices/review items are normalized rows.
--  * The service role bypasses RLS by design; it is used ONLY inside trusted
--    Vercel server routes and never shipped to a browser.

create extension if not exists pgcrypto;

-- ── updated_at maintenance ────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── organizations & membership ────────────────────────────────────────────
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.organization_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner','admin','member')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists idx_org_members_user on public.organization_members(user_id);
create index if not exists idx_org_members_org  on public.organization_members(org_id);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Membership helper used by every policy (security definer so RLS on the
-- membership table itself doesn't recurse).
create or replace function public.is_org_member(check_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = check_org and m.user_id = auth.uid()
  );
$$;

-- ── projects & documents ─────────────────────────────────────────────────
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  status      text not null default 'active' check (status in ('active','archived')),
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_projects_org on public.projects(org_id);

-- METADATA ONLY. Originals stay on the customer's device by default.
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  filename      text not null,
  mime_type     text,
  byte_size     bigint check (byte_size is null or byte_size >= 0),
  sha256        text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  page_count    integer check (page_count is null or page_count >= 0),
  local_ref     text,              -- client-side handle; NOT a server path
  cloud_consent boolean not null default false,
  cloud_consent_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_documents_project on public.documents(project_id);
create index if not exists idx_documents_org     on public.documents(org_id);

-- ── extraction jobs & results ─────────────────────────────────────────────
create table if not exists public.extraction_jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  page_number     integer not null check (page_number >= 1),
  state           text not null default 'queued'
                  check (state in ('queued','running','complete','needs_review','incomplete','failed')),
  idempotency_key text not null,
  correlation_id  text not null,
  provider        text not null default 'gemini',
  model           text,
  verify_model    text,
  attempt         integer not null default 0,
  error_code      text,             -- stable machine code, e.g. 'worker_lost'
  error_detail    text,             -- safe human detail; NEVER provider secrets
  heartbeat_at    timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, idempotency_key)          -- idempotent start requests
);
create index if not exists idx_jobs_project  on public.extraction_jobs(project_id);
create index if not exists idx_jobs_document on public.extraction_jobs(document_id);
create index if not exists idx_jobs_state    on public.extraction_jobs(state);

create table if not exists public.extraction_results (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  job_id          uuid not null references public.extraction_jobs(id) on delete cascade unique,
  document_id     uuid not null references public.documents(id) on delete cascade,
  page_number     integer not null,
  structured      jsonb not null,   -- model output after coerceResult (variable shape)
  verification    jsonb,            -- nullable cross-check summary
  schema_valid    boolean not null default false,
  device_count    integer not null default 0,
  board_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_results_document on public.extraction_results(document_id);

-- ── normalized take-off rows (provenance-first) ──────────────────────────
create table if not exists public.boards (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  document_id   uuid references public.documents(id) on delete set null,
  job_id        uuid references public.extraction_jobs(id) on delete set null,
  ref           text not null,
  ways_total    integer,
  incomer_rating_a numeric,
  page_number   integer,
  confidence    numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_boards_project on public.boards(project_id);
create index if not exists idx_boards_ref     on public.boards(project_id, ref);

create table if not exists public.devices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  board_id      uuid references public.boards(id) on delete cascade,
  document_id   uuid references public.documents(id) on delete set null,
  job_id        uuid references public.extraction_jobs(id) on delete set null,
  way           text,
  device_class  text,
  rating_a      numeric,
  poles         integer,
  curve         text,
  qty           integer not null default 1 check (qty >= 0),
  confidence    numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  page_number   integer,          -- provenance: page
  source_region text,             -- provenance: line/bbox reference on the page
  source_text   text,             -- provenance: the raw text the row came from
  review_state  text not null default 'pending'
                check (review_state in ('pending','confirmed','rejected')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_devices_project on public.devices(project_id);
create index if not exists idx_devices_board   on public.devices(board_id);

create table if not exists public.review_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  kind          text not null,     -- e.g. 'cross_check_mismatch','zero_row_page','ways_unaccounted'
  reason_code   text not null,     -- stable machine code
  detail        text,
  board_id      uuid references public.boards(id) on delete cascade,
  device_id     uuid references public.devices(id) on delete cascade,
  job_id        uuid references public.extraction_jobs(id) on delete cascade,
  state         text not null default 'open' check (state in ('open','resolved','dismissed')),
  resolved_by   uuid references auth.users(id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_review_project_state on public.review_items(project_id, state);

-- ── audit trail (no document content, ever) ──────────────────────────────
create table if not exists public.audit_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  actor         uuid references auth.users(id),
  action        text not null,     -- e.g. 'job.start','job.complete','review.resolve'
  entity_type   text not null,
  entity_id     uuid,
  summary       text,              -- safe summary; NEVER raw document content
  correlation_id text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_org_time on public.audit_events(org_id, created_at desc);

-- ── updated_at triggers ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['organizations','organization_members','profiles','projects',
                           'documents','extraction_jobs','extraction_results','boards',
                           'devices','review_items']
  loop
    execute format('drop trigger if exists trg_%I_updated on public.%I', t, t);
    execute format('create trigger trg_%I_updated before update on public.%I
                    for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;
