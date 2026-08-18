import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { isMissingColumn } from "@/lib/schema";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/landing — the landing page registry.
 *
 * Optional filters: ?companyId=…&pageType=…&live=1 (live = still running ads).
 */
async function getHandler(request: Request) {
  const params = new URL(request.url).searchParams;

  const companyId = params.get("companyId");
  const pageType = params.get("pageType");
  const liveOnly = params.get("live") === "1";

  // `hidden` arrives with migration 0010. Ask for it, and if the column isn't
  // there yet, run the same query without the filter rather than 500-ing the
  // whole tab over a feature that simply isn't installed.
  const build = (withHidden: boolean) => {
    let q = db()
      .from("landing_pages")
      .select(
        "id, url, page_type, first_seen, last_seen, runs_seen, ad_records_latest, ad_records_total, example_ad_url, params, company_id, companies(name)"
      )
      .order("ad_records_latest", { ascending: false })
      .order("last_seen", { ascending: false })
      .limit(1000);

    if (withHidden) q = q.eq("hidden", false);
    if (companyId) q = q.eq("company_id", companyId);
    if (pageType) q = q.eq("page_type", pageType);
    if (liveOnly) q = q.gt("ad_records_latest", 0);
    return q;
  };

  let { data, error } = await build(true);
  if (error && isMissingColumn(error.message)) {
    ({ data, error } = await build(false));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pages = (data ?? []).map((row) => {
    const { companies, ...rest } = row as typeof row & {
      companies: { name: string } | { name: string }[] | null;
    };
    const company = Array.isArray(companies) ? companies[0] : companies;
    return { ...rest, companyName: company?.name ?? null };
  });

  return NextResponse.json({ pages });
}

export const GET = withConfig([requires.supabase], getHandler);
