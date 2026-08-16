-- Rework the category taxonomy and drop the advertorial operators.
--
-- Run in the Supabase SQL Editor after 0002. Safe to re-run.
--
-- The seeded categories were whatever the CSV happened to say — 29 distinct
-- values across 45 brands, several of them one-offs ("pantry", "sleep tech",
-- "bathroom"). That granularity is useless as a filter: the point of a category
-- is "show me proof blocks from supplements brands" versus "show me voice from
-- an adjacent category", and a bucket of one answers neither.
--
-- Six buckets, enforced by a constraint so the taxonomy can't drift again.

-- ---------------------------------------------------------------------------
-- 1. Remove the advertorial operators.
--
-- Matched on meta_page_id, which is exact — names vary by how they were entered.
-- Cascades: their `ads` and `ad_hooks` go with them; any captured `pages` keep
-- their copy and have company_id set to null, so nothing is lost from the archive.
-- ---------------------------------------------------------------------------
delete from companies
 where meta_page_id in (
   '966175593248497',   -- American Health Support Community
   '1012554768807521',  -- Dr. Yolanda Holmes
   '1296622906859770',  -- Grace Burchest
   '423598927499249'    -- Hair Facts
 );

-- Belt and braces: any advertorial-tier row seeded under a different id.
delete from companies where tier = 'advertorial';

-- ---------------------------------------------------------------------------
-- 2. Collapse the old categories into the six.
--
-- Devices (Oura, Eight Sleep) go to health care rather than a two-brand
-- "health tech" bucket — what makes them worth swiping is metric-led health
-- storytelling, the same job as Hims and Function Health.
-- ---------------------------------------------------------------------------
update companies c
   set category = m.new_category
  from (
  values
    ('supplements',     'supplements'),
    ('vitamins',        'supplements'),
    ('greens',          'supplements'),
    ('probiotics',      'supplements'),
    ('performance',     'supplements'),
    ('sports nutrition','supplements'),
    ('electrolytes',    'supplements'),
    ('prenatal',        'supplements'),
    ('hair wellness',   'supplements'),
    ('nootropics',      'supplements'),

    ('beverage',        'food/bev'),
    ('food',            'food/bev'),
    ('pantry',          'food/bev'),

    ('personal care',   'personal care'),
    ('skincare',        'personal care'),
    ('beauty',          'personal care'),
    ('oral care',       'personal care'),

    ('apparel',         'fashion'),
    ('eyewear',         'fashion'),

    ('telehealth',      'health care'),
    ('diagnostics',     'health care'),
    ('wearables',       'health care'),
    ('sleep tech',      'health care'),

    ('home',            'home'),
    ('household',       'home'),
    ('bathroom',        'home'),
    ('mattress',        'home'),
    ('cookware',        'home')
  ) as m(old_category, new_category)
 where c.category = m.old_category;

-- Anything that still doesn't match the six (a brand added by hand with a
-- free-text category) is cleared rather than left to fail the constraint below.
update companies
   set category = null
 where category is not null
   and category not in ('supplements','food/bev','personal care','fashion','health care','home');

-- ---------------------------------------------------------------------------
-- 3. Enforce the taxonomy.
-- ---------------------------------------------------------------------------
alter table companies drop constraint if exists companies_category_check;
alter table companies add constraint companies_category_check
  check (category is null or category in
    ('supplements','food/bev','personal care','fashion','health care','home'));

select category, count(*) as brands
  from companies group by category order by count(*) desc, category;
