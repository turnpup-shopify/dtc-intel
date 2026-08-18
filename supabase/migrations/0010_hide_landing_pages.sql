-- Let a landing page be removed from view without fighting the next scan.
--
-- Run in the Supabase SQL Editor AFTER 0009_ad_creatives.sql.
--
-- landing_pages is DERIVED data: every row is rebuilt from the brand's live ads
-- on each scan. A hard delete would therefore last until the next scan and then
-- silently undo itself — the row reappears, and the person who removed it has
-- no way to tell whether they misclicked or the app ignored them.
--
-- So removal is a flag the merge does not touch. Hidden rows keep merging in the
-- background, which means their counts stay correct and un-hiding shows current
-- data rather than a stale snapshot from whenever you hid it.
--
-- This is mostly for the pages that are technically real but never worth
-- reading: checkout confirmations, social profiles, an affiliate's own domain.

alter table landing_pages add column if not exists hidden boolean not null default false;

-- The common read is "everything not hidden, busiest first".
create index if not exists landing_pages_visible_idx
  on landing_pages (company_id, ad_records_latest desc)
  where not hidden;
