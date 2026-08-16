import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/**
 * Service-role client. Server-side only — never import this from a component
 * that ships to the browser. Single-tenant app, so every route uses it directly
 * and there is no RLS policy surface to reason about.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export const SCREENSHOT_BUCKET = "screenshots";

/** Signed URL for a private screenshot, or null if the path is missing/expired. */
export async function signedScreenshotUrl(
  path: string | null | undefined,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await db()
    .storage.from(SCREENSHOT_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
