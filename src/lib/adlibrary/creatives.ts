import { sniffImageType } from "../pipeline";
import { SCREENSHOT_BUCKET, db } from "../supabase";

/**
 * Downloads bound per scan. A brand with eighty hooks would otherwise add eighty
 * sequential fetches to a request that already spends most of its budget
 * scrolling. Whatever is missed is picked up by the next scan, because the
 * query only ever asks for hooks that still have no file.
 */
const MAX_PER_RUN = 25;

/** Creatives live beside page screenshots — same private bucket, own prefix. */
const PREFIX = "hooks";

export interface CreativeSyncResult {
  attempted: number;
  stored: number;
  failed: number;
}

/**
 * Fetch and store the ad creative for hooks that don't have one yet.
 *
 * Runs after the rollup, because the rollup is what decides which ad represents
 * each hook. Downloading before that would mean fetching an image per ad rather
 * than per hook — the same picture, many times over.
 *
 * Every failure here is swallowed. A hook with no picture is still a hook, and
 * a CDN timeout must not cost you the scan that produced it.
 */
export async function syncHookCreatives(companyId: string): Promise<CreativeSyncResult> {
  const { data: pending, error } = await db()
    .from("ad_hooks")
    .select("id, creative_url, creative_ad_id")
    .eq("company_id", companyId)
    .is("creative_path", null)
    .not("creative_url", "is", null)
    .order("last_seen_at", { ascending: false })
    .limit(MAX_PER_RUN);

  if (error) {
    console.error("[creatives] could not list pending hooks:", error.message);
    return { attempted: 0, stored: 0, failed: 0 };
  }

  let stored = 0;
  let failed = 0;

  for (const hook of pending ?? []) {
    const path = await storeOne(
      hook.id as string,
      (hook.creative_ad_id as string | null) ?? (hook.id as string),
      hook.creative_url as string
    );
    if (path) stored++;
    else failed++;
  }

  return { attempted: pending?.length ?? 0, stored, failed };
}

/**
 * Named by Meta's Library ID, not our hook id: the file is then traceable back
 * to one specific ad, and two hooks that share a representative ad share the
 * object rather than storing the same picture twice.
 */
async function storeOne(hookId: string, adId: string, url: string): Promise<string | null> {
  try {
    // The signed token in the URL is already ticking. Short timeout: if the CDN
    // is slow the token is probably stale anyway, and next scan brings a fresh one.
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error("empty response");

    // Trust the bytes, not the content-type header. An expired token returns an
    // error page with a 200 and an image content-type more often than you'd like.
    const { ext, contentType } = sniffImageType(buffer);
    if (ext === "bin") {
      throw new Error(`not an image (${buffer.length} bytes) — token likely expired`);
    }

    const path = `${PREFIX}/${adId}.${ext}`;
    const { error: uploadError } = await db()
      .storage.from(SCREENSHOT_BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    const { error: updateError } = await db()
      .from("ad_hooks")
      .update({ creative_path: path })
      .eq("id", hookId);
    if (updateError) throw new Error(updateError.message);

    return path;
  } catch (err) {
    console.error(
      `[creatives] hook ${hookId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
