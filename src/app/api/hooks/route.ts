import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { db, signedScreenshotUrl } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/hooks — ad_hooks where status='new', ranked by budget concentration
 * then longevity. Both signals are accumulated from our own polling history;
 * they mean little before ~six weeks of data (spec §1.4).
 */
async function getHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  // Default to work-in-progress: `new` plus `clicked`, so a hook you opened but
  // haven't pasted back yet survives a refresh.
  const status = params.get("status")?.split(",") ?? ["new", "clicked"];
  const limit = Math.min(Number(params.get("limit")) || 50, 200);

  const { data, error } = await db()
    .from("ad_hooks")
    // Keep this a single string literal — supabase-js infers the row type from
    // it at the type level, and a concatenated expression defeats that.
    .select(
      "id, display_title, variant_count, peak_variant_count, days_running, first_seen_at, last_seen_at, snapshot_url, creative_path, creative_ad_id, status, company_id, companies(name)"
    )
    .in("status", status)
    .order("variant_count", { ascending: false })
    .order("days_running", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Signed in parallel: the bucket is private, so a stored creative is only
  // viewable through a short-lived URL minted per request.
  const hooks = await Promise.all((data ?? []).map(async (h) => {
    const company = h.companies as { name?: string } | { name?: string }[] | null;
    return {
      id: h.id as string,
      companyName: Array.isArray(company) ? company[0]?.name ?? null : company?.name ?? null,
      displayTitle: h.display_title as string,
      variantCount: (h.variant_count as number) ?? 0,
      peakVariantCount: (h.peak_variant_count as number) ?? 0,
      daysRunning: (h.days_running as number) ?? 0,
      snapshotUrl: (h.snapshot_url as string | null) ?? null,
      creativeUrl: await signedScreenshotUrl(h.creative_path as string | null),
      creativeAdId: (h.creative_ad_id as string | null) ?? null,
      status: h.status as string,
    };
  }));

  return NextResponse.json({ hooks });
}

export const GET = withConfig([requires.supabase], getHandler);
