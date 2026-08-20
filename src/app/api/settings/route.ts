import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { clearScoreThreshold, getScoreThreshold, setScoreThreshold } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/settings — the effective threshold and where it came from. */
async function getHandler() {
  return NextResponse.json({ scoreThreshold: await getScoreThreshold() });
}

/**
 * POST /api/settings { scoreThreshold } — store an override.
 *
 * Send null to clear it, which hands control back to the environment variable
 * or the code default. Without a way to clear, the first save would be
 * permanent: any later change to either fallback could never take effect again.
 */
async function postHandler(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (!("scoreThreshold" in body)) {
    return NextResponse.json({ error: "scoreThreshold is required" }, { status: 400 });
  }

  if (body.scoreThreshold === null) {
    await clearScoreThreshold();
    return NextResponse.json({ scoreThreshold: await getScoreThreshold() });
  }

  const value = Number(body.scoreThreshold);
  if (!Number.isFinite(value)) {
    return NextResponse.json({ error: "scoreThreshold must be a number" }, { status: 400 });
  }

  try {
    await setScoreThreshold(value);
  } catch (err) {
    // A rejected value or a missing table is the caller's problem to fix, and
    // both carry a message worth showing — a 500 would bury it as "server error".
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  return NextResponse.json({ scoreThreshold: await getScoreThreshold() });
}

export const GET = withConfig([requires.supabase], getHandler);
export const POST = withConfig([requires.supabase], postHandler);
