-- Landing Page Copy Swipe File — initial schema.
-- Run with: supabase db push   (or paste into the Supabase SQL editor)

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create table if not exists companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  domain        text unique,
  meta_page_id  text unique,
  tier          text check (tier in ('direct','adjacent','copycraft','advertorial')),
  category      text,
  active        boolean default true,
  added_at      timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- ads — raw daily observations from the Ad Library poll. One row per Meta ad id.
-- ---------------------------------------------------------------------------
create table if not exists ads (
  ad_id             text primary key,
  company_id        uuid references companies(id) on delete cascade,
  link_title        text,
  link_title_norm   text,
  ad_creation_time  timestamptz,
  delivery_start    timestamptz,
  snapshot_url      text,
  first_seen_at     timestamptz default now(),
  last_seen_at      timestamptz default now(),
  still_active      boolean default true
);
create index if not exists ads_company_norm_idx on ads (company_id, link_title_norm);
create index if not exists ads_last_seen_idx on ads (last_seen_at);

-- ---------------------------------------------------------------------------
-- ad_hooks — rollup of ads by normalized headline. This is what gets ranked.
--
-- NOTE (deviation from spec): the spec writes days_running as
--   (last_seen_at::date - first_seen_at::date)
-- but casting timestamptz -> date is STABLE, not IMMUTABLE, so Postgres rejects
-- it in a generated column. The epoch form below is immutable and equivalent.
-- ---------------------------------------------------------------------------
create table if not exists ad_hooks (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid references companies(id) on delete cascade,
  link_title_norm    text not null,
  display_title      text not null,
  variant_count      int default 1,
  peak_variant_count int default 1,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz,
  days_running       int generated always as
                       (greatest(0, floor(extract(epoch from (last_seen_at - first_seen_at)) / 86400)::int)) stored,
  snapshot_url       text,
  status             text default 'new'
                       check (status in ('new','clicked','dismissed','converted')),
  resulting_page_id  uuid,
  unique (company_id, link_title_norm)
);
create index if not exists ad_hooks_rank_idx on ad_hooks (status, variant_count desc, days_running desc);

-- ---------------------------------------------------------------------------
-- pages — a landing page, identified by normalized URL. Stable across recaptures.
-- ---------------------------------------------------------------------------
create table if not exists pages (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references companies(id) on delete set null,
  url            text not null,
  url_normalized text not null unique,
  title          text,
  source         text check (source in ('ad_hook','sitemap','manual')),
  source_ref     text,
  discovered_at  timestamptz default now(),
  status         text default 'queued'
                   check (status in ('queued','saved','discarded')),
  stars          smallint default 0 check (stars between 0 and 3),
  reviewed_at    timestamptz,
  notes          text
);
create index if not exists pages_status_stars_idx on pages (status, stars desc);
create index if not exists pages_company_idx on pages (company_id);

-- ---------------------------------------------------------------------------
-- page_versions — immutable capture. Recapture with changed content = new row.
-- ---------------------------------------------------------------------------
create table if not exists page_versions (
  id              uuid primary key default gen_random_uuid(),
  page_id         uuid references pages(id) on delete cascade,
  captured_at     timestamptz default now(),
  content_hash    text not null,
  screenshot_path text,
  raw_text        text,
  scores          jsonb,
  composite_score numeric(3,2),
  why_good        text,
  is_current      boolean default true,
  unique (page_id, content_hash)
);
create index if not exists page_versions_page_captured_idx on page_versions (page_id, captured_at desc);
-- Enforce the "exactly one current version per page" invariant.
create unique index if not exists page_versions_one_current_idx
  on page_versions (page_id) where is_current;

-- ---------------------------------------------------------------------------
-- copy_blocks — the retrieval unit.
-- ---------------------------------------------------------------------------
create table if not exists copy_blocks (
  id              uuid primary key default gen_random_uuid(),
  page_version_id uuid references page_versions(id) on delete cascade,
  page_id         uuid references pages(id) on delete cascade,
  block_type      text check (block_type in
                    ('hero','subhead','benefit','proof','objection',
                     'cta','guarantee','offer','faq','other')),
  content         text not null,
  position        int,
  embedding       vector(1536),
  search_tsv      tsvector generated always as
                    (to_tsvector('english', content)) stored
);
create index if not exists copy_blocks_tsv_idx on copy_blocks using gin (search_tsv);
create index if not exists copy_blocks_type_idx on copy_blocks (block_type);
create index if not exists copy_blocks_page_idx on copy_blocks (page_id);

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------
create table if not exists tags (
  id    uuid primary key default gen_random_uuid(),
  label text not null unique,
  kind  text check (kind in ('system','user')) default 'user'
);

create table if not exists page_tags (
  page_id uuid references pages(id) on delete cascade,
  tag_id  uuid references tags(id) on delete cascade,
  primary key (page_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- Private screenshot bucket. Read via signed URLs only.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- ingest_page_version — page -> version -> blocks -> tags, in one transaction.
--
-- Returns { page_id, version_id, unchanged }. `unchanged = true` means the
-- cleaned text hashed identically to the current version; nothing was written.
-- Review state (status/stars/tags) on an existing page is never clobbered.
-- ---------------------------------------------------------------------------
create or replace function ingest_page_version(
  p_url             text,
  p_url_normalized  text,
  p_title           text,
  p_source          text,
  p_source_ref      text,
  p_company_id      uuid,
  p_content_hash    text,
  p_raw_text        text,
  p_screenshot_path text,
  p_scores          jsonb,
  p_composite       numeric,
  p_why_good        text,
  p_status          text,
  p_blocks          jsonb,
  p_tags            text[]
) returns jsonb
language plpgsql
as $$
declare
  v_page_id    uuid;
  v_is_new     boolean := false;
  v_version_id uuid;
  v_current    record;
  v_block      jsonb;
  v_label      text;
  v_tag_id     uuid;
begin
  select id into v_page_id from pages where url_normalized = p_url_normalized;

  if v_page_id is null then
    insert into pages (company_id, url, url_normalized, title, source, source_ref, status)
    values (p_company_id, p_url, p_url_normalized, p_title, p_source, p_source_ref, p_status)
    returning id into v_page_id;
    v_is_new := true;
  else
    -- Recapture: refresh descriptive fields, preserve review state.
    update pages
       set title      = coalesce(p_title, title),
           company_id = coalesce(company_id, p_company_id),
           url        = p_url
     where id = v_page_id;
  end if;

  select * into v_current
    from page_versions
   where page_id = v_page_id and is_current
   limit 1;

  if v_current.id is not null and v_current.content_hash = p_content_hash then
    return jsonb_build_object(
      'page_id',   v_page_id,
      'version_id', v_current.id,
      'unchanged', true,
      'is_new_page', v_is_new
    );
  end if;

  update page_versions set is_current = false where page_id = v_page_id and is_current;

  insert into page_versions (
    page_id, content_hash, screenshot_path, raw_text,
    scores, composite_score, why_good, is_current
  ) values (
    v_page_id, p_content_hash, p_screenshot_path, p_raw_text,
    p_scores, p_composite, p_why_good, true
  )
  on conflict (page_id, content_hash) do update
    set is_current      = true,
        screenshot_path = excluded.screenshot_path,
        scores          = excluded.scores,
        composite_score = excluded.composite_score,
        why_good        = excluded.why_good
  returning id into v_version_id;

  -- Blocks belong to the version; older versions keep their own blocks intact.
  delete from copy_blocks where page_version_id = v_version_id;

  for v_block in select * from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb))
  loop
    insert into copy_blocks (page_version_id, page_id, block_type, content, position)
    values (
      v_version_id,
      v_page_id,
      coalesce(v_block->>'block_type', 'other'),
      v_block->>'content',
      coalesce((v_block->>'position')::int, 0)
    );
  end loop;

  foreach v_label in array coalesce(p_tags, '{}'::text[])
  loop
    insert into tags (label, kind) values (v_label, 'system')
      on conflict (label) do nothing;
    select id into v_tag_id from tags where label = v_label;
    insert into page_tags (page_id, tag_id) values (v_page_id, v_tag_id)
      on conflict do nothing;
  end loop;

  return jsonb_build_object(
    'page_id',    v_page_id,
    'version_id', v_version_id,
    'unchanged',  false,
    'is_new_page', v_is_new
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- rebuild_ad_hooks — roll `ads` up into `ad_hooks` for one company.
-- variant_count counts currently-active ads sharing the normalized headline;
-- peak_variant_count is a running max; first/last seen are min/max across members.
-- ---------------------------------------------------------------------------
create or replace function rebuild_ad_hooks(p_company_id uuid)
returns int
language plpgsql
as $$
declare
  v_touched int;
begin
  with rollup as (
    select
      company_id,
      link_title_norm,
      (array_agg(link_title order by length(link_title) desc))[1] as display_title,
      count(*) filter (where still_active)                        as active_count,
      min(first_seen_at)                                          as first_seen_at,
      max(last_seen_at)                                           as last_seen_at,
      (array_agg(snapshot_url order by last_seen_at desc))[1]     as snapshot_url
    from ads
    where company_id = p_company_id
      and link_title_norm is not null
      and link_title_norm <> ''
    group by company_id, link_title_norm
  )
  insert into ad_hooks as h (
    company_id, link_title_norm, display_title,
    variant_count, peak_variant_count, first_seen_at, last_seen_at, snapshot_url
  )
  select
    company_id, link_title_norm, display_title,
    active_count, active_count, first_seen_at, last_seen_at, snapshot_url
  from rollup
  on conflict (company_id, link_title_norm) do update
    set display_title      = excluded.display_title,
        variant_count      = excluded.variant_count,
        peak_variant_count = greatest(h.peak_variant_count, excluded.variant_count),
        first_seen_at      = least(h.first_seen_at, excluded.first_seen_at),
        last_seen_at       = greatest(h.last_seen_at, excluded.last_seen_at),
        snapshot_url       = coalesce(excluded.snapshot_url, h.snapshot_url);

  get diagnostics v_touched = row_count;
  return v_touched;
end;
$$;

-- ---------------------------------------------------------------------------
-- search_copy_blocks — full-text over copy_blocks, filterable.
-- Results are BLOCKS, not pages. Empty query = browse mode.
-- ---------------------------------------------------------------------------
create or replace function search_copy_blocks(
  p_query      text default null,
  p_block_type text default null,
  p_company_id uuid default null,
  p_min_stars  int  default 0,
  p_limit      int  default 50
) returns table (
  block_id     uuid,
  page_id      uuid,
  block_type   text,
  content      text,
  -- `position` is reserved in a RETURNS TABLE clause; the column on
  -- copy_blocks keeps its spec name, only the projection is renamed.
  block_position int,
  company_name text,
  page_url     text,
  page_title   text,
  stars        smallint,
  why_good     text,
  composite_score numeric,
  rank         real
)
language sql
stable
as $$
  select
    cb.id,
    p.id,
    cb.block_type,
    cb.content,
    cb.position,
    c.name,
    p.url,
    p.title,
    p.stars,
    pv.why_good,
    pv.composite_score,
    case
      when p_query is null or btrim(p_query) = '' then 0::real
      else ts_rank(cb.search_tsv, websearch_to_tsquery('english', p_query))
    end as rank
  from copy_blocks cb
  join page_versions pv on pv.id = cb.page_version_id and pv.is_current
  join pages p          on p.id = cb.page_id
  left join companies c on c.id = p.company_id
  where p.status = 'saved'
    and p.stars >= coalesce(p_min_stars, 0)
    and (p_block_type is null or cb.block_type = p_block_type)
    and (p_company_id is null or p.company_id = p_company_id)
    and (
      p_query is null or btrim(p_query) = ''
      or cb.search_tsv @@ websearch_to_tsquery('english', p_query)
    )
  order by rank desc, p.stars desc, pv.composite_score desc nulls last
  limit least(coalesce(p_limit, 50), 200);
$$;
