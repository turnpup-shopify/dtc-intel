import { env } from "./env";
import { compositeScore, extractAndScore } from "./extract";
import { scraper } from "./scrape";
import { SCREENSHOT_BUCKET, db } from "./supabase";
import { reduceHtml } from "./text";
import { hostOf, normalizeUrl } from "./url";

export type PageSource = "ad_hook" | "sitemap" | "manual";

export interface PipelineResult {
  ok: boolean;
  url: string;
  urlNormalized: string;
  pageId?: string;
  versionId?: string;
  status?: "queued" | "discarded";
  composite?: number;
  unchanged?: boolean;
  error?: string;
}

/**
 * Extraction pipeline (spec §5 of the build plan, §6 of the spec):
 *   fetch + screenshot -> reduce to text -> hash -> extract+score -> gate -> write
 *
 * Writes go through the `ingest_page_version` RPC so page/version/blocks/tags
 * land in a single transaction.
 */
export async function processUrl(
  rawUrl: string,
  opts: { source: PageSource; sourceRef?: string | null; companyId?: string | null } = {
    source: "manual",
  }
): Promise<PipelineResult> {
  let urlNormalized = "";

  try {
    // Normalize the input once so a bad paste fails before we spend a scrape.
    urlNormalized = normalizeUrl(rawUrl);

    const scraped = await scraper().fetch(urlNormalized);
    // Redirects are resolved by the adapter; the FINAL url is the identity.
    const finalUrl = scraped.finalUrl || urlNormalized;
    urlNormalized = normalizeUrl(finalUrl);

    if (scraped.statusCode >= 400) {
      return { ok: false, url: finalUrl, urlNormalized, error: `HTTP ${scraped.statusCode}` };
    }

    const reduced = reduceHtml(scraped.html);
    if (reduced.text.length < 200) {
      return {
        ok: false,
        url: finalUrl,
        urlNormalized,
        error: "Page yielded almost no text — likely a bot wall or a client-render failure",
      };
    }

    const companyId = opts.companyId ?? (await resolveCompanyId(urlNormalized));

    // Unchanged since the last capture? Stop before paying for the model call.
    const existing = await currentVersionFor(urlNormalized);
    if (existing && existing.content_hash === reduced.contentHash) {
      return {
        ok: true,
        url: finalUrl,
        urlNormalized,
        pageId: existing.page_id,
        versionId: existing.id,
        unchanged: true,
      };
    }

    const extraction = await extractAndScore({
      url: finalUrl,
      title: reduced.title,
      text: reduced.text,
    });
    const composite = compositeScore(extraction.scores);

    // The gate: below threshold never enters the review queue.
    const status: "queued" | "discarded" =
      composite < env.scoreThreshold ? "discarded" : "queued";

    const screenshotPath = await uploadScreenshot({
      buffer: scraped.screenshotBuffer,
      urlNormalized,
      contentHash: reduced.contentHash,
    });

    const { data, error } = await db().rpc("ingest_page_version", {
      p_url: finalUrl,
      p_url_normalized: urlNormalized,
      p_title: reduced.title,
      p_source: opts.source,
      p_source_ref: opts.sourceRef ?? null,
      p_company_id: companyId,
      p_content_hash: reduced.contentHash,
      p_raw_text: reduced.text,
      p_screenshot_path: screenshotPath,
      p_scores: extraction.scores,
      p_composite: composite,
      p_why_good: extraction.why_good,
      p_status: status,
      p_blocks: extraction.blocks,
      p_tags: extraction.tags,
    });

    if (error) throw new Error(`ingest_page_version failed: ${error.message}`);

    const result = data as { page_id: string; version_id: string; unchanged: boolean };

    return {
      ok: true,
      url: finalUrl,
      urlNormalized,
      pageId: result.page_id,
      versionId: result.version_id,
      unchanged: result.unchanged,
      status,
      composite,
    };
  } catch (err) {
    return {
      ok: false,
      url: rawUrl,
      urlNormalized,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function currentVersionFor(urlNormalized: string) {
  const { data: page } = await db()
    .from("pages")
    .select("id")
    .eq("url_normalized", urlNormalized)
    .maybeSingle();
  if (!page) return null;

  const { data: version } = await db()
    .from("page_versions")
    .select("id, page_id, content_hash")
    .eq("page_id", page.id)
    .eq("is_current", true)
    .maybeSingle();

  return version ?? null;
}

/** Match a page to a seeded company by domain. Null is fine — pages can be orphans. */
async function resolveCompanyId(urlNormalized: string): Promise<string | null> {
  const host = hostOf(urlNormalized);
  if (!host) return null;

  const { data } = await db().from("companies").select("id, domain").not("domain", "is", null);
  if (!data) return null;

  const match = data.find((c) => {
    const domain = (c.domain as string).toLowerCase().replace(/^www\./, "");
    return host === domain || host.endsWith(`.${domain}`);
  });

  return match?.id ?? null;
}

/**
 * screenshots/{domain}/{hash-prefix}.webp in a private bucket, read via signed
 * URLs. Storage failures never fail the capture — the copy is the asset.
 */
async function uploadScreenshot(args: {
  buffer: Buffer;
  urlNormalized: string;
  contentHash: string;
}): Promise<string | null> {
  if (!args.buffer || args.buffer.length === 0) return null;

  const domain = hostOf(args.urlNormalized) ?? "unknown";
  const path = `screenshots/${domain}/${args.contentHash.slice(0, 16)}.webp`;

  const { error } = await db()
    .storage.from(SCREENSHOT_BUCKET)
    .upload(path, args.buffer, { contentType: "image/webp", upsert: true });

  if (error) {
    console.error(`[pipeline] screenshot upload failed for ${args.urlNormalized}:`, error.message);
    return null;
  }
  return path;
}

/**
 * Batched processing for cron routes. Cap the batch and queue the remainder
 * rather than looping 50 pages in one invocation (spec §11).
 */
export async function processBatch(
  urls: { url: string; source: PageSource; sourceRef?: string | null }[],
  limit: number
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];
  for (const item of urls.slice(0, limit)) {
    results.push(await processUrl(item.url, { source: item.source, sourceRef: item.sourceRef }));
  }
  return results;
}
