-- Look at the score distribution, then re-open pages the gate rejected.
--
-- Run in the Supabase SQL Editor. Read part 1 before running part 2.
--
-- WHY THIS EXISTS: the composite is a weighted mean on a 1-5 scale, and
-- voice_distinctiveness carries DOUBLE weight while being the dimension most
-- real pages fail — it scores 1 when the copy would still work under a
-- competitor's logo. A solid but unremarkable page therefore lands near 2.75,
-- and a 3.4 gate rejects almost everything.
--
-- That is a calibration problem, not a page-quality problem. The gate should
-- keep junk out; the stars in Review are what separate good from great. If the
-- gate is doing the curating, you never see anything to curate.
--
-- NOTHING WAS LOST. Rejected pages were fully captured, scored and stored —
-- they are just marked discarded. Part 2 re-opens them without spending another
-- scrape or another model call.

-- ── PART 1: what does the gate actually see? ─────────────────────────────────
-- Run this alone first. Pick a threshold from the numbers, not from a guess.
select
  width_bucket(pv.composite_score, 1, 5, 8) as bucket,
  round(min(pv.composite_score), 2)         as low,
  round(max(pv.composite_score), 2)         as high,
  count(*)                                  as pages,
  count(*) filter (where p.status = 'discarded' and p.reviewed_at is null) as auto_rejected
from page_versions pv
join pages p on p.id = pv.page_id
where pv.is_current
group by bucket
order by bucket;

-- How many pages a given threshold would admit, for a few candidates.
select
  t.threshold,
  count(*) filter (where pv.composite_score >= t.threshold) as would_pass,
  count(*)                                                  as of_total
from page_versions pv
cross join (values (2.4), (2.6), (2.8), (3.0), (3.2), (3.4)) as t(threshold)
where pv.is_current
group by t.threshold
order by t.threshold;

-- ── PART 2: re-open what the old gate rejected ───────────────────────────────
-- EDIT THE THRESHOLD, then run. Only touches pages the machine rejected on its
-- own: `reviewed_at is null` means no human ever looked, so a page you
-- personally discarded stays discarded.

-- update pages p
--    set status = 'queued'
--   from page_versions pv
--  where pv.page_id = p.id
--    and pv.is_current
--    and p.status = 'discarded'
--    and p.reviewed_at is null
--    and pv.composite_score >= 2.8;   -- <- your number from part 1
