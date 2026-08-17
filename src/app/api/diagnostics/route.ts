import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A run still "running" after this long is a function that died mid-flight. */
const STALL_AFTER_MS = 10 * 60 * 1000;

/**
 * GET /api/diagnostics — the state of the app and the history of what it did.
 *
 * Two questions, one call: what is in the database right now, and what happened
 * on the way there. /api/health answers a third (is it configured at all) and
 * the client fetches that separately, because it stays useful precisely when
 * this route cannot run.
 */
async function getHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const problemsOnly = params.get("problems") === "1";

  let runQuery = db()
    .from("run_log")
    .select("id, kind, trigger, started_at, finished_at, duration_ms, status, summary, warning, error, subject, companies(name)")
    .order("started_at", { ascending: false })
    .limit(200);

  if (kind) runQuery = runQuery.eq("kind", kind);
  if (problemsOnly) runQuery = runQuery.neq("status", "ok");

  const [runs, state] = await Promise.all([runQuery, systemState()]);
  if (runs.error) throw new Error(runs.error.message);

  const now = Date.now();
  const rows = (runs.data ?? []).map((row) => {
    const { companies, ...rest } = row as typeof row & {
      companies: { name: string } | { name: string }[] | null;
    };
    const company = Array.isArray(companies) ? companies[0] : companies;
    // A run that never closed is not "in progress" — the function timed out and
    // took its own error message with it. Surface that rather than a spinner.
    const stalled =
      rest.status === "running" && now - new Date(rest.started_at as string).getTime() > STALL_AFTER_MS;
    return {
      ...rest,
      companyName: company?.name ?? null,
      status: stalled ? "stalled" : rest.status,
      error: stalled
        ? "Never reported a result. The serverless function almost certainly hit its time limit — try a smaller batch."
        : rest.error,
    };
  });

  return NextResponse.json({ runs: rows, state });
}

/**
 * Row counts that tell you whether the pipeline is actually producing anything.
 *
 * Each count is independently fault-tolerant: a table that doesn't exist yet
 * (migration not applied) yields null for that one number instead of failing
 * the whole panel. Half a diagnosis beats none, and "—" is honest about which
 * half is missing.
 */
async function systemState() {
  const head = (table: string) => db().from(table).select("id", { count: "exact", head: true });

  const safe = async (
    q: PromiseLike<{ count: number | null; error: unknown }>
  ): Promise<number | null> => {
    try {
      const { count, error } = await q;
      return error ? null : (count ?? 0);
    } catch {
      return null;
    }
  };

  const [
    companies,
    companiesActive,
    companiesMapped,
    adsActive,
    hooksNew,
    hooksConverted,
    pagesQueued,
    pagesSaved,
    pagesDiscarded,
    landingPages,
    landingLive,
  ] = await Promise.all([
    safe(head("companies")),
    safe(head("companies").eq("active", true)),
    safe(head("companies").not("meta_page_id", "is", null).eq("active", true)),
    safe(head("ads").eq("still_active", true)),
    safe(head("ad_hooks").eq("status", "new")),
    safe(head("ad_hooks").eq("status", "converted")),
    safe(head("pages").eq("status", "queued")),
    safe(head("pages").eq("status", "saved")),
    safe(head("pages").eq("status", "discarded")),
    safe(head("landing_pages")),
    safe(head("landing_pages").gt("ad_records_latest", 0)),
  ]);

  return {
    companies,
    companiesActive,
    companiesMapped,
    adsActive,
    hooksNew,
    hooksConverted,
    pagesQueued,
    pagesSaved,
    pagesDiscarded,
    landingPages,
    landingLive,
  };
}

export const GET = withConfig([requires.supabase], getHandler);
