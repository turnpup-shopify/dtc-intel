-- Fill in the meta_page_ids that could be verified against the live Ad Library.
--
-- Run in the Supabase SQL Editor AFTER 0003_rework_categories.sql.
--
-- HOW THESE WERE OBTAINED, and why you should trust them: each id below came
-- back from a real Ad Library query, and was accepted only when the returned
-- `page_name` itself identified the brand. Nothing here is inferred from a
-- domain, guessed from a URL pattern, or recalled from memory.
--
-- Every id was then round-tripped: queried BACK through the Ad Library filtered
-- to that page_id alone — the same call the poll makes — confirming it returns
-- that brand's own ads. All 17 passed. That second pass is the one that matters,
-- because a keyword hit only proves the brand was mentioned; the page_id filter
-- proves the page is the advertiser.
--
-- Four ids are name variants rather than exact string matches. They are listed
-- with the page name actually returned so you can spot-check them:
--
--   AG1                 -> page "AG1 by Athletic Greens"
--   MaryRuth Organics   -> page "MaryRuth's"
--   Poo-Pourri          -> page "Pourri"        (the brand's current name)
--   Hims                -> page "hims"          (lowercase)
--
-- 21 brands are deliberately still null. Brand-name search hits ad CREATIVE
-- text, not page names, so common-word brands ("Ritual", "Purple", "Needed",
-- "Seed"-likes) and heavily-affiliated categories (hair loss, electrolytes,
-- mattresses) return thousands of unrelated advertisers with the real brand
-- nowhere in the results. Rather than guess, those are left for the manual
-- click-through on /companies — "Find it" opens the Ad Library pre-searched,
-- and you paste the advertiser's URL back into the field.
--
-- Safe to re-run. A brand that already has an id is never overwritten, and an
-- id already claimed by another row is skipped rather than tripping the unique
-- constraint on companies.meta_page_id.

update companies c
   set meta_page_id = v.page_id
  from (
    values
      ('AG1',               '183869772601'),
      ('Bombas',            '155577444523958'),
      ('Brooklinen',        '588785404473852'),
      ('Chomps',            '495075217208815'),
      ('Curology',          '246043868861319'),
      ('Cymbiotika',        '1506813839611097'),
      ('Graza',             '102637398978655'),
      ('HexClad',           '306050696452078'),
      ('Hims',              '355136938262536'),
      ('Jones Road Beauty', '107371600800343'),
      ('MaryRuth Organics', '582115538507595'),
      ('Oatly',             '179616462125382'),
      ('Perelel',           '113778497070610'),
      ('Poo-Pourri',        '185891658108917'),
      ('Quip',              '745582378817383'),
      ('Seed',              '178024832922517'),
      ('Tushy',             '780290155397706')
  ) as v(name, page_id)
 where c.name = v.name
   and c.meta_page_id is null
   and not exists (
     select 1 from companies other where other.meta_page_id = v.page_id
   );

-- Report what the poll will actually cover once this lands.
do $$
declare
  mapped int;
  total  int;
begin
  select count(*) filter (where meta_page_id is not null), count(*)
    into mapped, total
    from companies
   where active;
  raise notice '% of % active brands now have a meta_page_id; the rest need the manual lookup on /companies', mapped, total;
end $$;
