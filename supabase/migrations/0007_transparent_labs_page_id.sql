-- Transparent Labs: the page_id that keyword search could not confirm.
--
-- Run in the Supabase SQL Editor AFTER 0006_run_log.sql.
--
-- 0004 left this brand null on purpose. Searching "Transparent Labs" returned
-- 1,339 ads and not one of them was the brand — supplement keywords are dense
-- with affiliate and advertorial traffic, so the name matched everyone except
-- the company. This id came from the advertiser's own Ad Library URL instead,
-- which is the manual path /companies was built for.
--
-- BEFORE RUNNING: confirm the landing pages the test harvest pulled were on
-- transparentlabs.com. That is the real verification — ads pointing at the
-- brand's own domain prove the page belongs to the brand, more directly than a
-- page-name match would. If they pointed somewhere else, do not run this.
--
-- Safe to re-run, and it will not overwrite an id that is already set.

update companies c
   set meta_page_id = '916973588364925'
 where c.name = 'Transparent Labs'
   and c.meta_page_id is null
   and not exists (
     select 1 from companies other where other.meta_page_id = '916973588364925'
   );

do $$
declare
  v_id text;
begin
  select meta_page_id into v_id from companies where name = 'Transparent Labs';
  if v_id = '916973588364925' then
    raise notice 'Transparent Labs is mapped. 21 of 41 active brands now have a page_id.';
  elsif v_id is null then
    raise notice 'Transparent Labs is still unmapped — the id is already claimed by another row.';
  else
    raise notice 'Transparent Labs already had page_id %; left untouched.', v_id;
  end if;
end $$;
