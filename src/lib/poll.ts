import { fetchAdsForPage } from "./meta";
import { db } from "./supabase";
import { displayLinkTitle, normalizeLinkTitle } from "./text";

export interface PollReportRow {
  company: string;
  adsSeen: number;
  hooksTouched: number;
  error?: string;
}

export interface PollResult {
  ok: boolean;
  startedAt: string;
  companiesPolled: number;
  totalAds: number;
  alert: string | null;
  report: PollReportRow[];
}

/**
 * Daily Ad Library poll (spec §6.5). Shared by the cron route and the manual
 * "Poll now" button, so the scheduled and on-demand paths can't drift.
 *
 * For each company with a meta_page_id: pull active US ads, upsert observations,
 * mark anything not seen this poll inactive, then rebuild the hook rollups.
 *
 * Note what this does NOT do: it never produces a landing page URL. The Ad
 * Library API has no destination-URL field (spec §1.2) — it returns headlines
 * and a link to the ad's snapshot page. Turning a hook into a page is the
 * human's click-through on /hooks.
 */
export async function pollAdLibrary(): Promise<PollResult> {
  const startedAt = new Date().toISOString();

  const { data: companies, error } = await db()
    .from("companies")
    .select("id, name, meta_page_id")
    .not("meta_page_id", "is", null)
    .eq("active", true);

  if (error) throw new Error(error.message);

  const report: PollReportRow[] = [];

  for (const company of companies ?? []) {
    const companyId = company.id as string;
    const pageId = company.meta_page_id as string;

    try {
      const ads = await fetchAdsForPage(pageId);
      const seenAt = new Date().toISOString();

      if (ads.length > 0) {
        const rows = ads.map((ad) => ({
          ad_id: ad.id,
          company_id: companyId,
          link_title: displayLinkTitle(ad.ad_creative_link_title) || null,
          link_title_norm: normalizeLinkTitle(ad.ad_creative_link_title) || null,
          ad_creation_time: toIso(ad.ad_creation_time),
          delivery_start: toIso(ad.ad_delivery_start_time),
          snapshot_url: ad.ad_snapshot_url ?? null,
          last_seen_at: seenAt,
          still_active: true,
        }));

        // On insert first_seen_at defaults to now(); on conflict we deliberately
        // leave it alone so longevity keeps accumulating.
        const { error: upsertError } = await db()
          .from("ads")
          .upsert(rows, { onConflict: "ad_id" });
        if (upsertError) throw new Error(upsertError.message);
      }

      // Anything belonging to this company that we didn't see this run is gone.
      const { error: deactivateError } = await db()
        .from("ads")
        .update({ still_active: false })
        .eq("company_id", companyId)
        .lt("last_seen_at", seenAt);
      if (deactivateError) throw new Error(deactivateError.message);

      const { data: touched, error: rollupError } = await db().rpc("rebuild_ad_hooks", {
        p_company_id: companyId,
      });
      if (rollupError) throw new Error(rollupError.message);

      report.push({
        company: company.name as string,
        adsSeen: ads.length,
        hooksTouched: Number(touched) || 0,
      });
    } catch (err) {
      report.push({
        company: company.name as string,
        adsSeen: 0,
        hooksTouched: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totalAds = report.reduce((sum, r) => sum + r.adsSeen, 0);
  const failures = report.filter((r) => r.error);

  // Alert on zero-result poll days — a silent failure is indistinguishable
  // from a quiet week.
  const alert =
    (companies?.length ?? 0) === 0
      ? "No companies have a meta_page_id yet. Add one on /companies before polling."
      : totalAds === 0
        ? "ZERO ADS RETURNED across every seeded page — check META_ACCESS_TOKEN and the Ad Library API before assuming a quiet week."
        : null;

  if (alert) console.error(`[poll-ads] ${alert}`);
  if (failures.length) {
    console.error(`[poll-ads] ${failures.length} company poll(s) failed`, failures);
  }

  return {
    ok: failures.length === 0,
    startedAt,
    companiesPolled: companies?.length ?? 0,
    totalAds,
    alert,
    report,
  };
}

function toIso(value: string | number | undefined): string | null {
  if (value == null) return null;
  // The API returns ISO date strings; older responses used unix seconds.
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    return new Date(Number(value) * 1000).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
