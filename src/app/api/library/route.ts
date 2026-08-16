import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/library?company=&tag=&block_type=
 * Saved pages, default sort stars desc then composite_score desc.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const company = params.get("company");
  const tag = params.get("tag");
  const blockType = params.get("block_type");

  let query = db()
    .from("pages")
    .select("id, url, title, stars, notes, reviewed_at, company_id, companies(name)")
    .eq("status", "saved")
    .order("stars", { ascending: false })
    .limit(200);

  if (company) query = query.eq("company_id", company);

  const { data: pages, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pages?.length) return NextResponse.json({ pages: [], tags: [] });

  let pageIds = pages.map((p) => p.id as string);

  const [{ data: versions }, { data: pageTags }, { data: allTags }] = await Promise.all([
    db()
      .from("page_versions")
      .select("page_id, composite_score, why_good, captured_at")
      .in("page_id", pageIds)
      .eq("is_current", true),
    db().from("page_tags").select("page_id, tags(label)").in("page_id", pageIds),
    db().from("tags").select("label").order("label"),
  ]);

  const tagsByPage = new Map<string, string[]>();
  for (const pt of pageTags ?? []) {
    const t = pt.tags as { label?: string } | { label?: string }[] | null;
    const label = Array.isArray(t) ? t[0]?.label : t?.label;
    if (!label) continue;
    const key = pt.page_id as string;
    tagsByPage.set(key, [...(tagsByPage.get(key) ?? []), label]);
  }

  if (tag) {
    pageIds = pageIds.filter((id) => (tagsByPage.get(id) ?? []).includes(tag));
  }

  // Filtering by block type means "pages that contain a block of this type".
  let blockTypePageIds: Set<string> | null = null;
  if (blockType) {
    const { data: blocks } = await db()
      .from("copy_blocks")
      .select("page_id")
      .eq("block_type", blockType)
      .in("page_id", pageIds);
    blockTypePageIds = new Set((blocks ?? []).map((b) => b.page_id as string));
  }

  const versionByPage = new Map((versions ?? []).map((v) => [v.page_id as string, v]));

  const result = pages
    .filter((p) => pageIds.includes(p.id as string))
    .filter((p) => !blockTypePageIds || blockTypePageIds.has(p.id as string))
    .map((p) => {
      const version = versionByPage.get(p.id as string);
      const c = p.companies as { name?: string } | { name?: string }[] | null;
      return {
        id: p.id as string,
        url: p.url as string,
        title: (p.title as string | null) ?? null,
        companyName: Array.isArray(c) ? c[0]?.name ?? null : c?.name ?? null,
        stars: (p.stars as number) ?? 0,
        notes: (p.notes as string | null) ?? null,
        reviewedAt: (p.reviewed_at as string | null) ?? null,
        compositeScore:
          version?.composite_score != null ? Number(version.composite_score) : null,
        whyGood: (version?.why_good as string | null) ?? null,
        capturedAt: (version?.captured_at as string | null) ?? null,
        tags: tagsByPage.get(p.id as string) ?? [],
      };
    })
    .sort((a, b) => b.stars - a.stars || (b.compositeScore ?? 0) - (a.compositeScore ?? 0));

  return NextResponse.json({
    pages: result,
    tags: (allTags ?? []).map((t) => t.label as string),
  });
}
