import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
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

  let query = db()
    .from("landing_pages")
    .select(
      "id, url, page_type, first_seen, last_seen, runs_seen, ad_records_latest, ad_records_total, example_ad_url, params, company_id, companies(name)"
    )
    .order("ad_records_latest", { ascending: false })
    .order("last_seen", { ascending: false })
    .limit(1000);

  const companyId = params.get("companyId");
  if (companyId) query = query.eq("company_id", companyId);

  const pageType = params.get("pageType");
  if (pageType) query = query.eq("page_type", pageType);

  if (params.get("live") === "1") query = query.gt("ad_records_latest", 0);

  const { data, error } = await query;
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
