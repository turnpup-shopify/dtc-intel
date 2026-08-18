import { NextResponse } from "next/server";
import { resolveSupabaseVar } from "./env";
import { migrationFor } from "./schema";

/**
 * Configuration preflight.
 *
 * Without this, a missing env var throws deep inside a route, Next returns a
 * 500 with an empty body, and the UI hangs on "Loading…" forever with nothing
 * to diagnose from. Every route declares what it needs and gets back an
 * actionable message instead.
 */
export const requires = {
  supabase(): string[] {
    const missing: string[] = [];
    for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
      const { value, candidates } = resolveSupabaseVar(name);
      if (value) continue;
      missing.push(
        candidates.length > 1
          ? `${name} (ambiguous: ${candidates.join(" / ")} — set ${name} explicitly)`
          : name
      );
    }
    return missing;
  },
  anthropic(): string[] {
    return process.env.ANTHROPIC_API_KEY ? [] : ["ANTHROPIC_API_KEY"];
  },
  meta(): string[] {
    if (process.env.META_ACCESS_TOKEN?.trim()) return [];
    // An app id + secret forms a valid app access token, so either shape counts
    // as configured. Whether Meta honours it is answered at call time.
    if (process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim()) return [];
    return ["META_ACCESS_TOKEN (or META_APP_ID + META_APP_SECRET)"];
  },
  scraper(): string[] {
    const provider = (process.env.SCRAPER_PROVIDER || "fetch").toLowerCase();
    if (provider === "fetch") return [];
    return process.env.SCRAPER_API_KEY ? [] : ["SCRAPER_API_KEY"];
  },
};

type Check = () => string[];

/**
 * Wraps a route handler so it always answers with JSON: a 503 naming the
 * missing environment variables, or a 500 carrying the actual error message.
 */
export function withConfig<A extends unknown[]>(
  checks: Check[],
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const missing = Array.from(new Set(checks.flatMap((check) => check())));

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Not configured — ${missing.join(", ")} ${
            missing.length === 1 ? "is" : "are"
          } not set. Copy .env.example to .env.local (or add the variables in your Vercel project settings) and restart.`,
          code: "missing_env",
          missing,
        },
        { status: 503 }
      );
    }

    try {
      return await handler(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api]", message);

      // The most common first-run failure after env vars: schema never applied.
      const notMigrated =
        /relation .* does not exist|could not find the (table|function)/i.test(message);

      return NextResponse.json(
        {
          error: notMigrated
            ? `${message} — run supabase/migrations/${
                migrationFor(message) ?? "0001_init.sql"
              } in the Supabase SQL editor. Diagnostics lists every migration still outstanding.`
            : message,
          code: notMigrated ? "not_migrated" : "server_error",
        },
        { status: 500 }
      );
    }
  };
}
