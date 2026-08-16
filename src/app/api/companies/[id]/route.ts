import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * POST /api/companies/:id { meta_page_id, ... }
 *
 * Pasting a page_id is the only manual data entry in the system — page_ids come
 * from the Ad Library UI's `view_all_page_id` parameter and there is no
 * automated resolver (spec §1.5). Keep this fast.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if ("meta_page_id" in body) {
    const raw = String(body.meta_page_id ?? "").trim();
    if (raw && !/^\d{5,25}$/.test(raw)) {
      return NextResponse.json(
        { error: "meta_page_id should be the numeric view_all_page_id from the Ad Library URL" },
        { status: 400 }
      );
    }
    update.meta_page_id = raw || null;
  }
  if ("domain" in body) update.domain = String(body.domain ?? "").trim() || null;
  if ("tier" in body) update.tier = String(body.tier ?? "").trim() || null;
  if ("category" in body) update.category = String(body.category ?? "").trim() || null;
  if ("active" in body) update.active = Boolean(body.active);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await db()
    .from("companies")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ company: data });
}
