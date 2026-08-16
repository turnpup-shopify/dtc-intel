import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * POST /api/pages/:id/review { status, stars, tags[], notes }
 * Review state lives on `pages` and survives recaptures.
 */
async function postHandler(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    stars?: number;
    tags?: string[];
    notes?: string | null;
  };

  const update: Record<string, unknown> = { reviewed_at: new Date().toISOString() };

  if (body.status !== undefined) {
    if (!["queued", "saved", "discarded"].includes(body.status)) {
      return NextResponse.json({ error: `invalid status: ${body.status}` }, { status: 400 });
    }
    update.status = body.status;
  }

  if (body.stars !== undefined) {
    const stars = Math.round(Number(body.stars));
    if (!Number.isFinite(stars) || stars < 0 || stars > 3) {
      return NextResponse.json({ error: "stars must be 0-3" }, { status: 400 });
    }
    update.stars = stars;
  }

  if (body.notes !== undefined) update.notes = body.notes;

  const { error } = await db().from("pages").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body.tags) {
    const result = await syncTags(id, body.tags);
    if (result) return NextResponse.json({ error: result }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, ...update });
}

/** Replaces the page's tag set. Creates any label that doesn't exist yet. */
async function syncTags(pageId: string, labels: string[]): Promise<string | null> {
  const clean = Array.from(
    new Set(
      labels
        .map((l) =>
          l
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
        )
        .filter(Boolean)
    )
  );

  const { error: delError } = await db().from("page_tags").delete().eq("page_id", pageId);
  if (delError) return delError.message;
  if (clean.length === 0) return null;

  const { error: upsertError } = await db()
    .from("tags")
    .upsert(
      clean.map((label) => ({ label, kind: "user" })),
      { onConflict: "label", ignoreDuplicates: true }
    );
  if (upsertError) return upsertError.message;

  const { data: tagRows, error: selError } = await db()
    .from("tags")
    .select("id, label")
    .in("label", clean);
  if (selError) return selError.message;

  const { error: linkError } = await db()
    .from("page_tags")
    .upsert(
      (tagRows ?? []).map((t) => ({ page_id: pageId, tag_id: t.id })),
      { onConflict: "page_id,tag_id", ignoreDuplicates: true }
    );

  return linkError?.message ?? null;
}

export const POST = withConfig([requires.supabase], postHandler);
