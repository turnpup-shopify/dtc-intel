-- Re-open the pages the old 3.4 gate rejected. Ready to run as-is.
--
-- Run in the Supabase SQL Editor. No scraping, no model calls — these pages
-- were already fetched, scored and stored; only their status changes.
--
-- Matches the new SCORE_THRESHOLD default of 2.5. If you set a different value
-- in Vercel, change the number below to match, or the queue and the gate will
-- disagree about what counts as junk.
--
-- SAFE ON YOUR OWN DECISIONS: only pages with reviewed_at IS NULL are touched.
-- That means the machine rejected them and no human ever looked. Anything you
-- personally discarded in Review stays discarded.
--
-- Safe to re-run: a second pass finds nothing left to move.

do $$
declare
  v_threshold numeric := 2.5;   -- keep in step with SCORE_THRESHOLD
  v_moved int;
  v_still int;
  v_queued int;
begin
  update pages p
     set status = 'queued'
    from page_versions pv
   where pv.page_id = p.id
     and pv.is_current
     and p.status = 'discarded'
     and p.reviewed_at is null
     and pv.composite_score >= v_threshold;
  get diagnostics v_moved = row_count;

  select count(*) into v_still
    from pages p
    join page_versions pv on pv.page_id = p.id and pv.is_current
   where p.status = 'discarded' and p.reviewed_at is null
     and pv.composite_score < v_threshold;

  select count(*) into v_queued from pages where status = 'queued';

  raise notice 'Re-opened % page(s) scoring >= %.', v_moved, v_threshold;
  raise notice '% still below the gate. % now waiting in Review.', v_still, v_queued;
end $$;
