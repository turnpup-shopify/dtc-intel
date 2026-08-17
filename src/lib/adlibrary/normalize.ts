/**
 * Turning a raw ad destination into a stable identity for one landing page.
 *
 * The single most important rule here: the dedupe key is hostname + pathname,
 * and NOTHING else. Meta appends `fbclid` to every outbound link and it is
 * unique per impression — keep the query string in the key and 113 ads become
 * 113 "distinct" landing pages.
 *
 * The other params are not noise, though. utm_content, variant and affiliate
 * tags are real signal about how a page is being trafficked. They get stored,
 * just never in the key.
 */

export type PageType =
  | "homepage"
  | "pdp"
  | "collection"
  | "landing page"
  | "quiz"
  | "article"
  | "social profile"
  | "other";

export interface NormalizedDestination {
  /** hostname + pathname, lowercased and trailing-slash-stripped. Unique per page. */
  key: string;
  /** Canonical display URL — the key, put back together as a clickable link. */
  url: string;
  host: string;
  path: string;
  pageType: PageType;
  /** Non-fbclid query params, kept for signal. Never part of the key. */
  params: Record<string, string>;
}

const SOCIAL_HOST =
  /(^|\.)(facebook|instagram|twitter|x|tiktok|youtube|pinterest|linkedin|threads|snapchat)\.(com|co)$/i;

/** Tracking params that carry no information about which page this is. */
const IGNORED_PARAMS = new Set(["fbclid", "gclid", "ttclid", "msclkid", "igshid", "_ga"]);

export function normalizeDestination(rawUrl: string): NormalizedDestination | null {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host) return null;

  // Percent-decode before comparing so /Products%2FGummies and /products/gummies
  // collapse; fall back to the raw path if the encoding is malformed.
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    path = u.pathname;
  }
  path = path.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "");

  const params: Record<string, string> = {};
  for (const [k, v] of u.searchParams) {
    const key = k.toLowerCase();
    if (IGNORED_PARAMS.has(key)) continue;
    params[key] = v;
  }

  return {
    key: `${host}${path}`,
    url: `https://${host}${path || "/"}`,
    host,
    path,
    pageType: classify(host, path),
    params,
  };
}

/**
 * Page type from the FIRST path segment only. Cheap, and reliable on
 * Shopify-shaped sites.
 *
 * Deliberately does NOT look at the rest of the slug. "/pages/lp-2b" tells you
 * nothing real, and guessing at it manufactures insight that was never there.
 */
export function classify(host: string, path: string): PageType {
  if (SOCIAL_HOST.test(host)) return "social profile";

  const first = path.split("/").filter(Boolean)[0];
  if (!first) return "homepage";

  switch (first) {
    case "products":
    case "product":
      return "pdp";
    case "collections":
    case "collection":
      return "collection";
    case "pages":
    case "page":
      return "landing page";
    case "quiz":
    case "quizzes":
      return "quiz";
    case "blog":
    case "blogs":
    case "articles":
      return "article";
    default:
      return "other";
  }
}
