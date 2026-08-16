import { NextResponse } from "next/server";
import { requires } from "@/lib/api";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — one call that answers "why is nothing loading?"
 *
 * Reports which env vars are missing, whether the database is reachable,
 * whether the schema has been applied, and whether any brands are seeded.
 */
export async function GET() {
  const missing = {
    supabase: requires.supabase(),
    anthropic: requires.anthropic(),
    meta: requires.meta(),
    scraper: requires.scraper(),
  };

  const checks: Record<string, unknown> = {
    env: {
      supabase: missing.supabase.length === 0 ? "ok" : `missing ${missing.supabase.join(", ")}`,
      anthropic:
        missing.anthropic.length === 0 ? "ok" : `missing ${missing.anthropic.join(", ")}`,
      meta: missing.meta.length === 0 ? "ok" : `missing ${missing.meta.join(", ")}`,
      scraper:
        missing.scraper.length === 0
          ? `ok (${process.env.SCRAPER_PROVIDER || "fetch"})`
          : `missing ${missing.scraper.join(", ")}`,
      authGate: process.env.APP_PASSWORD ? "enabled" : "disabled (app is open)",
    },
  };

  if (missing.supabase.length > 0) {
    checks.database = "skipped — Supabase env vars not set";
    checks.nextStep =
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload. Locally: copy .env.example to .env.local and restart `npm run dev`.";
    return NextResponse.json({ ok: false, ...checks }, { status: 503 });
  }

  try {
    const { error, count } = await db()
      .from("companies")
      .select("id", { count: "exact", head: true });

    if (error) {
      const notMigrated = /relation .* does not exist|could not find the table/i.test(
        error.message
      );
      checks.database = notMigrated ? "reachable, schema NOT applied" : `error: ${error.message}`;
      checks.nextStep = notMigrated
        ? "Run supabase/migrations/0001_init.sql against your Supabase project, then `npm run seed`."
        : "Check the Supabase project URL and service-role key.";
      return NextResponse.json({ ok: false, ...checks }, { status: 503 });
    }

    checks.database = "ok";
    checks.companies = count ?? 0;
    if ((count ?? 0) === 0) {
      checks.nextStep = "Schema is applied but no brands are seeded. Run `npm run seed`.";
      return NextResponse.json({ ok: false, ...checks }, { status: 503 });
    }

    const { count: queued } = await db()
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued");
    checks.queuedPages = queued ?? 0;

    return NextResponse.json({ ok: true, ...checks });
  } catch (err) {
    checks.database = `unreachable: ${err instanceof Error ? err.message : String(err)}`;
    checks.nextStep = "Verify SUPABASE_URL points at your project and the network allows egress.";
    return NextResponse.json({ ok: false, ...checks }, { status: 503 });
  }
}
