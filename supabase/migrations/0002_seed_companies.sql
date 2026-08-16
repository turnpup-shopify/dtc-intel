-- Seed the brand list — 41 companies, 3 with a verified meta_page_id.
--
-- Run in the Supabase SQL Editor AFTER 0001_init.sql. Safe to re-run: a brand
-- already present by name, domain, or page_id is skipped, never duplicated.
--
-- Rows without a meta_page_id are inert until you paste one in on /companies.
-- Use the "search Ad Library" link on that screen, open the advertiser, then
-- paste that page's URL back into the field.

insert into companies (name, domain, tier, category, meta_page_id)
select s.name, s.domain, s.tier, s.category, s.meta_page_id
from (
  values
    ('UpWellness', 'upwellness.com', 'direct', 'supplements', '101942308432014'),
    ('Ritual', 'ritual.com', 'direct', 'supplements', null),
    ('AG1', 'drinkag1.com', 'direct', 'supplements', null),
    ('Seed', 'seed.com', 'direct', 'supplements', null),
    ('Care/of', 'takecareof.com', 'direct', 'supplements', null),
    ('Momentous', 'livemomentous.com', 'direct', 'supplements', null),
    ('Thorne', 'thorne.com', 'direct', 'supplements', null),
    ('Legion Athletics', 'legionathletics.com', 'direct', 'supplements', null),
    ('Transparent Labs', 'transparentlabs.com', 'direct', 'supplements', null),
    ('LMNT', 'drinklmnt.com', 'direct', 'supplements', null),
    ('Cymbiotika', 'cymbiotika.com', 'direct', 'supplements', null),
    ('MaryRuth Organics', 'maryruthorganics.com', 'direct', 'supplements', null),
    ('Needed', 'thisisneeded.com', 'direct', 'supplements', null),
    ('Perelel', 'perelelhealth.com', 'direct', 'supplements', null),
    ('Nutrafol', 'nutrafol.com', 'direct', 'supplements', null),
    ('Oura', 'ouraring.com', 'adjacent', 'health care', null),
    ('Eight Sleep', 'eightsleep.com', 'adjacent', 'health care', null),
    ('Function Health', 'functionhealth.com', 'adjacent', 'health care', null),
    ('Curology', 'curology.com', 'adjacent', 'personal care', null),
    ('Hims', 'hims.com', 'adjacent', 'health care', null),
    ('Dr. Squatch', 'drsquatch.com', 'adjacent', 'personal care', '118075261668462'),
    ('Liquid Death', 'liquiddeath.com', 'adjacent', 'food/bev', null),
    ('Magic Spoon', 'magicspoon.com', 'adjacent', 'food/bev', null),
    ('Chomps', 'chomps.com', 'adjacent', 'food/bev', null),
    ('Graza', 'graza.co', 'adjacent', 'food/bev', null),
    ('Fly By Jing', 'flybyjing.com', 'adjacent', 'food/bev', null),
    ('Brooklinen', 'brooklinen.com', 'adjacent', 'home', null),
    ('Quip', 'getquip.com', 'adjacent', 'personal care', null),
    ('Warby Parker', 'warbyparker.com', 'adjacent', 'fashion', null),
    ('Allbirds', 'allbirds.com', 'adjacent', 'fashion', null),
    ('Oatly', 'oatly.com', 'copycraft', 'food/bev', null),
    ('Who Gives A Crap', 'whogivesacrap.org', 'copycraft', 'home', null),
    ('Bombas', 'bombas.com', 'copycraft', 'fashion', null),
    ('Tushy', 'hellotushy.com', 'copycraft', 'home', null),
    ('Poo-Pourri', 'poopourri.com', 'copycraft', 'home', null),
    ('Death Wish Coffee', 'deathwishcoffee.com', 'copycraft', 'food/bev', null),
    ('Purple', 'purple.com', 'copycraft', 'home', null),
    ('Jones Road Beauty', 'jonesroadbeauty.com', 'copycraft', 'personal care', null),
    ('HexClad', 'hexclad.com', 'copycraft', 'home', null),
    ('Harry''s', 'harrys.com', 'copycraft', 'personal care', null),
    ('Magic Mind', 'magicmind.com', 'adjacent', 'supplements', '104654481112161')
) as s(name, domain, tier, category, meta_page_id)
where not exists (
  select 1 from companies c
   where c.name = s.name
      or (s.domain is not null and c.domain = s.domain)
      or (s.meta_page_id is not null and c.meta_page_id = s.meta_page_id)
);

-- Backfill a page_id onto a brand added before its id was known.
update companies c
   set meta_page_id = s.meta_page_id
  from (
  values
    ('UpWellness', 'upwellness.com', 'direct', 'supplements', '101942308432014'),
    ('Ritual', 'ritual.com', 'direct', 'supplements', null),
    ('AG1', 'drinkag1.com', 'direct', 'supplements', null),
    ('Seed', 'seed.com', 'direct', 'supplements', null),
    ('Care/of', 'takecareof.com', 'direct', 'supplements', null),
    ('Momentous', 'livemomentous.com', 'direct', 'supplements', null),
    ('Thorne', 'thorne.com', 'direct', 'supplements', null),
    ('Legion Athletics', 'legionathletics.com', 'direct', 'supplements', null),
    ('Transparent Labs', 'transparentlabs.com', 'direct', 'supplements', null),
    ('LMNT', 'drinklmnt.com', 'direct', 'supplements', null),
    ('Cymbiotika', 'cymbiotika.com', 'direct', 'supplements', null),
    ('MaryRuth Organics', 'maryruthorganics.com', 'direct', 'supplements', null),
    ('Needed', 'thisisneeded.com', 'direct', 'supplements', null),
    ('Perelel', 'perelelhealth.com', 'direct', 'supplements', null),
    ('Nutrafol', 'nutrafol.com', 'direct', 'supplements', null),
    ('Oura', 'ouraring.com', 'adjacent', 'health care', null),
    ('Eight Sleep', 'eightsleep.com', 'adjacent', 'health care', null),
    ('Function Health', 'functionhealth.com', 'adjacent', 'health care', null),
    ('Curology', 'curology.com', 'adjacent', 'personal care', null),
    ('Hims', 'hims.com', 'adjacent', 'health care', null),
    ('Dr. Squatch', 'drsquatch.com', 'adjacent', 'personal care', '118075261668462'),
    ('Liquid Death', 'liquiddeath.com', 'adjacent', 'food/bev', null),
    ('Magic Spoon', 'magicspoon.com', 'adjacent', 'food/bev', null),
    ('Chomps', 'chomps.com', 'adjacent', 'food/bev', null),
    ('Graza', 'graza.co', 'adjacent', 'food/bev', null),
    ('Fly By Jing', 'flybyjing.com', 'adjacent', 'food/bev', null),
    ('Brooklinen', 'brooklinen.com', 'adjacent', 'home', null),
    ('Quip', 'getquip.com', 'adjacent', 'personal care', null),
    ('Warby Parker', 'warbyparker.com', 'adjacent', 'fashion', null),
    ('Allbirds', 'allbirds.com', 'adjacent', 'fashion', null),
    ('Oatly', 'oatly.com', 'copycraft', 'food/bev', null),
    ('Who Gives A Crap', 'whogivesacrap.org', 'copycraft', 'home', null),
    ('Bombas', 'bombas.com', 'copycraft', 'fashion', null),
    ('Tushy', 'hellotushy.com', 'copycraft', 'home', null),
    ('Poo-Pourri', 'poopourri.com', 'copycraft', 'home', null),
    ('Death Wish Coffee', 'deathwishcoffee.com', 'copycraft', 'food/bev', null),
    ('Purple', 'purple.com', 'copycraft', 'home', null),
    ('Jones Road Beauty', 'jonesroadbeauty.com', 'copycraft', 'personal care', null),
    ('HexClad', 'hexclad.com', 'copycraft', 'home', null),
    ('Harry''s', 'harrys.com', 'copycraft', 'personal care', null),
    ('Magic Mind', 'magicmind.com', 'adjacent', 'supplements', '104654481112161')
) as s(name, domain, tier, category, meta_page_id)
 where c.name = s.name
   and c.meta_page_id is null
   and s.meta_page_id is not null;

select count(*) as companies, count(meta_page_id) as with_page_id from companies;
