import { env } from "./env";
import { db } from "./supabase";

/**
 * Settings that can change without a redeploy.
 *
 * Precedence: database override, then environment variable, then code default.
 * In that order for a reason — the env var is the thing people set once and
 * forget, and it silently outranked a later change to the code default. Putting
 * the database first gives you somewhere to change your mind that beats it.
 *
 * Every read tolerates a missing table, because migrations here are applied by
 * hand and the app routinely runs ahead of the schema. A missing app_settings
 * means "no overrides", not an error.
 */

export const SCORE_THRESHOLD_KEY = "score_threshold";

export interface ThresholdSetting {
  value: number;
  source: "database" | "environment" | "default";
  /** True when the table isn't there yet, so the UI can say so rather than fail. */
  storageAvailable: boolean;
}

export async function getScoreThreshold(): Promise<ThresholdSetting> {
  const fromEnv = process.env.SCORE_THRESHOLD?.trim();
  const envOrDefault: ThresholdSetting = fromEnv
    ? { value: env.scoreThreshold, source: "environment", storageAvailable: true }
    : { value: env.scoreThreshold, source: "default", storageAvailable: true };

  try {
    const { data, error } = await db()
      .from("app_settings")
      .select("value")
      .eq("key", SCORE_THRESHOLD_KEY)
      .maybeSingle();

    if (error) {
      const missing = /relation .* does not exist|could not find the table/i.test(error.message);
      return { ...envOrDefault, storageAvailable: !missing };
    }

    const parsed = data?.value != null ? Number(data.value) : NaN;
    if (Number.isFinite(parsed)) {
      return { value: parsed, source: "database", storageAvailable: true };
    }
    return envOrDefault;
  } catch {
    return { ...envOrDefault, storageAvailable: false };
  }
}

/** Returns the stored value, or throws with a reason the UI can show. */
export async function setScoreThreshold(value: number): Promise<number> {
  if (!Number.isFinite(value) || value < 1 || value > 5) {
    throw new Error("Threshold must be between 1 and 5 — the composite is a 1-5 weighted mean.");
  }

  const rounded = Math.round(value * 100) / 100;
  const { error } = await db()
    .from("app_settings")
    .upsert(
      { key: SCORE_THRESHOLD_KEY, value: String(rounded), updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

  if (error) {
    const missing = /relation .* does not exist|could not find the table/i.test(error.message);
    throw new Error(
      missing
        ? "No app_settings table yet — run migration 0014_app_settings.sql, then try again."
        : error.message
    );
  }

  return rounded;
}

/**
 * Remove the override, handing control back to the env var or the default.
 *
 * Without this, the first save would be permanent — a stored row outranks both
 * fallbacks forever, so a later change to either could never take effect.
 */
export async function clearScoreThreshold(): Promise<void> {
  const { error } = await db().from("app_settings").delete().eq("key", SCORE_THRESHOLD_KEY);
  if (error && !/relation .* does not exist|could not find the table/i.test(error.message)) {
    throw new Error(error.message);
  }
}
