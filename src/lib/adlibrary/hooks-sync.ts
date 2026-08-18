import { db } from "../supabase";
import { syncHookCreatives } from "./creatives";
import { displayLinkTitle, normalizeLinkTitle } from "../text";
import type { AdCard } from "./parse";

export interface HooksSyncResult {
  adsSeen: number;
  /** Cards whose headline could be isolated. Only these can become hooks. */
  withHeadline: number;
  hooksTouched: number;
  creativesStored: number;
}

/**
 * Populate the hooks queue from scraped ad cards instead of the Ad Library API.
 *
 * The API path needs a User or System User token — an app token is refused
 * outright — and it was only ever supplying three things the rollup uses:
 * the headline, the snapshot link, and an ad id. The scrape has all three, plus
 * the destination URL the API has never exposed.
 *
 * Nothing downstream changes. Rows land in `ads` exactly as the poll wrote
 * them, and rebuild_ad_hooks does the same rollup, so variant counts and
 * longevity keep accumulating across both eras of data.
 *
 * Note what is deliberately NOT written: ad_creation_time and delivery_start.
 * The page does not state them reliably, and the rollup never reads them —
 * longevity comes from first_seen_at, which is our own observation history.
 * Inventing a date to fill a column would corrupt the one signal that matters.
 */
export async function syncHooksFromCards(
  companyId: string,
  cards: AdCard[]
): Promise<HooksSyncResult> {
  const seenAt = new Date().toISOString();

  const rows = cards
    .filter((c) => c.headline && normalizeLinkTitle(c.headline))
    .map((c) => ({
      ad_id: c.libraryId,
      company_id: companyId,
      link_title: displayLinkTitle(c.headline ?? "") || null,
      link_title_norm: normalizeLinkTitle(c.headline ?? "") || null,
      snapshot_url: c.snapshotUrl,
      creative_url: c.creativeUrl,
      last_seen_at: seenAt,
      still_active: true,
    }));

  if (rows.length > 0) {
    // first_seen_at defaults on insert and is left alone on conflict, so an ad
    // we have watched for six weeks keeps its six weeks.
    const { error } = await db().from("ads").upsert(rows, { onConflict: "ad_id" });
    if (error) throw new Error(`ads upsert failed: ${error.message}`);
  }

  // Anything for this brand we did not see this run has stopped running.
  const { error: deactivateError } = await db()
    .from("ads")
    .update({ still_active: false })
    .eq("company_id", companyId)
    .lt("last_seen_at", seenAt);
  if (deactivateError) throw new Error(`deactivate failed: ${deactivateError.message}`);

  const { data: touched, error: rollupError } = await db().rpc("rebuild_ad_hooks", {
    p_company_id: companyId,
  });
  if (rollupError) throw new Error(`rebuild_ad_hooks failed: ${rollupError.message}`);

  // After the rollup, because the rollup decides which ad represents each hook.
  // Downloading earlier would fetch one image per AD rather than per hook.
  const creatives = await syncHookCreatives(companyId);

  return {
    adsSeen: cards.length,
    withHeadline: rows.length,
    hooksTouched: Number(touched) || 0,
    creativesStored: creatives.stored,
  };
}
