import { load, type CheerioAPI } from "cheerio";

/**
 * THE FRAGILE LAYER. Everything that knows what Meta's HTML looks like lives in
 * this file and nowhere else. When Meta ships a redesign, this is the only
 * module that should need editing.
 *
 * Two rules keep it as durable as DOM parsing gets:
 *
 *  1. Anchor on CONTENT, never on markup. Ad Library class names are obfuscated
 *     and rotate. The strings "Library ID:" and "results" do not.
 *  2. Never follow a redirect to learn a destination. Meta wraps outbound links
 *     as l.facebook.com/l.php?u=<encoded>, so the landing page is already in
 *     the href — it is pure string parsing, no network call.
 */

export interface AdCard {
  /** Meta's own per-ad identifier, printed on the card. Our primary key. */
  libraryId: string;
  /** Advertiser destination, unwrapped from l.php. Null when a card has none. */
  destinationUrl: string | null;
  /** Permalink back to this ad in the Ad Library. */
  snapshotUrl: string;
}

export interface ParsedLibrary {
  cards: AdCard[];
  /**
   * The "~N results" figure Meta prints near the top, or null if absent.
   * This is what makes a run trustworthy — see reconcile() in harvest.ts.
   */
  estimate: number | null;
}

const LIBRARY_ID = /Library ID:\s*(\d{5,25})/;
const LIBRARY_ID_GLOBAL = /Library ID:\s*\d{5,25}/g;

/** Meta-owned hosts. An anchor pointing at one of these is never the landing page. */
const META_HOST =
  /(^|\.)(facebook|fb|instagram|messenger|threads|whatsapp|meta|oculus)\.(com|me|net|gg)$/i;

export function parseAdLibrary(html: string): ParsedLibrary {
  const $ = load(html);
  return { cards: extractCards($), estimate: extractEstimate($) };
}

/**
 * Rule 2 of the extraction chain: every ad card contains exactly one
 * "Library ID: <digits>". Collect the divs matching that, then keep only the
 * innermost — a wrapper around a single card matches too, and would otherwise
 * duplicate it.
 */
function extractCards($: CheerioAPI): AdCard[] {
  const matching = $("div")
    .filter((_, el) => {
      const text = $(el).text();
      if (!text.includes("Library ID:")) return false;
      return (text.match(LIBRARY_ID_GLOBAL) ?? []).length === 1;
    })
    .toArray();

  const matchingSet = new Set(matching);
  const cards: AdCard[] = [];
  const seen = new Set<string>();

  for (const el of matching) {
    // Innermost wins: skip this div if a matching div sits inside it.
    const hasMatchingDescendant = $(el)
      .find("div")
      .toArray()
      .some((d) => matchingSet.has(d));
    if (hasMatchingDescendant) continue;

    const id = $(el).text().match(LIBRARY_ID)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const hrefs = $(el)
      .find("a[href]")
      .toArray()
      .map((a) => $(a).attr("href"))
      .filter((h): h is string => Boolean(h));

    cards.push({
      libraryId: id,
      destinationUrl: destinationFrom(hrefs),
      snapshotUrl: `https://www.facebook.com/ads/library/?id=${id}`,
    });
  }

  return cards;
}

/**
 * Rule 1: pull the advertiser's URL out of Meta's redirect wrapper, falling
 * back to the first anchor that simply isn't Meta's.
 *
 * Note the SINGLE decode. `searchParams.get()` already percent-decodes once, so
 * decoding its result again would corrupt any destination whose own query
 * string contains an encoded delimiter — `?a=1%26b` would silently become two
 * parameters. Plain URLs survive either way, which is exactly why the extra
 * decode looks harmless right up until it isn't.
 */
export function destinationFrom(hrefs: string[]): string | null {
  for (const href of hrefs) {
    const u = safeUrl(href);
    if (!u || !isRedirector(u)) continue;
    const target = u.searchParams.get("u");
    const dest = target ? safeUrl(target) : null;
    if (dest && isHttp(dest)) return dest.toString();
  }

  for (const href of hrefs) {
    const u = safeUrl(href);
    if (!u || !isHttp(u)) continue;
    if (META_HOST.test(u.hostname)) continue;
    return u.toString();
  }

  return null;
}

/** l.facebook.com/l.php and its lm./lm.facebook variants. */
function isRedirector(u: URL): boolean {
  return META_HOST.test(u.hostname) && /^\/l\.php$/i.test(u.pathname);
}

function isHttp(u: URL): boolean {
  return u.protocol === "http:" || u.protocol === "https:";
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/**
 * Meta prints its own result count ("~113 results"). We do not compute this
 * ourselves — the whole point is to have an independent number to check the
 * harvest against.
 */
function extractEstimate($: CheerioAPI): number | null {
  const text = $("body").text();
  const match = text.match(/~?\s*([\d,]+)\s*\+?\s+results?\b/i);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
