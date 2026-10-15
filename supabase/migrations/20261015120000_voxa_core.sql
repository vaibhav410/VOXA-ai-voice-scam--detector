-- VOXA core schema (Backend, Database & Privacy PRD v1.0 + v1.1 addendum).
--
-- Safe to run more than once: every statement is idempotent and nothing is dropped or reset.
-- Applied by `supabase db push` (Supabase CLI) or `npm run db:migrate` (VOXA runner); both record the version.
--
-- Isolation: everything lives in schema "voxa", which Supabase does not expose through its Data API.
-- Row-level security is ENABLED on every table with NO policies, and the Supabase client roles (anon,
-- authenticated) have no rights here. Only the server's own database role (the table owner) can read or
-- write, so a leaked publishable/anon key exposes nothing.
--
-- No raw media is ever stored. Transcripts are stored only encrypted (AES-256-GCM, application side) and only
-- when the user opted in and an encryption key is configured.

create schema if not exists voxa;

create table if not exists voxa.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- identity
create table if not exists voxa.users (
  id               uuid primary key default gen_random_uuid(),
  auth_subject     text not null unique,               -- Clerk user id (sub); never a password
  email            text,
  email_normalized text unique,
  display_name     text,
  status           text not null default 'active' check (status in ('active', 'disabled')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Global roles are separate from team roles and can only be granted by the server-side CLI (never by an API).
create table if not exists voxa.global_roles (
  user_id     uuid primary key references voxa.users(id) on delete cascade,
  role        text not null check (role = 'super_admin'),
  granted_via text not null default 'cli' check (granted_via in ('cli')),
  granted_at  timestamptz not null default now()
);

create table if not exists voxa.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  created_by uuid references voxa.users(id) on delete set null,
  plan_code  text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists voxa.team_memberships (
  team_id   uuid not null references voxa.teams(id) on delete cascade,
  user_id   uuid not null references voxa.users(id) on delete cascade,
  role      text not null check (role in ('admin', 'user')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_memberships_user_idx on voxa.team_memberships (user_id);

create table if not exists voxa.invitations (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references voxa.teams(id) on delete cascade,
  email_normalized text not null,
  role             text not null check (role in ('admin', 'user')),
  token_hash       text not null unique,                -- SHA-256 of the one-time token; the token itself is never stored
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_by      uuid references voxa.users(id) on delete set null,
  invited_by       uuid references voxa.users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists invitations_team_idx on voxa.invitations (team_id);

-- ---------------------------------------------------------------- reports
create table if not exists voxa.analyses (
  id                    uuid primary key default gen_random_uuid(),
  client_ref            text,                           -- the browser report id (INC-...), for de-duplication
  owner_user_id         uuid not null references voxa.users(id) on delete cascade,
  team_id               uuid references voxa.teams(id) on delete set null,   -- null = personal
  modality              text not null check (modality in ('voice', 'image', 'video', 'text')),
  report_type           text not null check (report_type in ('voice_authenticity', 'scam_analysis', 'noise_analysis', 'privacy_analysis', 'image_authenticity', 'video_authenticity')),
  status                text not null default 'completed' check (status in ('queued', 'processing', 'completed', 'partial', 'failed')),
  review_status         text not null default 'open' check (review_status in ('open', 'investigating', 'resolved', 'fp')),
  title                 text check (title is null or char_length(title) <= 200),
  sector                text,
  policy_version        text,
  upload_ref            text,
  summary_json          jsonb not null default '{}'::jsonb,  -- sanitized report: no transcript, no excerpts, no raw provider payloads
  transcript_ciphertext text,                          -- AES-256-GCM, versioned, key id inside; null unless opted in
  transcript_expires_at timestamptz,
  retention_mode        text not null default 'standard' check (retention_mode in ('standard', 'extended')),
  created_at            timestamptz not null default now(),
  completed_at          timestamptz,
  expires_at            timestamptz not null,
  unique (owner_user_id, client_ref),
  check (transcript_ciphertext is null or transcript_ciphertext like 'v1.%')
);
create index if not exists analyses_owner_idx  on voxa.analyses (owner_user_id, created_at desc);
create index if not exists analyses_team_idx   on voxa.analyses (team_id, created_at desc);
create index if not exists analyses_expiry_idx on voxa.analyses (expires_at);

create table if not exists voxa.provider_runs (
  id          uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references voxa.analyses(id) on delete cascade,
  provider    text not null,
  task_type   text not null check (task_type in ('authenticity', 'transcription', 'intelligence', 'liveness', 'noise', 'privacy')),
  status      text not null check (status in ('ok', 'unavailable', 'failed', 'blocked', 'skipped')),
  started_at  timestamptz,
  finished_at timestamptz,
  error_code  text check (error_code is null or char_length(error_code) <= 64)
);
create index if not exists provider_runs_analysis_idx on voxa.provider_runs (analysis_id);

create table if not exists voxa.findings (
  id            uuid primary key default gen_random_uuid(),
  analysis_id   uuid not null references voxa.analyses(id) on delete cascade,
  finding_type  text not null check (finding_type in ('authenticity', 'scam_intent', 'noise', 'privacy', 'context')),
  score         double precision,                        -- null when unavailable; never substituted with 0
  label         text,
  evidence_json jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists findings_analysis_idx on voxa.findings (analysis_id);

-- ---------------------------------------------------------------- audit, preferences, deletion
create table if not exists voxa.audit_events (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references voxa.users(id) on delete set null,
  team_id        uuid references voxa.teams(id) on delete set null,
  action         text not null check (char_length(action) <= 64),
  target_type    text check (target_type is null or char_length(target_type) <= 32),
  target_id      text check (target_id is null or char_length(target_id) <= 80),
  outcome        text not null check (outcome in ('success', 'denied', 'failure')),
  severity       text not null default 'info' check (severity in ('info', 'low', 'medium', 'high')),
  classification text not null default 'event' check (classification in ('event', 'security_event', 'suspicious', 'alert')),
  correlation_id text,
  metadata_json  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists audit_events_created_idx on voxa.audit_events (created_at desc);
create index if not exists audit_events_team_idx    on voxa.audit_events (team_id, created_at desc);

create table if not exists voxa.user_preferences (
  user_id                     uuid primary key references voxa.users(id) on delete cascade,
  locale                      text,
  retention_opt_in            boolean not null default false,
  transcript_retention_opt_in boolean not null default false,
  updated_at                  timestamptz not null default now()
);

create table if not exists voxa.deletion_requests (
  id                uuid primary key default gen_random_uuid(),
  requester_user_id uuid references voxa.users(id) on delete set null,
  scope             text not null check (scope in ('analysis', 'all_my_data')),
  target_ref        text,
  status            text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  requested_at      timestamptz not null default now(),
  completed_at      timestamptz
);

-- Audit events cannot be edited (application-level append-only; deletes are reserved for retention purge).
create or replace function voxa.audit_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'voxa.audit_events is append-only';
end;
$$;
create or replace trigger audit_events_no_update
  before update on voxa.audit_events
  for each row execute function voxa.audit_events_append_only();

-- ---------------------------------------------------------------- lock down
alter table voxa.schema_migrations enable row level security;
alter table voxa.users             enable row level security;
alter table voxa.global_roles      enable row level security;
alter table voxa.teams             enable row level security;
alter table voxa.team_memberships  enable row level security;
alter table voxa.invitations       enable row level security;
alter table voxa.analyses          enable row level security;
alter table voxa.provider_runs     enable row level security;
alter table voxa.findings          enable row level security;
alter table voxa.audit_events      enable row level security;
alter table voxa.user_preferences  enable row level security;
alter table voxa.deletion_requests enable row level security;

-- Supabase client roles get nothing. (Guarded: plain PostgreSQL and the local test database have no such roles.)
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema voxa from %I', r);
      execute format('revoke all on all tables in schema voxa from %I', r);
      execute format('revoke all on all functions in schema voxa from %I', r);
      execute format('alter default privileges in schema voxa revoke all on tables from %I', r);
      execute format('alter default privileges in schema voxa revoke all on functions from %I', r);
    end if;
  end loop;
end;
$$;

insert into voxa.schema_migrations (version) values ('20261015120000_voxa_core') on conflict (version) do nothing;
