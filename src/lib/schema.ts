import { db } from "./supabase";

/**
 * Tolerating a database that is behind the code.
 *
 * Migrations here are applied by hand in the Supabase SQL editor, so the
 * deployed app is routinely a few migrations ahead of the schema. When that
 * happens a query naming a not-yet-created column doesn't degrade — PostgREST
 * rejects the whole request and the tab dies with "column x does not exist".
 *
 * A missing column should cost you the feature that needs it, not the screen it
 * sits on. So reads that touch new columns run optimistically and fall back.
 */
export function isMissingColumn(message: string | undefined | null): boolean {
  return /column .* does not exist|could not find the .* column/i.test(message ?? "");
}

/** Column each migration adds, so a missing one can name its own fix. */
const EXPECTED: { table: string; column: string; migration: string; feature: string }[] = [
  { table: "landing_pages", column: "id", migration: "0005_landing_pages.sql", feature: "Landing Pages" },
  { table: "run_log", column: "id", migration: "0006_run_log.sql", feature: "Diagnostics run log" },
  { table: "ad_hooks", column: "creative_path", migration: "0009_ad_creatives.sql", feature: "ad creative thumbnails" },
  { table: "landing_pages", column: "hidden", migration: "0010_hide_landing_pages.sql", feature: "hiding landing pages" },
  { table: "app_settings", column: "key", migration: "0014_app_settings.sql", feature: "changing the score gate in the app" },
];

export interface PendingMigration {
  migration: string;
  feature: string;
  missing: string;
}

/**
 * Which migrations look un-applied, judged by probing for the column each one
 * adds. Cheap (head-only selects) and read-only.
 */
export async function pendingMigrations(): Promise<PendingMigration[]> {
  const checks = EXPECTED.map(async (e) => {
    try {
      const { error } = await db().from(e.table).select(e.column, { count: "exact", head: true }).limit(1);
      if (!error) return null;
      const missing = /relation .* does not exist|could not find the table/i.test(error.message)
        ? `table ${e.table}`
        : isMissingColumn(error.message)
          ? `${e.table}.${e.column}`
          : null;
      return missing ? { migration: e.migration, feature: e.feature, missing } : null;
    } catch {
      return null;
    }
  });

  return (await Promise.all(checks)).filter((x): x is PendingMigration => x !== null);
}

/** Which migration creates each table and function, for error messages. */
const CREATED_BY: Record<string, string> = {
  // 0001_init
  companies: "0001_init.sql",
  pages: "0001_init.sql",
  page_versions: "0001_init.sql",
  copy_blocks: "0001_init.sql",
  tags: "0001_init.sql",
  page_tags: "0001_init.sql",
  ads: "0001_init.sql",
  ad_hooks: "0001_init.sql",
  ingest_page_version: "0001_init.sql",
  rebuild_ad_hooks: "0001_init.sql",
  search_copy_blocks: "0001_init.sql",
  // later
  landing_pages: "0005_landing_pages.sql",
  merge_landing_pages: "0005_landing_pages.sql",
  run_log: "0006_run_log.sql",
  prune_run_log: "0006_run_log.sql",
  app_settings: "0014_app_settings.sql",
};

/**
 * Name the migration a missing relation actually comes from.
 *
 * The old message assumed any missing table meant the schema was never
 * applied, and sent people to 0001 — which is actively misleading once 0001 IS
 * applied and the gap is a later migration. "Run 0001" on a working database
 * reads as "your database is broken" rather than "you are five files behind".
 */
export function migrationFor(message: string): string | null {
  const match = message.match(
    /relation ["']?(?:public\.)?([a-z_]+)["']? does not exist|could not find the (?:table|function) ["']?(?:public\.)?([a-z_]+)/i
  );
  const name = match?.[1] ?? match?.[2];
  return name ? (CREATED_BY[name] ?? null) : null;
}
