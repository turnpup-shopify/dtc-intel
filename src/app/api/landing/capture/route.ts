import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { classifyCapture } from "@/lib/capture-log";
import { processUrl } from "@/lib/pipeline";
import { withRunLog } from "@/lib/runlog";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Capturing a page costs a scrape plus an LLM scoring pass — tens of seconds
 * each. Small batches, with the client driving the loop, so a slow page can't
 * take the whole run down with it.
 */
const MAX_PER_REQUEST = 4;

/**
 * POST /api/landing/capture { ids: string[] } — push harvested landing pages
 * into the review pipeline.
 *
 * This is the step the hooks queue used to do by hand. The Ad Library API has
 * no destination-URL field, so the only way to get from an ad to its landing
 * page was for a human to click the snapshot and paste the URL back. Scraping
 * the public Ad Library gives us that URL directly, which means the archive can
 * be fed without the manual hop — and without a Meta credential.
 */
async function postHandler(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  const ids = (body.ids ?? []).filter((id) => typeof id === "string").slice(0, MAX_PER_REQUEST);

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids is required" }, { status: 400 });
  }

  const { data: targets, error } = await db()
    .from("landing_pages")
    .select("id, url, company_id")
    .in("id", ids);

  if (error) throw new Error(error.message);

  // An empty match used to return ok:true with no results, which the UI had
  // nothing to render — the click looked like it did nothing at all.
  if (!targets || targets.length === 0) {
    return NextResponse.json(
      { error: "None of those landing pages exist any more. Re-scan and try again." },
      { status: 404 }
    );
  }

  const results = [];
  for (const target of targets ?? []) {
    const result = await withRunLog(
      "page_capture",
      {
        companyId: (target.company_id as string) ?? null,
        subject: target.url as string,
        classify: classifyCapture,
      },
      () =>
        // `ad_hook` is the honest source: these URLs came from an ad. The
        // difference is only that a scraper read the link instead of a person.
        processUrl(target.url as string, {
          source: "ad_hook",
          sourceRef: `landing_page:${target.id}`,
          companyId: (target.company_id as string) ?? null,
        })
    ).catch((err) => ({
      ok: false as const,
      url: target.url as string,
      urlNormalized: "",
      error: err instanceof Error ? err.message : String(err),
    }));

    results.push({ id: target.id, ...result });
  }

  return NextResponse.json({
    ok: true,
    captured: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}

export const POST = withConfig(
  [requires.supabase, requires.anthropic, requires.scraper],
  postHandler
);
