import { NextResponse } from "next/server";
import { processUrl } from "@/lib/pipeline";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/hooks/:id { status, resulting_url? }
 *
 * Paste-back is the whole point of the hooks queue: the human clicks the ad
 * snapshot, lands on the LP, pastes the URL here. That marks the hook
 * `converted` and pushes the page through the pipeline.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    resulting_url?: string;
  };

  const { data: hook, error: hookError } = await db()
    .from("ad_hooks")
    .select("id, company_id")
    .eq("id", id)
    .maybeSingle();

  if (hookError) return NextResponse.json({ error: hookError.message }, { status: 500 });
  if (!hook) return NextResponse.json({ error: "hook not found" }, { status: 404 });

  if (body.resulting_url) {
    const result = await processUrl(body.resulting_url, {
      source: "ad_hook",
      sourceRef: id,
      companyId: (hook.company_id as string) ?? null,
    });

    if (!result.ok) return NextResponse.json(result, { status: 422 });

    const { error } = await db()
      .from("ad_hooks")
      .update({ status: "converted", resulting_page_id: result.pageId ?? null })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: "converted", page: result });
  }

  const status = body.status ?? "dismissed";
  if (!["new", "clicked", "dismissed", "converted"].includes(status)) {
    return NextResponse.json({ error: `invalid status: ${status}` }, { status: 400 });
  }

  const { error } = await db().from("ad_hooks").update({ status }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status });
}
