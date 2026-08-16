-- Seed the brand list — 45 companies, 7 with a verified meta_page_id.
--
-- Run in the Supabase SQL Editor AFTER 0001_init.sql. Safe to re-run: a brand
-- already present by name, domain, or page_id is skipped, never duplicated.
--
-- Rows without a meta_page_id are inert until you paste one in on /companies.
-- Grab it from the Ad Library URL parameter `view_all_page_id`.

insert into companies (name, domain, tier, category, meta_page_id)
select s.name, s.domain, s.tier, s.category, s.meta_page_id
from (
  values
    ('UpWellness', 'upwellness.com', 'direct', 'supplements', '101942308432014'),
    ('Ritual', 'ritual.com', 'direct', 'vitamins', null),
    ('AG1', 'drinkag1.com', 'direct', 'greens', null),
    ('Seed', 'seed.com', 'direct', 'probiotics', null),
    ('Care/of', 'takecareof.com', 'direct', 'vitamins', null),
    ('Momentous', 'livemomentous.com', 'direct', 'performance', null),
    ('Thorne', 'thorne.com', 'direct', 'supplements', null),
    ('Legion Athletics', 'legionathletics.com', 'direct', 'sports nutrition', null),
    ('Transparent Labs', 'transparentlabs.com', 'direct', 'sports nutrition', null),
    ('LMNT', 'drinklmnt.com', 'direct', 'electrolytes', null),
    ('Cymbiotika', 'cymbiotika.com', 'direct', 'supplements', null),
    ('MaryRuth Organics', 'maryruthorganics.com', 'direct', 'vitamins', null),
    ('Needed', 'thisisneeded.com', 'direct', 'prenatal', null),
    ('Perelel', 'perelelhealth.com', 'direct', 'prenatal', null),
    ('Nutrafol', 'nutrafol.com', 'direct', 'hair wellness', null),
    ('Oura', 'ouraring.com', 'adjacent', 'wearables', null),
    ('Eight Sleep', 'eightsleep.com', 'adjacent', 'sleep tech', null),
    ('Function Health', 'functionhealth.com', 'adjacent', 'diagnostics', null),
    ('Curology', 'curology.com', 'adjacent', 'skincare', null),
    ('Hims', 'hims.com', 'adjacent', 'telehealth', null),
    ('Dr. Squatch', 'drsquatch.com', 'adjacent', 'personal care', '118075261668462'),
    ('Liquid Death', 'liquiddeath.com', 'adjacent', 'beverage', null),
    ('Magic Spoon', 'magicspoon.com', 'adjacent', 'food', null),
    ('Chomps', 'chomps.com', 'adjacent', 'food', null),
    ('Graza', 'graza.co', 'adjacent', 'pantry', null),
    ('Fly By Jing', 'flybyjing.com', 'adjacent', 'food', null),
    ('Brooklinen', 'brooklinen.com', 'adjacent', 'home', null),
    ('Quip', 'getquip.com', 'adjacent', 'oral care', null),
    ('Warby Parker', 'warbyparker.com', 'adjacent', 'eyewear', null),
    ('Allbirds', 'allbirds.com', 'adjacent', 'apparel', null),
    ('Oatly', 'oatly.com', 'copycraft', 'beverage', null),
    ('Who Gives A Crap', 'whogivesacrap.org', 'copycraft', 'household', null),
    ('Bombas', 'bombas.com', 'copycraft', 'apparel', null),
    ('Tushy', 'hellotushy.com', 'copycraft', 'bathroom', null),
    ('Poo-Pourri', 'poopourri.com', 'copycraft', 'household', null),
    ('Death Wish Coffee', 'deathwishcoffee.com', 'copycraft', 'beverage', null),
    ('Purple', 'purple.com', 'copycraft', 'mattress', null),
    ('Jones Road Beauty', 'jonesroadbeauty.com', 'copycraft', 'beauty', null),
    ('HexClad', 'hexclad.com', 'copycraft', 'cookware', null),
    ('Harry''s', 'harrys.com', 'copycraft', 'personal care', null),
    ('Magic Mind', 'magicmind.com', 'adjacent', 'nootropics', '104654481112161'),
    ('Grace Burchest (advertorial)', null, 'advertorial', 'womens health', '1296622906859770'),
    ('Dr. Yolanda Holmes (advertorial)', null, 'advertorial', 'hair/menopause', '1012554768807521'),
    ('American Health Support Community', null, 'advertorial', 'general health', '966175593248497'),
    ('Hair Facts (advertorial)', null, 'advertorial', 'hair loss', '423598927499249')
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
    ('Ritual', 'ritual.com', 'direct', 'vitamins', null),
    ('AG1', 'drinkag1.com', 'direct', 'greens', null),
    ('Seed', 'seed.com', 'direct', 'probiotics', null),
    ('Care/of', 'takecareof.com', 'direct', 'vitamins', null),
    ('Momentous', 'livemomentous.com', 'direct', 'performance', null),
    ('Thorne', 'thorne.com', 'direct', 'supplements', null),
    ('Legion Athletics', 'legionathletics.com', 'direct', 'sports nutrition', null),
    ('Transparent Labs', 'transparentlabs.com', 'direct', 'sports nutrition', null),
    ('LMNT', 'drinklmnt.com', 'direct', 'electrolytes', null),
    ('Cymbiotika', 'cymbiotika.com', 'direct', 'supplements', null),
    ('MaryRuth Organics', 'maryruthorganics.com', 'direct', 'vitamins', null),
    ('Needed', 'thisisneeded.com', 'direct', 'prenatal', null),
    ('Perelel', 'perelelhealth.com', 'direct', 'prenatal', null),
    ('Nutrafol', 'nutrafol.com', 'direct', 'hair wellness', null),
    ('Oura', 'ouraring.com', 'adjacent', 'wearables', null),
    ('Eight Sleep', 'eightsleep.com', 'adjacent', 'sleep tech', null),
    ('Function Health', 'functionhealth.com', 'adjacent', 'diagnostics', null),
    ('Curology', 'curology.com', 'adjacent', 'skincare', null),
    ('Hims', 'hims.com', 'adjacent', 'telehealth', null),
    ('Dr. Squatch', 'drsquatch.com', 'adjacent', 'personal care', '118075261668462'),
    ('Liquid Death', 'liquiddeath.com', 'adjacent', 'beverage', null),
    ('Magic Spoon', 'magicspoon.com', 'adjacent', 'food', null),
    ('Chomps', 'chomps.com', 'adjacent', 'food', null),
    ('Graza', 'graza.co', 'adjacent', 'pantry', null),
    ('Fly By Jing', 'flybyjing.com', 'adjacent', 'food', null),
    ('Brooklinen', 'brooklinen.com', 'adjacent', 'home', null),
    ('Quip', 'getquip.com', 'adjacent', 'oral care', null),
    ('Warby Parker', 'warbyparker.com', 'adjacent', 'eyewear', null),
    ('Allbirds', 'allbirds.com', 'adjacent', 'apparel', null),
    ('Oatly', 'oatly.com', 'copycraft', 'beverage', null),
    ('Who Gives A Crap', 'whogivesacrap.org', 'copycraft', 'household', null),
    ('Bombas', 'bombas.com', 'copycraft', 'apparel', null),
    ('Tushy', 'hellotushy.com', 'copycraft', 'bathroom', null),
    ('Poo-Pourri', 'poopourri.com', 'copycraft', 'household', null),
    ('Death Wish Coffee', 'deathwishcoffee.com', 'copycraft', 'beverage', null),
    ('Purple', 'purple.com', 'copycraft', 'mattress', null),
    ('Jones Road Beauty', 'jonesroadbeauty.com', 'copycraft', 'beauty', null),
    ('HexClad', 'hexclad.com', 'copycraft', 'cookware', null),
    ('Harry''s', 'harrys.com', 'copycraft', 'personal care', null),
    ('Magic Mind', 'magicmind.com', 'adjacent', 'nootropics', '104654481112161'),
    ('Grace Burchest (advertorial)', null, 'advertorial', 'womens health', '1296622906859770'),
    ('Dr. Yolanda Holmes (advertorial)', null, 'advertorial', 'hair/menopause', '1012554768807521'),
    ('American Health Support Community', null, 'advertorial', 'general health', '966175593248497'),
    ('Hair Facts (advertorial)', null, 'advertorial', 'hair loss', '423598927499249')
) as s(name, domain, tier, category, meta_page_id)
 where c.name = s.name
   and c.meta_page_id is null
   and s.meta_page_id is not null;

select count(*) as companies, count(meta_page_id) as with_page_id from companies;
