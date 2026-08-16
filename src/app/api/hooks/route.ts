import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/hooks — ad_hooks where status='new', ranked by budget concentration
 * then longevity. Both signals are accumulated from our own polling history;
 * they mean little before ~six weeks of data (spec §1.4).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? "new";
  const limit = Math.min(Number(params.get("limit")) || 50, 200);

  const { data, error } = await db()
    .from("ad_hooks")
    // Keep this a single string literal — supabase-js infers the row type from
    // it at the type level, and a concatenated expression defeats that.
    .select(
      "id, display_title, variant_count, peak_variant_count, days_running, first_seen_at, last_seen_at, snapshot_url, status, company_id, companies(name)"
    )
    .eq("status", status)
    .order("variant_count", { ascending: false })
    .order("days_running", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const hooks = (data ?? []).map((h) => {
    const company = h.companies as { name?: string } | { name?: string }[] | null;
    return {
      id: h.id as string,
      companyName: Array.isArray(company) ? company[0]?.name ?? null : company?.name ?? null,
      displayTitle: h.display_title as string,
      variantCount: (h.variant_count as number) ?? 0,
      peakVariantCount: (h.peak_variant_count as number) ?? 0,
      daysRunning: (h.days_running as number) ?? 0,
      snapshotUrl: (h.snapshot_url as string | null) ?? null,
      status: h.status as string,
    };
  });

  return NextResponse.json({ hooks });
}
