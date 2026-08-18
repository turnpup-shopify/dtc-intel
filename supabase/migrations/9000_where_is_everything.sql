-- WHERE IS EVERYTHING — a read-only snapshot. Changes nothing.
--
-- Paste the whole thing into the Supabase SQL Editor and run. It answers, in
-- order: did anything get captured, what status is it in, and if pages are
-- queued, which ones. Numbered 9000 so it sorts last; it is a tool, not a step.

-- 1. Pipeline totals. If `pages` is 0, nothing was ever captured and the
--    problem is upstream of the queue.
select 'companies'      as table_name, count(*) as rows from companies
union all select 'landing_pages',  count(*) from landing_pages
union all select 'pages',          count(*) from pages
union all select 'page_versions',  count(*) from page_versions
union all select 'copy_blocks',    count(*) from copy_blocks
order by table_name;

-- 2. Every page by status, with what a human has and hasn't touched.
--    'queued' is what the Review tab reads. Nothing else appears there.
select
  status,
  count(*)                                   as pages,
  count(*) filter (where reviewed_at is null) as never_reviewed,
  round(min(pv.composite_score), 2)          as lowest_score,
  round(max(pv.composite_score), 2)          as highest_score
from pages p
left join page_versions pv on pv.page_id = p.id and pv.is_current
group by status
order by status;

-- 3. The queued pages themselves. If this returns rows and Review looks empty,
--    the data is fine and the problem is in the app or a stale browser tab.
select p.url, round(pv.composite_score, 2) as score, p.discovered_at
from pages p
left join page_versions pv on pv.page_id = p.id and pv.is_current
where p.status = 'queued'
order by p.discovered_at
limit 50;

-- 4. What 0012 would still move, if anything. Zero rows here plus zero queued
--    above means every captured page scored under 2.5.
select count(*) as would_requeue_at_2_5
from pages p
join page_versions pv on pv.page_id = p.id and pv.is_current
where p.status = 'discarded'
  and p.reviewed_at is null
  and pv.composite_score >= 2.5;
