import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { pollAdLibrary } from "@/lib/poll";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/poll — run the Ad Library poll on demand.
 *
 * Same work as the daily cron, triggered from the "Poll now" button on /hooks
 * so the first run doesn't mean waiting until 13:00 UTC or hand-rolling a curl
 * with the cron secret. Guarded by the app's own session gate (middleware),
 * not CRON_SECRET, because a browser doesn't have that.
 */
async function postHandler() {
  const result = await pollAdLibrary();
  return NextResponse.json(result);
}

export const POST = withConfig([requires.supabase, requires.meta], postHandler);
