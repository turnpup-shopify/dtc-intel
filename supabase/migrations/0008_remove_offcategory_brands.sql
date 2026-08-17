-- Remove 24 brands, narrowing the tracked set to supplements and health.
--
-- Run in the Supabase SQL Editor AFTER 0007_transparent_labs_page_id.sql.
--
-- TWO NAMES WERE INTERPRETED. Check these before running:
--   "fraza"             -> Graza
--   "quipqarby parker"  -> TWO brands, Quip and Warby Parker
-- Nothing else was guessed at. Any name below that matches no row is reported
-- by the summary at the end rather than silently doing nothing, so a typo
-- surfaces instead of leaving a brand you meant to remove still in the table.
--
-- WHAT THIS DESTROYS, via cascade:
--   ads            - every stored ad for these brands
--   ad_hooks       - their hooks queue, including any pasted-back progress
--   landing_pages  - their harvested landing page registry
-- All three are regenerable: re-seed the brand and re-run a poll or a scan.
--
-- WHAT SURVIVES:
--   pages / copy_blocks - the archive itself. company_id is set to null rather
--   than cascading, so saved copy is NOT deleted. It does permanently lose its
--   brand attribution though, and that part cannot be undone by re-seeding —
--   an orphaned page can only be traced back by its domain.
--
-- IF YOU ONLY WANT TO STOP TRACKING THEM, don't run this. Every job filters on
-- active = true, so a single update stops all polling, harvesting and sitemap
-- work while keeping brand labels intact and staying reversible:
--
--   update companies set active = false where name in ( ...same list... );
--
-- Safe to re-run: a second pass matches nothing and reports as much.

do $$
declare
  v_names text[] := array[
    'Allbirds', 'Bombas', 'Brooklinen', 'Care/of', 'Chomps', 'Death Wish Coffee',
    'Dr. Squatch', 'Eight Sleep', 'Fly By Jing', 'Graza', 'Harry''s', 'HexClad',
    'Jones Road Beauty', 'Legion Athletics', 'Momentous', 'Needed', 'Oatly',
    'Oura', 'Poo-Pourri', 'Purple', 'Quip', 'Tushy', 'Warby Parker',
    'Who Gives A Crap'
  ];
  v_missing text[];
  v_found int;
  v_orphaned int;
  v_deleted int;
  v_left int;
begin
  -- Which requested names are not actually in the table?
  select coalesce(array_agg(n), '{}')
    into v_missing
    from unnest(v_names) as n
   where not exists (select 1 from companies c where c.name = n);

  select count(*) into v_found from companies where name = any (v_names);

  -- Archived pages that are about to lose their brand label.
  select count(*) into v_orphaned
    from pages p
    join companies c on c.id = p.company_id
   where c.name = any (v_names);

  delete from companies where name = any (v_names);
  get diagnostics v_deleted = row_count;

  select count(*) into v_left from companies;

  raise notice 'Requested % names, matched %, deleted %.',
    array_length(v_names, 1), v_found, v_deleted;
  raise notice '% archived page(s) kept but detached from their brand.', v_orphaned;
  raise notice '% brands remain.', v_left;

  if array_length(v_missing, 1) > 0 then
    raise notice 'NO MATCH for: %  <- still present or spelled differently',
      array_to_string(v_missing, ', ');
  end if;
end $$;
