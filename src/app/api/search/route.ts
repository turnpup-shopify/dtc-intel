import { NextResponse } from "next/server";
import { requires, withConfig } from "@/lib/api";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=&block_type=&company=&min_stars=
 *
 * Results are BLOCKS, not pages — when you're writing a hero you want to see
 * thirty heroes. This is the screen that decides whether the product works.
 */
async function getHandler(request: Request) {
  const params = new URL(request.url).searchParams;

  const { data, error } = await db().rpc("search_copy_blocks", {
    p_query: params.get("q") || null,
    p_block_type: params.get("block_type") || null,
    p_company_id: params.get("company") || null,
    p_min_stars: Number(params.get("min_stars")) || 0,
    p_limit: Math.min(Number(params.get("limit")) || 60, 200),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = (data ?? []).map(
    (r: {
      block_id: string;
      page_id: string;
      block_type: string;
      content: string;
      block_position: number;
      company_name: string | null;
      page_url: string;
      page_title: string | null;
      stars: number;
      why_good: string | null;
      composite_score: number | null;
      rank: number;
    }) => ({
      blockId: r.block_id,
      pageId: r.page_id,
      blockType: r.block_type,
      content: r.content,
      position: r.block_position,
      companyName: r.company_name,
      pageUrl: r.page_url,
      pageTitle: r.page_title,
      stars: r.stars,
      whyGood: r.why_good,
      compositeScore: r.composite_score != null ? Number(r.composite_score) : null,
    })
  );

  return NextResponse.json({ results, count: results.length });
}

export const GET = withConfig([requires.supabase], getHandler);
