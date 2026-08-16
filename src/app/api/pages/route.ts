import { NextResponse } from "next/server";
import { processUrl } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

/** POST /api/pages { url } — enqueue a manual page and run the full pipeline. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    sourceRef?: string;
  };

  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const result = await processUrl(body.url, {
    source: "manual",
    sourceRef: body.sourceRef ?? null,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
