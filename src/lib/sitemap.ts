/**
 * Sitemap diffing (spec §6.6). Shopify exposes /sitemap_pages.xml; fall back to
 * /sitemap.xml and walk one level of sitemap-index nesting.
 *
 * This is the tier that produces URLs with no human in the loop, and it catches
 * launches before they're advertised.
 */

const CANDIDATE_PATHS = ["/sitemap_pages.xml", "/sitemap.xml"];

export async function fetchSitemapPageUrls(domain: string): Promise<string[]> {
  const origin = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  for (const path of CANDIDATE_PATHS) {
    try {
      const xml = await get(`${origin}${path}`);
      if (!xml) continue;

      const nested = extractTags(xml, "sitemap");
      if (nested.length > 0) {
        const urls: string[] = [];
        // Only follow child sitemaps that plausibly contain /pages/ entries.
        const pageSitemaps = nested
          .map((s) => extractTag(s, "loc"))
          .filter((loc): loc is string => Boolean(loc))
          .filter((loc) => /pages|page/i.test(loc))
          .slice(0, 5);

        for (const child of pageSitemaps) {
          const childXml = await get(child);
          if (childXml) urls.push(...locsOf(childXml));
        }
        if (urls.length) return filterPageUrls(urls);
      }

      const urls = locsOf(xml);
      if (urls.length) return filterPageUrls(urls);
    } catch {
      // Try the next candidate path.
    }
  }

  return [];
}

async function get(url: string): Promise<string | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "dtc-intel-sitemap/1.0", accept: "application/xml,text/xml" },
  });
  if (!res.ok) return null;
  const body = await res.text();
  return body.includes("<") ? body : null;
}

function locsOf(xml: string): string[] {
  return extractTags(xml, "url")
    .map((entry) => extractTag(entry, "loc"))
    .filter((loc): loc is string => Boolean(loc));
}

/** Landing pages live under /pages/ on Shopify. Products and posts are noise here. */
function filterPageUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls
    .filter((u) => /\/pages\//i.test(u))
    .filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });
}

function extractTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  return Array.from(xml.matchAll(re)).map((m) => m[1]);
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(re);
  return match ? decodeXml(match[1].trim()) : null;
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}
