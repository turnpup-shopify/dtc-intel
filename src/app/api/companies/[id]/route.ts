import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { CATEGORIES, isCategory } from "@/lib/categories";
import { db } from "@/lib/supabase";
import { extractMetaPageId } from "@/lib/url";

export const runtime = "nodejs";

/**
 * POST /api/companies/:id { meta_page_id, ... }
 *
 * Pasting a page_id is the only manual data entry in the system — page_ids come
 * from the Ad Library UI's `view_all_page_id` parameter and there is no
 * automated resolver (spec §1.5). Keep this fast.
 */
async function postHandler(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if ("meta_page_id" in body) {
    const raw = String(body.meta_page_id ?? "").trim();
    // Accept a bare id or a pasted Ad Library URL; store the id either way.
    const pageId = raw ? extractMetaPageId(raw) : null;
    if (raw && !pageId) {
      return NextResponse.json(
        {
          error:
            "Couldn't find a page_id in that. Paste the Ad Library URL for this brand " +
            "(the one containing view_all_page_id=…) or just the numeric id.",
        },
        { status: 400 }
      );
    }
    update.meta_page_id = pageId;
  }
  if ("domain" in body) update.domain = String(body.domain ?? "").trim() || null;
  if ("tier" in body) update.tier = String(body.tier ?? "").trim() || null;
  if ("category" in body) {
    const category = String(body.category ?? "").trim();
    if (category && !isCategory(category)) {
      return NextResponse.json(
        { error: `category must be one of: ${CATEGORIES.join(", ")}` },
        { status: 400 }
      );
    }
    update.category = category || null;
  }
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

/**
 * DELETE /api/companies/:id — remove a brand and everything derived from it.
 *
 * A real delete, because a company is the one row here that isn't rebuilt from
 * anything. ads, ad_hooks and landing_pages cascade away with it; captured
 * pages do NOT — pages.company_id is ON DELETE SET NULL, so archived copy
 * survives and only loses its brand label. The response reports what went so
 * the UI can say it rather than the person discovering it later.
 */
async function deleteHandler(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const [{ count: hooks }, { count: pages }, { count: landing }] = await Promise.all([
    db().from("ad_hooks").select("id", { count: "exact", head: true }).eq("company_id", id),
    db().from("pages").select("id", { count: "exact", head: true }).eq("company_id", id),
    db().from("landing_pages").select("id", { count: "exact", head: true }).eq("company_id", id),
  ]);

  const { error } = await db().from("companies").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    deleted: { hooks: hooks ?? 0, landingPages: landing ?? 0 },
    orphanedPages: pages ?? 0,
  });
}

export const POST = withConfig([requires.supabase], postHandler);
export const DELETE = withConfig([requires.supabase], deleteHandler);
