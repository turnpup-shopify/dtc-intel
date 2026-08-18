-- Store a static of the ad creative alongside each hook.
--
-- Run in the Supabase SQL Editor AFTER 0008_remove_offcategory_brands.sql.
--
-- WHY THE BYTES AND NOT THE URL: Meta serves ad images from a CDN with a signed
-- token baked into every URL. The link works for minutes, not days, so storing
-- it would give you a table of thumbnails that all quietly turn into broken
-- images by tomorrow. We download the image while the token is still warm and
-- keep the file.
--
-- WHAT WE ARE NOT DOING: perceptual hashing. That is needed to tell whether two
-- creatives are the SAME image, which is hard precisely because the signed
-- tokens make identical creatives look distinct by URL. We never ask that
-- question — hooks are keyed on the headline — so the expensive half of
-- creative capture doesn't apply here.
--
-- KNOWN LIMITATION: the stored static is the creative as of first capture. If a
-- brand swaps the image while keeping the headline, the hook keeps the old
-- picture. Detecting that would need the image comparison we just skipped, and
-- the headline is the thing being ranked.

alter table ads      add column if not exists creative_url    text;
alter table ad_hooks add column if not exists creative_url    text;
alter table ad_hooks add column if not exists creative_path   text;
-- Which ad the stored picture actually came from. A hook is a group of ads, so
-- without this the image has no provenance — you can see the creative but not
-- which of the twelve ads behind the hook it belongs to, and can't open it in
-- the Ad Library. It also names the file, so two hooks that happen to share a
-- representative ad share one stored object instead of duplicating it.
alter table ad_hooks add column if not exists creative_ad_id  text;

-- Hooks still missing a downloaded static, newest first. The sync reads this.
create index if not exists ad_hooks_needs_creative_idx
  on ad_hooks (last_seen_at desc)
  where creative_path is null and creative_url is not null;

/**
 * Rollup, now carrying a representative creative URL.
 *
 * creative_path is deliberately absent from this function. The rollup runs on
 * every scan; the download runs once. Touching the path here would either wipe
 * a stored image or re-download it every single scan.
 */
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
      (array_agg(snapshot_url order by last_seen_at desc))[1]     as snapshot_url,
      -- Identical ORDER BY and FILTER on both aggregates, with ad_id as a
      -- tiebreaker, so the url and the id always describe the SAME ad. Without
      -- the tiebreaker two rows sharing a last_seen_at could order differently
      -- between the two calls and pair one ad's picture with another's id.
      (array_agg(creative_url order by last_seen_at desc, ad_id desc)
         filter (where creative_url is not null))[1]              as creative_url,
      (array_agg(ad_id order by last_seen_at desc, ad_id desc)
         filter (where creative_url is not null))[1]              as creative_ad_id
    from ads
    where company_id = p_company_id
      and link_title_norm is not null
      and link_title_norm <> ''
    group by company_id, link_title_norm
  )
  insert into ad_hooks as h (
    company_id, link_title_norm, display_title,
    variant_count, peak_variant_count, first_seen_at, last_seen_at,
    snapshot_url, creative_url, creative_ad_id
  )
  select
    company_id, link_title_norm, display_title,
    active_count, active_count, first_seen_at, last_seen_at,
    snapshot_url, creative_url, creative_ad_id
  from rollup
  on conflict (company_id, link_title_norm) do update
    set display_title      = excluded.display_title,
        variant_count      = excluded.variant_count,
        peak_variant_count = greatest(h.peak_variant_count, excluded.variant_count),
        first_seen_at      = least(h.first_seen_at, excluded.first_seen_at),
        last_seen_at       = greatest(h.last_seen_at, excluded.last_seen_at),
        snapshot_url       = coalesce(excluded.snapshot_url, h.snapshot_url),
        creative_url       = coalesce(excluded.creative_url, h.creative_url),
        creative_ad_id     = coalesce(excluded.creative_ad_id, h.creative_ad_id);

  get diagnostics v_touched = row_count;
  return v_touched;
end;
$$;
