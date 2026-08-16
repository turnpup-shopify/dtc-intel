import { NextResponse } from "next/server";
import { cronRequestIsAuthorized } from "@/lib/auth";
import { env } from "@/lib/env";
import { processUrl } from "@/lib/pipeline";
import { fetchSitemapPageUrls } from "@/lib/sitemap";
import { db } from "@/lib/supabase";
import { tryNormalizeUrl } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Weekly sitemap diff (spec §6.6).
 *
 * Fetch each company's page sitemap, diff against known url_normalized values,
 * and push new URLs through the pipeline — up to DAILY_PAGE_CAP. The remainder
 * is left undiscovered and picked up next run, so a sitemap that suddenly grows
 * by 400 URLs can't dump 400 pages into the morning queue.
 */
export async function POST(request: Request) {
  if (!cronRequestIsAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cap = env.dailyPageCap;

  const { data: companies, error } = await db()
    .from("companies")
    .select("id, name, domain")
    .not("domain", "is", null)
    .eq("active", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: known } = await db().from("pages").select("url_normalized");
  const seen = new Set((known ?? []).map((p) => p.url_normalized as string));

  const candidates: { url: string; companyId: string; company: string }[] = [];
  const perCompany: { company: string; found: number; fresh: number; error?: string }[] = [];

  for (const company of companies ?? []) {
    try {
      const urls = await fetchSitemapPageUrls(company.domain as string);
      const fresh = urls
        .map((u) => ({ raw: u, norm: tryNormalizeUrl(u) }))
        .filter((u): u is { raw: string; norm: string } => Boolean(u.norm))
        .filter((u) => !seen.has(u.norm));

      for (const u of fresh) {
        seen.add(u.norm); // dedupe within this run too
        candidates.push({ url: u.raw, companyId: company.id as string, company: company.name as string });
      }

      perCompany.push({ company: company.name as string, found: urls.length, fresh: fresh.length });
    } catch (err) {
      perCompany.push({
        company: company.name as string,
        found: 0,
        fresh: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const batch = candidates.slice(0, cap);
  const deferred = candidates.length - batch.length;

  const processed = [];
  for (const candidate of batch) {
    const result = await processUrl(candidate.url, {
      source: "sitemap",
      sourceRef: `sitemap:${new Date().toISOString().slice(0, 10)}`,
      companyId: candidate.companyId,
    });
    processed.push({ company: candidate.company, ...result });
  }

  const queued = processed.filter((p) => p.ok && p.status === "queued").length;
  const discarded = processed.filter((p) => p.ok && p.status === "discarded").length;
  const failed = processed.filter((p) => !p.ok);

  if (failed.length) {
    console.error(`[cron:sitemap-diff] ${failed.length} page(s) failed to capture`, failed);
  }

  return NextResponse.json({
    ok: true,
    cap,
    candidatesFound: candidates.length,
    processed: processed.length,
    deferred,
    queued,
    discarded,
    failed: failed.length,
    perCompany,
    results: processed,
  });
}

export const GET = POST;
