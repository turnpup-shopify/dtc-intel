import { NextResponse } from "next/server";
import { harvestBrand, type HarvestReport } from "@/lib/adlibrary/harvest";
import { requires, withConfig } from "@/lib/api";
import { withRunLog } from "@/lib/runlog";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

/** The harvest report plus what the registry merge did with it. */
type HarvestOutcome = HarvestReport & {
  inserted: number;
  updated: number;
  retired: number;
};

/**
 * POST /api/landing/harvest { companyId } — scrape one brand's Ad Library page
 * and merge the landing pages it advertises into the registry.
 *
 * Note what this does NOT require: META_ACCESS_TOKEN. The Ad Library API has no
 * destination-URL field at all, which is why the hooks queue needs a human to
 * paste one back. The public web UI does expose it — every CTA is wrapped as
 * l.facebook.com/l.php?u=<destination> — so this path reads the landing page
 * straight out of the href. Different source, different capability.
 */
async function postHandler(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  if (!body.companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  const { data: company, error } = await db()
    .from("companies")
    .select("id, name, meta_page_id")
    .eq("id", body.companyId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!company?.meta_page_id) {
    return NextResponse.json(
      { error: `${company?.name ?? "That brand"} has no meta_page_id yet — add one on /companies.` },
      { status: 400 }
    );
  }

  const result = await withRunLog(
    "lp_harvest",
    {
      companyId: company.id as string,
      subject: company.name as string,
      classify: (r: HarvestOutcome) => ({
        // A stalled harvest still returns rows — that is exactly why it needs
        // to be logged as a warning rather than a success.
        status: r.completeness === "complete" ? ("ok" as const) : ("warning" as const),
        warning: r.warning,
        summary: {
          adsHarvested: r.cardsHarvested,
          metaEstimate: r.estimate,
          uniquePages: r.rows.length,
          adsWithoutLink: r.withoutDestination,
          inserted: r.inserted,
          updated: r.updated,
          retired: r.retired,
        },
      }),
    },
    async (): Promise<HarvestOutcome> => {
      const report = await harvestBrand(company.meta_page_id as string);

      // Stage two. The rows are already collapsed one-per-landing-page by the
      // harvester, so the RPC can increment runs_seen exactly once each.
      const { data: merged, error: mergeError } = await db().rpc("merge_landing_pages", {
        p_company_id: company.id,
        p_rows: report.rows,
      });
      if (mergeError) throw new Error(mergeError.message);

      const counts = (Array.isArray(merged) ? merged[0] : merged) ?? {};
      return {
        ...report,
        inserted: Number(counts.inserted) || 0,
        updated: Number(counts.updated) || 0,
        retired: Number(counts.retired) || 0,
      };
    }
  );

  return NextResponse.json({ ok: true, company: company.name, ...result });
}

export const POST = withConfig([requires.supabase, requires.scraper], postHandler);
