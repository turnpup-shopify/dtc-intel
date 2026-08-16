import { NextResponse } from "next/server";
import { db, signedScreenshotUrl } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ReviewItem {
  id: string;
  url: string;
  title: string | null;
  companyName: string | null;
  stars: number;
  discoveredAt: string;
  source: string | null;
  versionId: string | null;
  scores: Record<string, number> | null;
  compositeScore: number | null;
  whyGood: string | null;
  screenshotUrl: string | null;
  tags: string[];
  blocks: { id: string; block_type: string; content: string; position: number }[];
}

/**
 * GET /api/queue — pages where status='queued', oldest first, with everything
 * the review screen needs in one round trip.
 */
export async function GET(request: Request) {
  // A session's worth, not the whole backlog. Kept small on purpose: the blocks
  // query below fans out per page, and a large batch would brush against
  // PostgREST's row cap and silently drop the last page's copy.
  const limit = Math.min(
    Number(new URL(request.url).searchParams.get("limit")) || 15,
    50
  );

  const { data: pages, error } = await db()
    .from("pages")
    .select("id, url, title, stars, discovered_at, source, company_id, companies(name)")
    .eq("status", "queued")
    .order("discovered_at", { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pages?.length) return NextResponse.json({ items: [], pending: 0 });

  const pageIds = pages.map((p) => p.id as string);

  const [{ data: versions }, { data: blocks }, { data: pageTags }, { count }] =
    await Promise.all([
      db()
        .from("page_versions")
        .select("id, page_id, scores, composite_score, why_good, screenshot_path")
        .in("page_id", pageIds)
        .eq("is_current", true),
      db()
        .from("copy_blocks")
        .select("id, page_id, page_version_id, block_type, content, position")
        .in("page_id", pageIds)
        .order("position", { ascending: true })
        .limit(2000),
      db().from("page_tags").select("page_id, tags(label)").in("page_id", pageIds),
      db().from("pages").select("id", { count: "exact", head: true }).eq("status", "queued"),
    ]);

  const versionByPage = new Map((versions ?? []).map((v) => [v.page_id as string, v]));

  const items: ReviewItem[] = await Promise.all(
    pages.map(async (page) => {
      const version = versionByPage.get(page.id as string);
      const company = page.companies as { name?: string } | { name?: string }[] | null;
      const companyName = Array.isArray(company) ? company[0]?.name ?? null : company?.name ?? null;

      return {
        id: page.id as string,
        url: page.url as string,
        title: (page.title as string | null) ?? null,
        companyName,
        stars: (page.stars as number) ?? 0,
        discoveredAt: page.discovered_at as string,
        source: (page.source as string | null) ?? null,
        versionId: (version?.id as string) ?? null,
        scores: (version?.scores as Record<string, number> | null) ?? null,
        compositeScore: version?.composite_score != null ? Number(version.composite_score) : null,
        whyGood: (version?.why_good as string | null) ?? null,
        screenshotUrl: await signedScreenshotUrl(version?.screenshot_path as string | null),
        tags: (pageTags ?? [])
          .filter((pt) => pt.page_id === page.id)
          .map((pt) => {
            const t = pt.tags as { label?: string } | { label?: string }[] | null;
            return Array.isArray(t) ? t[0]?.label : t?.label;
          })
          .filter((l): l is string => Boolean(l)),
        blocks: (blocks ?? [])
          .filter((b) => b.page_id === page.id && b.page_version_id === version?.id)
          .map((b) => ({
            id: b.id as string,
            block_type: b.block_type as string,
            content: b.content as string,
            position: (b.position as number) ?? 0,
          })),
      };
    })
  );

  return NextResponse.json({ items, pending: count ?? items.length });
}
