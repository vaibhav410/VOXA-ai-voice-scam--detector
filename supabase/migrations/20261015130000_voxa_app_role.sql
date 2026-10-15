-- Least-privilege runtime role for the VOXA server (Backend, Database & Privacy PRD 13.2: "least-privilege DB guidance").
--
-- The server connects as voxa_app, not as postgres. voxa_app:
--   * can read/write VOXA's own tables in schema voxa, nothing else (no other schemas, no DDL, not a superuser);
--   * can only read schema_migrations (migrations are applied by the owner via `supabase db push`);
--   * cannot UPDATE audit_events (append-only; DELETE is kept for the retention purge);
--   * reaches rows through RLS policies scoped TO voxa_app only, so anon/authenticated stay locked out.
-- The role is created WITHOUT a password here. The password is set out-of-band and kept only in the server's
-- secret store / .env.local, never in git. Idempotent: safe to run more than once.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'voxa_app') then
    create role voxa_app nologin noinherit;
  end if;
end;
$$;

alter role voxa_app set statement_timeout = '15s';
alter role voxa_app set search_path = voxa;

grant usage on schema voxa to voxa_app;
grant select on voxa.schema_migrations to voxa_app;
grant select, insert, update, delete on voxa.users, voxa.teams, voxa.team_memberships, voxa.invitations, voxa.analyses,
  voxa.provider_runs, voxa.findings, voxa.user_preferences, voxa.deletion_requests to voxa_app;
grant select, insert, delete on voxa.global_roles, voxa.audit_events to voxa_app;

-- Row access for voxa_app only. Authorization (owner/team/role) is enforced by the server on every request.
do $$
declare t text;
begin
  foreach t in array array['schema_migrations', 'users', 'global_roles', 'teams', 'team_memberships', 'invitations', 'analyses',
                           'provider_runs', 'findings', 'audit_events', 'user_preferences', 'deletion_requests'] loop
    if not exists (select 1 from pg_policies where schemaname = 'voxa' and tablename = t and policyname = 'voxa_app_access') then
      execute format('create policy voxa_app_access on voxa.%I for all to voxa_app using (true) with check (true)', t);
    end if;
  end loop;
end;
$$;

insert into voxa.schema_migrations (version) values ('20261015130000_voxa_app_role') on conflict (version) do nothing;
