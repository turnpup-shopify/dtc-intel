/** Typed access to server-side env vars, with the spec's defaults. */

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

/**
 * Resolve a Supabase variable, tolerating the Vercel integration's prefix.
 *
 * The Vercel–Supabase integration provisions its variables prefixed with the
 * project name (`myproject_SUPABASE_SERVICE_ROLE_KEY`). If we only read the
 * bare name, a project wired up through the integration looks unconfigured —
 * and worse, someone who sets the bare name by hand alongside the integration's
 * ends up with two copies that drift apart the first time the key is rotated,
 * which surfaces as an empty database rather than an error.
 *
 * Exact name wins; a single suffix match is accepted; an ambiguous match is
 * refused rather than guessed. `resolveSupabaseVar` reports which name won so
 * /api/health can show it — this should never be invisible.
 */
export function resolveSupabaseVar(name: string): {
  value?: string;
  source?: string;
  /** Every variable that could satisfy this name, exact match included. */
  candidates: string[];
} {
  const suffix = `_${name}`;
  const prefixed = Object.keys(process.env)
    .filter((k) => k !== name && k.endsWith(suffix) && process.env[k])
    .sort();

  // Always enumerate the full candidate set, even when the exact name matches —
  // otherwise a plain variable sitting next to an integration-provisioned twin
  // resolves silently and the duplicate is never reported.
  const candidates = process.env[name] ? [name, ...prefixed] : prefixed;

  if (process.env[name]) {
    return { value: process.env[name], source: name, candidates };
  }
  if (prefixed.length === 1) {
    return { value: process.env[prefixed[0]], source: prefixed[0], candidates };
  }
  // Zero matches, or several that disagree — let the caller report it.
  return { candidates };
}

function reqSupabase(name: string): string {
  const { value, source, candidates } = resolveSupabaseVar(name);
  if (value && source) return value;
  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous Supabase configuration: found ${candidates.join(", ")} but no plain ${name}. ` +
        `Set ${name} explicitly so there is one source of truth.`
    );
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  get supabaseUrl() {
    // Trailing "/rest/v1" is a common paste error — supabase-js appends that
    // itself, so leaving it on doubles the path and every query 404s.
    return reqSupabase("SUPABASE_URL")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/rest\/v1$/, "");
  },
  get supabaseServiceKey() {
    return reqSupabase("SUPABASE_SERVICE_ROLE_KEY").trim();
  },
  get anthropicKey() {
    return req("ANTHROPIC_API_KEY");
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  },
  /**
   * Token for the Ad Library API.
   *
   * Accepts either a token directly, or an app id + secret — Meta's app access
   * token is literally "{app-id}|{app-secret}", so a reports app's credentials
   * can be used without minting anything by hand. Whether Meta ACCEPTS an app
   * token for ads_archive is a separate question from whether we can build one;
   * if it refuses, the harvest surfaces Meta's own error rather than guessing.
   *
   * Returns "" rather than throwing so callers can distinguish "not configured"
   * from "configured and rejected".
   */
  get metaToken() {
    const direct = process.env.META_ACCESS_TOKEN?.trim();
    if (direct) return direct;

    const appId = process.env.META_APP_ID?.trim();
    const appSecret = process.env.META_APP_SECRET?.trim();
    if (appId && appSecret) return `${appId}|${appSecret}`;

    return "";
  },
  /** Which credential the Ad Library call is using, for the health panel. */
  get metaTokenSource() {
    if (process.env.META_ACCESS_TOKEN?.trim()) return "META_ACCESS_TOKEN";
    if (process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim()) {
      return "META_APP_ID + META_APP_SECRET (app token)";
    }
    return "(unset)";
  },
  get scraperProvider() {
    return process.env.SCRAPER_PROVIDER || "fetch";
  },
  get scraperKey() {
    return process.env.SCRAPER_API_KEY || "";
  },
  get cronSecret() {
    return process.env.CRON_SECRET || "";
  },
  get appPassword() {
    return process.env.APP_PASSWORD || "";
  },
  get dailyPageCap() {
    return num("DAILY_PAGE_CAP", 15);
  },
  get scoreThreshold() {
    return num("SCORE_THRESHOLD", 3.4);
  },
};
