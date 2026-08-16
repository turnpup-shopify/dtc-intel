import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
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
async function postHandler(request: Request) {
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

  // Collect every sitemap candidate first, then ask the database which of THOSE
  // it already has. Loading the whole `pages` table instead would silently stop
  // deduping once the archive outgrows PostgREST's row cap, and the job would
  // re-scrape and re-score pages it already owns, every week, forever.
  const seenThisRun = new Set<string>();
  const candidates: { url: string; norm: string; companyId: string; company: string }[] = [];
  const perCompany: { company: string; found: number; fresh: number; error?: string }[] = [];

  for (const company of companies ?? []) {
    try {
      const urls = await fetchSitemapPageUrls(company.domain as string);
      let fresh = 0;

      for (const raw of urls) {
        const norm = tryNormalizeUrl(raw);
        if (!norm || seenThisRun.has(norm)) continue;
        seenThisRun.add(norm);
        fresh++;
        candidates.push({
          url: raw,
          norm,
          companyId: company.id as string,
          company: company.name as string,
        });
      }

      perCompany.push({ company: company.name as string, found: urls.length, fresh });
    } catch (err) {
      perCompany.push({
        company: company.name as string,
        found: 0,
        fresh: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const known = await knownUrls(candidates.map((c) => c.norm));
  const unknown = candidates.filter((c) => !known.has(c.norm));

  const batch = unknown.slice(0, cap);
  const deferred = unknown.length - batch.length;

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
    alreadyKnown: candidates.length - unknown.length,
    newUrls: unknown.length,
    processed: processed.length,
    deferred,
    queued,
    discarded,
    failed: failed.length,
    perCompany,
    results: processed,
  });
}


/**
 * Which of these normalized URLs do we already have? Chunked, because a large
 * sitemap sweep can produce more candidates than fit in one `in()` filter.
 */
async function knownUrls(norms: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  const CHUNK = 200;

  for (let i = 0; i < norms.length; i += CHUNK) {
    const chunk = norms.slice(i, i + CHUNK);
    const { data, error } = await db()
      .from("pages")
      .select("url_normalized")
      .in("url_normalized", chunk)
      .limit(chunk.length);

    if (error) throw new Error(`known-url lookup failed: ${error.message}`);
    for (const row of data ?? []) known.add(row.url_normalized as string);
  }

  return known;
}

export const POST = withConfig([requires.supabase, requires.anthropic, requires.scraper], postHandler);
// Vercel Cron issues GET by default; accept both.
export const GET = POST;
