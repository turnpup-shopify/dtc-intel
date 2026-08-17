import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { cronRequestIsAuthorized } from "@/lib/auth";
import { pollAdLibrary } from "@/lib/poll";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Scheduled Ad Library poll. The work lives in lib/poll so this and the manual
 * "Poll now" button on /hooks can't drift apart.
 */
async function postHandler(request: Request) {
  if (!cronRequestIsAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await pollAdLibrary("cron");
  return NextResponse.json(result);
}

export const POST = withConfig([requires.supabase, requires.meta], postHandler);
// Vercel Cron issues GET by default; accept both.
export const GET = POST;
