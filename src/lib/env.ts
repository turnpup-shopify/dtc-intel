/** Typed access to server-side env vars, with the spec's defaults. */

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  get supabaseUrl() {
    return process.env.SUPABASE_URL || req("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseServiceKey() {
    return req("SUPABASE_SERVICE_ROLE_KEY");
  },
  get anthropicKey() {
    return req("ANTHROPIC_API_KEY");
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  },
  get metaToken() {
    return req("META_ACCESS_TOKEN");
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
