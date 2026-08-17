import { fetchAdsForPage } from "./meta";
import { withRunLog } from "./runlog";
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
export async function pollAdLibrary(trigger: "manual" | "cron" = "manual"): Promise<PollResult> {
  return withRunLog("ad_poll", { trigger, classify: classifyPoll }, runPoll);
}

/**
 * A poll can finish cleanly and still be worthless. Zero ads across every
 * seeded page is indistinguishable from a quiet week unless we say so out loud,
 * and a partial failure is easy to miss when the response still says ok.
 */
function classifyPoll(result: PollResult) {
  const failed = result.report.filter((r) => r.error).length;
  const summary = {
    companiesPolled: result.companiesPolled,
    totalAds: result.totalAds,
    hooksTouched: result.report.reduce((n, r) => n + r.hooksTouched, 0),
    companiesFailed: failed,
  };

  if (failed > 0 && failed === result.companiesPolled) {
    return { status: "error" as const, summary, warning: `Every brand failed to poll.` };
  }
  if (failed > 0) {
    return {
      status: "warning" as const,
      summary,
      warning: `${failed} of ${result.companiesPolled} brands failed: ${result.report
        .filter((r) => r.error)
        .map((r) => `${r.company} (${r.error})`)
        .join("; ")}`,
    };
  }
  if (result.alert) return { status: "warning" as const, summary, warning: result.alert };
  return { status: "ok" as const, summary };
}

async function runPoll(): Promise<PollResult> {
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
        ? zeroAdsAlert(report)
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

/**
 * Say which kind of nothing this was.
 *
 * "Check META_ACCESS_TOKEN" is actively misleading when the token is present
 * and Meta is rejecting its TYPE. An app access token — the `{app-id}|{secret}`
 * form — is well-formed but ads_archive refuses it, and the refusal it sends
 * back ("Cannot parse access token") reads like a typo, sending you off to
 * re-copy a credential that was never the problem.
 */
function zeroAdsAlert(report: PollReportRow[]): string {
  const badToken = report.some((r) => /OAuth access token|parse access token|code 190/i.test(r.error ?? ""));

  if (badToken) {
    return (
      "Meta rejected the credential on every page. The Ad Library API does not accept an app " +
      "access token (META_APP_ID + META_APP_SECRET), only a User or System User token with " +
      "ads_read — a System User token is the durable choice, since it does not expire. " +
      "Note this blocks the hooks queue ONLY: the Landing Pages tab scrapes the public Ad " +
      "Library and needs no Meta credential at all."
    );
  }

  return (
    "ZERO ADS RETURNED across every seeded page. The credential was accepted, so this is either " +
    "a genuinely quiet week or the page_ids are wrong — check one brand on the Landing Pages tab, " +
    "which reads the same advertisers without the API."
  );
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
