/**
 * URL normalization (spec §6.2). Applied before any insert or dedup check.
 *
 * 1. Follow redirects; normalize the FINAL url (the caller passes finalUrl).
 * 2. Lowercase host, strip leading `www.`
 * 3. Drop all query params (allowlist below only)
 * 4. Drop fragment
 * 5. Strip trailing slash
 */

/**
 * Params that demonstrably change page content. Deliberately tiny — the spec
 * says allowlist, don't blocklist. Add entries only with evidence.
 */
const PARAM_ALLOWLIST = new Set(["variant", "product", "p"]);

export function normalizeUrl(input: string): string {
  const url = new URL(input.trim());

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";

  const kept: [string, string][] = [];
  url.searchParams.forEach((value, key) => {
    if (PARAM_ALLOWLIST.has(key.toLowerCase())) kept.push([key.toLowerCase(), value]);
  });
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);

  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path;

  // Default ports add nothing.
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  return url.toString();
}

/** Best-effort — returns null instead of throwing on malformed input. */
export function tryNormalizeUrl(input: string): string | null {
  try {
    return normalizeUrl(input);
  } catch {
    return null;
  }
}

/**
 * Pull a Meta page_id out of whatever the human pasted.
 *
 * The workflow is: search the Ad Library, click the advertiser, copy the URL.
 * So the clipboard holds a full URL carrying `view_all_page_id=…`, not a bare
 * number — accept both rather than making them hand-extract the digits.
 *
 * Returns null when there's nothing id-shaped, so callers can reject clearly.
 */
export function extractMetaPageId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  if (/^\d{5,25}$/.test(raw)) return raw;

  // ...&view_all_page_id=101942308432014&...  (also matches a bare fragment)
  const viewAll = raw.match(/view_all_page_id[=/](\d{5,25})/i);
  if (viewAll) return viewAll[1];

  // The Ad Library also uses `page_ids[0]=…` on some shared links.
  const pageIds = raw.match(/page_ids(?:%5B\d+%5D|\[\d+\])?=(\d{5,25})/i);
  if (pageIds) return pageIds[1];

  return null;
}

/** Pre-filled Ad Library search for a brand — the first step of finding a page_id. */
export function adLibrarySearchUrl(brand: string): string {
  const qs = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country: "US",
    q: brand,
    search_type: "keyword_unordered",
    media_type: "all",
  });
  return `https://www.facebook.com/ads/library/?${qs}`;
}

export function hostOf(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
