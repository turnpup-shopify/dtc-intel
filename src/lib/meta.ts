import { env } from "./env";

const GRAPH_VERSION = "v21.0";

/**
 * The Ad Library API returns exactly these fields per ad (spec §1.1). There is
 * no destination URL — `ad_snapshot_url` points at a facebook.com Ad Library
 * page, not the advertiser's landing page. The human clicks through.
 */
export interface AdLibraryAd {
  id: string;
  page_id: string;
  page_name: string;
  ad_creative_link_title?: string;
  ad_creation_time?: string;
  ad_delivery_start_time?: string;
  ad_snapshot_url?: string;
  currency?: string;
}

const FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creative_link_title",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_snapshot_url",
  "currency",
].join(",");

/**
 * Fetch every active US ad for one page_id. Keyword search is unusable for
 * brand discovery (spec §1.3) — page_ids filtering is the only reliable path.
 */
export async function fetchAdsForPage(
  metaPageId: string,
  opts: { maxPages?: number } = {}
): Promise<AdLibraryAd[]> {
  const maxPages = opts.maxPages ?? 10;
  const ads: AdLibraryAd[] = [];

  let url: string | null = buildUrl({
    access_token: env.metaToken,
    ad_type: "ALL",
    ad_reached_countries: JSON.stringify(["US"]),
    ad_active_status: "ACTIVE",
    search_page_ids: JSON.stringify([metaPageId]),
    fields: FIELDS,
    limit: "100",
  });

  for (let i = 0; i < maxPages && url; i++) {
    const res: Response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const json = (await res.json()) as {
      data?: AdLibraryAd[];
      paging?: { next?: string };
      error?: { message?: string; code?: number };
    };

    if (!res.ok || json.error) {
      throw new Error(
        `Ad Library request failed for page_id ${metaPageId}: ${
          json.error?.message ?? `HTTP ${res.status}`
        }`
      );
    }

    ads.push(...(json.data ?? []));
    url = json.paging?.next ?? null;
  }

  return ads;
}

/**
 * How many active US ads this page is running, straight from the API.
 *
 * This exists to check the web harvester's work. Scraping the "~N results"
 * string off the page was always the weak link: it is UI text, it moves, and
 * when it moves the harvester loses its only way to know it came up short —
 * which is the exact failure it is supposed to catch.
 *
 * Asks for `id` only. We want the count, not the payload.
 *
 * Returns null when no token is configured, so the caller can fall back to the
 * scraped figure rather than treating "no token" as "no ads".
 */
export async function fetchActiveAdCount(
  metaPageId: string
): Promise<{ count: number; capped: boolean } | null> {
  if (!env.metaToken) return null;

  const MAX_PAGES = 10;
  const PER_PAGE = 100;
  let count = 0;

  let url: string | null = buildUrl({
    access_token: env.metaToken,
    ad_type: "ALL",
    ad_reached_countries: JSON.stringify(["US"]),
    ad_active_status: "ACTIVE",
    search_page_ids: JSON.stringify([metaPageId]),
    fields: "id",
    limit: String(PER_PAGE),
  });

  let pagesRead = 0;
  for (; pagesRead < MAX_PAGES && url; pagesRead++) {
    const res: Response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const json = (await res.json()) as {
      data?: { id: string }[];
      paging?: { next?: string };
      error?: { message?: string };
    };

    if (!res.ok || json.error) {
      throw new Error(
        `Ad count request failed for page_id ${metaPageId}: ${
          json.error?.message ?? `HTTP ${res.status}`
        }`
      );
    }

    count += json.data?.length ?? 0;
    url = json.paging?.next ?? null;
  }

  // Hit the page ceiling with more to read: the true total is higher than this,
  // so it must not be used as a target the harvest is measured against.
  return { count, capped: Boolean(url) };
}

function buildUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params);
  return `https://graph.facebook.com/${GRAPH_VERSION}/ads_archive?${qs}`;
}
