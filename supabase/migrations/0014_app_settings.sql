-- Settings you can change without a redeploy.
--
-- Run in the Supabase SQL Editor. Optional: until it exists the app falls back
-- to the SCORE_THRESHOLD environment variable, then to its built-in default, so
-- nothing breaks by not running this.
--
-- WHY A TABLE: the score gate is the one number you tune by looking at results,
-- and an env var means a Vercel edit plus a redeploy per adjustment. Worse, an
-- env var set once silently outranks any later change to the code default —
-- which is exactly how a 3.4 stayed in force after the default moved to 2.5.

create table if not exists app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on app_settings to service_role;
  end if;
end $$;

-- No seed row. An absent key means "no override", which keeps the precedence
-- honest: database value, then env var, then code default. Seeding a value here
-- would make the table win before anyone had chosen anything.
