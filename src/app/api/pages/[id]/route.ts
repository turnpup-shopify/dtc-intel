import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * DELETE /api/pages/:id — remove a page from the Library.
 *
 * Marks it discarded rather than dropping the row. The captured copy, its
 * scores and its version history took a scrape and an LLM pass to produce, and
 * this control sits one stray click away from a row you meant to keep. Setting
 * the status takes it out of Library and out of Search — which is what
 * "delete" means from the screen you are looking at — while leaving the work
 * recoverable with a single status change.
 */
async function deleteHandler(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await db()
    .from("pages")
    .update({ status: "discarded", reviewed_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status: "discarded" });
}

export const DELETE = withConfig([requires.supabase], deleteHandler);
