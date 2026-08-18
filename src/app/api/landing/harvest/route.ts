import { NextResponse } from "next/server";
import { harvestBrand, type HarvestReport } from "@/lib/adlibrary/harvest";
import { syncHooksFromCards } from "@/lib/adlibrary/hooks-sync";
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
  hooksTouched: number;
  headlinesFound: number;
  creativesStored: number;
};

/**
 * POST /api/landing/harvest { companyId } — scrape one brand's Ad Library page
 * and merge the landing pages it advertises into the registry.
 *
 * Note what this does NOT require: a Meta credential. The Ad Library API has no
 * destination-URL field at all, and refuses app tokens besides. The public web UI does expose it — every CTA is wrapped as
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
          expectedAds: r.estimate,
          expectedFrom: r.estimateSource,
          uniquePages: r.rows.length,
          adsWithoutLink: r.withoutDestination,
          inserted: r.inserted,
          updated: r.updated,
          retired: r.retired,
          headlinesFound: r.headlinesFound,
          hooksTouched: r.hooksTouched,
          creativesStored: r.creativesStored,
          // The autopsy, flattened so it reads in the run log without drilling.
          ...(r.diagnostics
            ? {
                htmlBytes: r.diagnostics.htmlBytes,
                sawLibraryIdMarker: r.diagnostics.sawLibraryIdMarker,
                sawResultsText: r.diagnostics.sawResultsText,
                redirectorLinks: r.diagnostics.redirectorLinks,
                pageStartedWith: r.diagnostics.bodyTextSample,
              }
            : {}),
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

      // Same scrape, second output. The hooks queue used to need its own API
      // call and a Meta token; the cards we already have carry the headline,
      // the snapshot link and the ad id, which is everything the rollup reads.
      // Never let a hooks failure discard a good landing page harvest.
      let hooks = { hooksTouched: 0, withHeadline: 0, creativesStored: 0 };
      try {
        hooks = await syncHooksFromCards(company.id as string, report.cards);
      } catch (err) {
        console.error("[harvest] hooks sync failed", err instanceof Error ? err.message : err);
      }

      return {
        ...report,
        inserted: Number(counts.inserted) || 0,
        updated: Number(counts.updated) || 0,
        retired: Number(counts.retired) || 0,
        hooksTouched: hooks.hooksTouched,
        headlinesFound: hooks.withHeadline,
        creativesStored: hooks.creativesStored,
      };
    }
  );

  // `cards` is the raw scrape payload — useful server-side, needless weight on
  // the wire, and it would balloon a 17-brand scan in the browser.
  const { cards: _cards, ...wire } = result;
  return NextResponse.json({ ok: true, company: company.name, ...wire });
}

export const POST = withConfig([requires.supabase, requires.scraper], postHandler);
