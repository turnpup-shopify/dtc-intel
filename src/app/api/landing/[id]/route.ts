import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * DELETE /api/landing/:id — hide a landing page.
 *
 * Not a row delete. landing_pages is rebuilt from the brand's live ads on every
 * scan, so removing the row would last until the next scan and then quietly
 * undo itself. The flag survives the merge; the row keeps updating underneath
 * so un-hiding shows current numbers rather than a stale snapshot.
 */
async function deleteHandler(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await db().from("landing_pages").update({ hidden: true }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, hidden: true });
}

export const DELETE = withConfig([requires.supabase], deleteHandler);
