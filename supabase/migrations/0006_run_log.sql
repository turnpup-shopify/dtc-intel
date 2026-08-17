-- Run log: what this app did, when, and whether it worked.
--
-- Run in the Supabase SQL Editor AFTER 0005_landing_pages.sql.
--
-- Every background job and every user-triggered capture writes one row here.
-- The point is to make the app's failure modes VISIBLE, because almost none of
-- them announce themselves: a poll returns zero ads and looks like a quiet
-- week, a harvest stalls halfway and looks finished, a scrape hits a bot wall
-- and looks like a page with no copy on it.
--
-- Note the four statuses, and specifically that 'warning' is not 'error'. A run
-- that completed but produced suspect numbers is the dangerous case — it is the
-- one you would otherwise trust.
--
--   running  — started, no result yet. Left behind by a function that timed out.
--   ok       — completed, numbers trustworthy.
--   warning  — completed, but something about the result is not trustworthy.
--   error    — did not complete.

create table if not exists run_log (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('ad_poll','lp_harvest','sitemap_diff','page_capture')),
  company_id   uuid references companies(id) on delete set null,
  -- What set it off, so a failing cron is distinguishable from a failing click.
  trigger      text not null default 'manual' check (trigger in ('manual','cron')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  duration_ms  int,
  status       text not null default 'running' check (status in ('running','ok','warning','error')),
  -- Per-kind counters: ads seen, pages harvested, urls captured, and so on.
  summary      jsonb not null default '{}'::jsonb,
  -- Completed, but do not trust the numbers. Reason goes here.
  warning      text,
  error        text,
  -- Free-text label for the thing acted on: a URL, a brand, a hook id.
  subject      text
);

create index if not exists run_log_started_idx on run_log (started_at desc);
create index if not exists run_log_kind_idx on run_log (kind, started_at desc);
create index if not exists run_log_status_idx on run_log (status) where status <> 'ok';

alter table run_log enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on run_log to service_role;
  end if;
end $$;

/**
 * Keep the log from growing without bound. Called opportunistically when a run
 * finishes, so there is nothing extra to schedule.
 */
create or replace function prune_run_log(p_days int default 90)
returns int
language plpgsql
as $$
declare
  v_deleted int;
begin
  delete from run_log where started_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
