import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/companies — the admin table's data source. */
export async function GET() {
  const { data, error } = await db()
    .from("companies")
    .select("id, name, domain, meta_page_id, tier, category, active, added_at")
    .order("tier", { ascending: true })
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ companies: data ?? [] });
}

/** POST /api/companies { name, domain, tier, category, meta_page_id } — add a brand. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data, error } = await db()
    .from("companies")
    .insert({
      name: body.name,
      domain: (body.domain as string) || null,
      meta_page_id: (body.meta_page_id as string) || null,
      tier: (body.tier as string) || null,
      category: (body.category as string) || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ company: data });
}
