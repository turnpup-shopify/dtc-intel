import { NextResponse } from "next/server";
import { requires } from "@/lib/api";
import { resolveSupabaseVar } from "@/lib/env";
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

  // Name the variable that actually won, so an integration-prefixed value or a
  // duplicate is visible rather than mysterious.
  const urlVar = resolveSupabaseVar("SUPABASE_URL");
  const keyVar = resolveSupabaseVar("SUPABASE_SERVICE_ROLE_KEY");
  const duplicates = [...urlVar.candidates, ...keyVar.candidates].filter(
    (name) => name !== urlVar.source && name !== keyVar.source
  );

  const checks: Record<string, unknown> = {
    env: {
      supabase: missing.supabase.length === 0 ? "ok" : `missing ${missing.supabase.join(", ")}`,
      supabaseUrlFrom: urlVar.source ?? "(unset)",
      supabaseKeyFrom: keyVar.source ?? "(unset)",
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

  if (duplicates.length > 0) {
    checks.warning =
      `Unused duplicate Supabase variable(s) present: ${duplicates.join(", ")}. ` +
      `The app is using ${[urlVar.source, keyVar.source].filter(Boolean).join(" and ")}. ` +
      `Delete the duplicates — if one is rotated and the other isn't, the app will read a ` +
      `stale key and silently see an empty database.`;
  }

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
      checks.database = notMigrated
        ? "reachable, schema NOT applied"
        : `error: ${describe(error)}`;
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
    checks.database = `unreachable: ${describe(err)}`;
    checks.nextStep = "Verify SUPABASE_URL points at your project and the network allows egress.";
    return NextResponse.json({ ok: false, ...checks }, { status: 503 });
  }
}

/**
 * Supabase errors sometimes carry an empty `message` (a DNS failure behind
 * fetch, for instance). An empty string is the least useful thing we could
 * print, so fall back through the other fields before giving up.
 */
function describe(err: unknown): string {
  if (!err) return "unknown error";
  if (typeof err === "string") return err || "unknown error";

  const e = err as { message?: string; details?: string; hint?: string; code?: string; cause?: unknown };
  const parts = [e.message, e.details, e.hint, e.code && `code ${e.code}`].filter(
    (p): p is string => Boolean(p && p.trim())
  );
  if (parts.length > 0) return parts.join(" — ");

  const cause = e.cause as { message?: string; code?: string } | undefined;
  if (cause?.message || cause?.code) {
    return [cause.message, cause.code].filter(Boolean).join(" ") + " (from underlying fetch)";
  }
  return "empty error from Supabase — usually a bad SUPABASE_URL host that fails DNS";
}
