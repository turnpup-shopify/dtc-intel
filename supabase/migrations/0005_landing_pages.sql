-- Landing page registry: unique destinations harvested from the Ad Library.
--
-- Run in the Supabase SQL Editor AFTER 0004_verified_page_ids.sql.
--
-- One row per (brand, landing page). The identity is `dedupe_key` — hostname
-- plus pathname, lowercased, no query string. Meta stamps a unique `fbclid` on
-- every outbound link, so keeping the query string in the key would file every
-- single ad as its own "landing page". The interesting params survive in
-- `params`, just never in the key.
--
-- Two columns from the original design are deliberately absent: creatives_latest
-- and themes. Both describe ad creative, which this pipeline does not extract —
-- capturing images needs perceptual hashing to see through Meta's per-request
-- signed CDN URLs. Adding the columns without filling them would just be a
-- standing invitation to read zeros as facts.

create table if not exists landing_pages (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  dedupe_key         text not null,
  url                text not null,
  page_type          text not null default 'other',
  first_seen         timestamptz not null default now(),
  last_seen          timestamptz not null default now(),
  runs_seen          int not null default 1,
  -- Ads pointing here in the MOST RECENT harvest of this brand.
  ad_records_latest  int not null default 0,
  -- Cumulative across every harvest. Only ever grows.
  ad_records_total   int not null default 0,
  example_ad_url     text,
  params             jsonb not null default '{}'::jsonb,
  notes              text,
  unique (company_id, dedupe_key)
);

create index if not exists landing_pages_company_idx on landing_pages (company_id);
create index if not exists landing_pages_last_seen_idx on landing_pages (last_seen desc);
create index if not exists landing_pages_type_idx on landing_pages (page_type);

alter table landing_pages enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on landing_pages to service_role;
  end if;
end $$;

/**
 * STAGE TWO of the merge. The caller has already collapsed duplicates within
 * the run, so every row here is one distinct landing page and runs_seen can be
 * incremented exactly once per row.
 *
 * Rows are never deleted. A page vanishing from the current harvest means the
 * brand stopped running ads to it, which is signal worth keeping — so instead
 * of removing it we zero its ad_records_latest and leave last_seen where it
 * was. That way "how many ads point here right now" and "when did we last see
 * this" stay two separate, honest questions.
 */
create or replace function merge_landing_pages(
  p_company_id uuid,
  p_rows jsonb
) returns table (inserted int, updated int, retired int)
language plpgsql
as $$
declare
  v_keys text[];
  v_inserted int := 0;
  v_updated  int := 0;
  v_retired  int := 0;
begin
  select coalesce(array_agg(r->>'key'), '{}')
    into v_keys
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;

  -- Anything this brand had before that is not in this run is no longer live.
  update landing_pages
     set ad_records_latest = 0
   where company_id = p_company_id
     and not (dedupe_key = any (v_keys))
     and ad_records_latest <> 0;
  get diagnostics v_retired = row_count;

  with incoming as (
    select
      r->>'key'                            as dedupe_key,
      r->>'url'                            as url,
      coalesce(r->>'pageType', 'other')    as page_type,
      coalesce((r->>'adCount')::int, 0)    as ad_count,
      r->>'exampleAdUrl'                   as example_ad_url,
      coalesce(r->'params', '{}'::jsonb)   as params
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  ),
  merged as (
    insert into landing_pages (
      company_id, dedupe_key, url, page_type,
      ad_records_latest, ad_records_total, example_ad_url, params
    )
    select
      p_company_id, i.dedupe_key, i.url, i.page_type,
      i.ad_count, i.ad_count, i.example_ad_url, i.params
    from incoming i
    on conflict (company_id, dedupe_key) do update
      set last_seen         = now(),
          runs_seen         = landing_pages.runs_seen + 1,
          ad_records_latest = excluded.ad_records_latest,
          ad_records_total  = landing_pages.ad_records_total + excluded.ad_records_latest,
          page_type         = excluded.page_type,
          -- Keep the first example we ever stored; it is a stable permalink.
          example_ad_url    = coalesce(landing_pages.example_ad_url, excluded.example_ad_url),
          params            = landing_pages.params || excluded.params
    returning (xmax = 0) as was_insert
  )
  select
    count(*) filter (where was_insert),
    count(*) filter (where not was_insert)
  into v_inserted, v_updated
  from merged;

  return query select v_inserted, v_updated, v_retired;
end $$;
