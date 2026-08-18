-- The auto-gate may promote a page, never demote one.
--
-- Run in the Supabase SQL Editor. Run this BEFORE re-running 0012, or the
-- requeue gets undone again by the next capture.
--
-- THE BUG: re-capturing re-applied the gate's verdict to any page a human had
-- not yet ruled on. That was meant to be generous — a page rejected at 3.2,
-- rewritten, now scoring 4.6, deserves a second look. But it ran in both
-- directions, so a page sitting in the review queue could be re-scored and
-- thrown out from under you. Requeue six pages, hit Capture, all six vanish
-- with nothing to say why.
--
-- It also made recovery non-durable: 0012 sets status to queued and leaves
-- reviewed_at null (correctly — no human has ruled), which is precisely the
-- condition that let the next capture undo it.
--
-- THE RULE: once a page is in the queue it stays there until a person decides.
-- The gate keeps junk from reaching the queue; it does not remove work already
-- sitting in one.
--
-- This file is generated from the function as it exists in 0001_init.sql with
-- exactly one expression changed, so the signature and the rest of the body
-- cannot drift.

create or replace function ingest_page_version(
  p_url             text,
  p_url_normalized  text,
  p_title           text,
  p_source          text,
  p_source_ref      text,
  p_company_id      uuid,
  p_content_hash    text,
  p_raw_text        text,
  p_screenshot_path text,
  p_scores          jsonb,
  p_composite       numeric,
  p_why_good        text,
  p_status          text,
  p_blocks          jsonb,
  p_tags            text[]
) returns jsonb
language plpgsql
as $$
declare
  v_page_id    uuid;
  v_is_new     boolean := false;
  v_version_id uuid;
  v_current    record;
  v_block      jsonb;
  v_label      text;
  v_tag_id     uuid;
begin
  select id into v_page_id from pages where url_normalized = p_url_normalized;

  if v_page_id is null then
    insert into pages (company_id, url, url_normalized, title, source, source_ref, status)
    values (p_company_id, p_url, p_url_normalized, p_title, p_source, p_source_ref, p_status)
    returning id into v_page_id;
    v_is_new := true;
  else
    -- Recapture: refresh descriptive fields, preserve HUMAN review state.
    --
    -- A page the human never touched (reviewed_at is null) is still owned by
    -- the auto-gate, so re-apply the gate's verdict. Without this, a page
    -- discarded at 3.2 that gets rewritten and now scores 4.6 stays discarded
    -- forever and never gets a second look. Once a human has ruled on it,
    -- status/stars/tags are theirs and we never overwrite them.
    update pages
       set title      = coalesce(p_title, title),
           company_id = coalesce(company_id, p_company_id),
           url        = p_url,
           status     = case
                          -- Three cases, in order of who owns the decision:
                          --   reviewed  -> the person owns it; never touch
                          --   queued    -> already in someone's queue; never remove
                          --   otherwise -> still the gate's call, so re-apply it
                          when reviewed_at is not null then status
                          when status = 'queued'       then 'queued'
                          else p_status
                        end
     where id = v_page_id;
  end if;

  select * into v_current
    from page_versions
   where page_id = v_page_id and is_current
   limit 1;

  if v_current.id is not null and v_current.content_hash = p_content_hash then
    return jsonb_build_object(
      'page_id',   v_page_id,
      'version_id', v_current.id,
      'unchanged', true,
      'is_new_page', v_is_new
    );
  end if;

  update page_versions set is_current = false where page_id = v_page_id and is_current;

  insert into page_versions (
    page_id, content_hash, screenshot_path, raw_text,
    scores, composite_score, why_good, is_current
  ) values (
    v_page_id, p_content_hash, p_screenshot_path, p_raw_text,
    p_scores, p_composite, p_why_good, true
  )
  on conflict (page_id, content_hash) do update
    set is_current      = true,
        screenshot_path = excluded.screenshot_path,
        scores          = excluded.scores,
        composite_score = excluded.composite_score,
        why_good        = excluded.why_good
  returning id into v_version_id;

  -- Blocks belong to the version; older versions keep their own blocks intact.
  delete from copy_blocks where page_version_id = v_version_id;

  for v_block in select * from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb))
  loop
    insert into copy_blocks (page_version_id, page_id, block_type, content, position)
    values (
      v_version_id,
      v_page_id,
      coalesce(v_block->>'block_type', 'other'),
      v_block->>'content',
      coalesce((v_block->>'position')::int, 0)
    );
  end loop;

  foreach v_label in array coalesce(p_tags, '{}'::text[])
  loop
    insert into tags (label, kind) values (v_label, 'system')
      on conflict (label) do nothing;
    select id into v_tag_id from tags where label = v_label;
    insert into page_tags (page_id, tag_id) values (v_page_id, v_tag_id)
      on conflict do nothing;
  end loop;

  return jsonb_build_object(
    'page_id',    v_page_id,
    'version_id', v_version_id,
    'unchanged',  false,
    'is_new_page', v_is_new
  );
end;
$$;
