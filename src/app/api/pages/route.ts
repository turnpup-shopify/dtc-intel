import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { processUrl } from "@/lib/pipeline";
import { classifyCapture } from "@/lib/capture-log";
import { withRunLog } from "@/lib/runlog";

export const runtime = "nodejs";
export const maxDuration = 300;

/** POST /api/pages { url } — enqueue a manual page and run the full pipeline. */
async function postHandler(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    sourceRef?: string;
  };

  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const result = await withRunLog(
    "page_capture",
    { subject: body.url, classify: classifyCapture },
    () => processUrl(body.url as string, { source: "manual", sourceRef: body.sourceRef ?? null })
  );

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}

export const POST = withConfig([requires.supabase, requires.anthropic, requires.scraper], postHandler);
