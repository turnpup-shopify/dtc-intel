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
  /** The link-preview headline — the "hook". Null when it can't be isolated. */
  headline: string | null;
  /**
   * The ad's creative image, straight off Meta's CDN. Short-lived: the URL
   * carries a signed token, so it must be downloaded during this run or lost.
   */
  creativeUrl: string | null;
  /** Permalink back to this ad in the Ad Library. */
  snapshotUrl: string;
}

/**
 * Button labels Meta renders inside the link preview. They sit in the same
 * block as the headline and would otherwise win on any "pick the text" rule.
 */
const CTA_LABELS = new Set(
  [
    "shop now", "learn more", "sign up", "get offer", "order now", "book now",
    "download", "subscribe", "apply now", "contact us", "see more", "get quote",
    "send message", "watch more", "play game", "install now", "buy now",
    "start now", "try now", "get started", "sponsored", "open link",
  ].map((s) => s)
);

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

    cards.push({
      libraryId: id,
      destinationUrl: destinationForCard($, el),
      headline: headlineForCard($, el),
      creativeUrl: creativeForCard($, el),
      snapshotUrl: `https://www.facebook.com/ads/library/?id=${id}`,
    });
  }

  return cards;
}

/**
 * Find this ad's destination, widening the card boundary until it appears.
 *
 * The innermost div holding "Library ID" is a reliable way to FIND an ad, but a
 * bad guess at where the ad ENDS. Meta often puts the id in a small metadata
 * block while the call-to-action lives in a sibling subtree, so a parser
 * anchored on the marker alone sees a card with no links at all and reports
 * every ad as having no destination.
 *
 * So: walk outward from the marker, stopping the moment an ancestor would
 * swallow a second "Library ID" — that is the neighbouring ad, and crossing
 * into it would attribute someone else's landing page to this one. The first
 * boundary in that safe range that yields a destination wins.
 */
function destinationForCard($: CheerioAPI, seed: ReturnType<CheerioAPI>[number]): string | null {
  const chain = [seed, ...$(seed).parents().toArray()];

  for (const el of chain) {
    // Past this point the element covers more than one ad. Stop widening.
    if ((($(el).text().match(LIBRARY_ID_GLOBAL) ?? []).length) !== 1) break;

    const destination = destinationFrom(linkCandidates($, el));
    if (destination) return destination;
  }

  return null;
}

/**
 * The link-preview headline — what the hooks queue ranks.
 *
 * Scoped deliberately to the outbound anchor rather than the whole card. The
 * card also holds the ad's body copy, which is usually LONGER than the
 * headline, so any "take the biggest piece of text" rule applied card-wide
 * reliably returns the wrong string. Inside the anchor there are only three
 * things — the display domain, the headline, and the button label — and two of
 * those are recognisable on sight.
 *
 * Returns null rather than guessing when there is no outbound anchor. A card
 * with no link has no hook worth tracking, and rebuild_ad_hooks already skips
 * rows with an empty title, so an honest null degrades cleanly.
 */
function headlineForCard($: CheerioAPI, seed: ReturnType<CheerioAPI>[number]): string | null {
  const chain = [seed, ...$(seed).parents().toArray()];

  for (const el of chain) {
    if ((($(el).text().match(LIBRARY_ID_GLOBAL) ?? []).length) !== 1) break;

    // "Anchor that yields a destination" — reusing the rule that already works,
    // rather than a second definition that would drift from it. Note the
    // redirector itself lives on a Meta host, so a naive is-it-Meta test here
    // would reject the single most common case.
    const blocks = $(el)
      .find("a")
      .toArray()
      .filter((a) => destinationFrom(linkCandidates($, a)) !== null);

    for (const block of blocks) {
      const best = pickHeadline(textSegments($, block));
      if (best) return best;
    }
  }

  return null;
}

/**
 * The ad's creative image.
 *
 * Every card carries at least two images — the advertiser's profile picture and
 * the creative itself — and picking the wrong one gives you a wall of identical
 * brand logos where the ads should be. Two signals separate them:
 *
 *  1. Scope. The creative usually sits inside the same outbound anchor as the
 *     headline; the profile picture sits in the card header, outside it. So the
 *     anchor is searched first, exactly as it is for the headline.
 *  2. Size. Meta bakes the rendered dimensions into the CDN path
 *     ("p720x720", "s60x60"). Anything that small is an avatar, not a creative.
 *
 * Falls back to the whole card when the anchor holds no image, still applying
 * the size floor.
 */
function creativeForCard($: CheerioAPI, seed: ReturnType<CheerioAPI>[number]): string | null {
  const chain = [seed, ...$(seed).parents().toArray()];

  for (const el of chain) {
    if ((($(el).text().match(LIBRARY_ID_GLOBAL) ?? []).length) !== 1) break;

    const anchors = $(el)
      .find("a")
      .toArray()
      .filter((a) => destinationFrom(linkCandidates($, a)) !== null);

    for (const scope of [...anchors, el]) {
      const best = pickImage($(scope).find("img").toArray().map((i) => $(i).attr("src")));
      if (best) return best;
    }
  }

  return null;
}

/** Avatars and UI chrome live below this; ad creatives do not. */
const MIN_CREATIVE_PX = 150;

function pickImage(srcs: (string | undefined)[]): string | null {
  let best: { url: string; px: number } | null = null;

  for (const raw of srcs) {
    if (!raw) continue;
    const u = safeUrl(raw);
    if (!u || !isHttp(u)) continue;

    const px = largestDimensionHint(u.pathname);
    // An unhinted URL might still be the creative, so it stays eligible — it
    // just loses to anything that proves its size.
    if (px !== null && px < MIN_CREATIVE_PX) continue;

    const score = px ?? MIN_CREATIVE_PX;
    if (!best || score > best.px) best = { url: u.toString(), px: score };
  }

  return best?.url ?? null;
}

/** Largest NxN figure Meta encoded in the path, e.g. "p720x720" -> 720. */
function largestDimensionHint(path: string): number | null {
  const matches = Array.from(path.matchAll(/(\d{2,4})x(\d{2,4})/g));
  if (matches.length === 0) return null;
  return Math.max(...matches.flatMap((m) => [Number(m[1]), Number(m[2])]));
}

/** Own-text of every node in the subtree, so siblings stay separate strings. */
function textSegments($: CheerioAPI, root: ReturnType<CheerioAPI>[number]): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const s = raw.replace(/\s+/g, " ").trim();
    if (s) out.push(s);
  };

  push($(root).clone().children().remove().end().text());
  for (const node of $(root).find("*").toArray()) {
    push($(node).clone().children().remove().end().text());
  }
  return out;
}

function pickHeadline(segments: string[]): string | null {
  const candidates = segments.filter((s) => {
    if (s.length < 3 || s.length > 200) return false;
    if (CTA_LABELS.has(s.toLowerCase())) return false;
    if (/library id/i.test(s)) return false;
    // The display domain: no spaces, at least one dot. Never the headline.
    if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+\.?$/.test(s)) return false;
    if (/^https?:\/\//i.test(s)) return false;
    return true;
  });

  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Every attribute Meta has used to carry an outbound URL. `href` is the usual
 * one, but ad CTAs frequently keep the real destination in `data-lynx-uri`
 * while the href is a placeholder, so both are collected.
 */
function linkCandidates($: CheerioAPI, el: ReturnType<CheerioAPI>[number]): string[] {
  const out: string[] = [];

  // Structural type rather than cheerio's generics: $(el) and $(anchor) resolve
  // to different Cheerio<T> instantiations, and all we need from either is attr.
  const collect = (node: { attr(name: string): string | undefined }) => {
    const lynx = node.attr("data-lynx-uri");
    if (lynx) out.push(lynx);
    const href = node.attr("href");
    if (href) out.push(href);
  };

  // The element itself counts when it IS an anchor. Callers pass whole cards
  // (links are descendants) and bare anchors (the link is the element), and a
  // descendants-only search silently returns nothing for the second case.
  if ($(el).is("a")) collect($(el));
  for (const a of $(el).find("a").toArray()) collect($(a));

  return out;
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
 * Meta prints its own result count near the top of the page.
 *
 * The wording moves around ("~113 results", "About 113 results", "113 ads"),
 * the tilde is sometimes a different character, and the space before the noun
 * is sometimes non-breaking. So this is written loosely on purpose — and it is
 * now only a FALLBACK. The trustworthy count comes from the API; see
 * fetchActiveAdCount.
 */
function extractEstimate($: CheerioAPI): number | null {
  // Normalise the exotic whitespace and tildes Meta's UI uses before matching.
  const text = $("body")
    .text()
    .replace(/[   ]/g, " ")
    .replace(/[~∼˜]/g, "~");

  const match = text.match(/(?:~|about\s+)?\s*([\d][\d.,\s]{0,12}?)\s*\+?\s+(?:results?|ads)\b/i);
  if (!match) return null;

  const n = Number(match[1].replace(/[.,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * What did we actually get back?
 *
 * When a harvest returns nothing, the two candidate explanations look identical
 * from the outside: the parser stopped matching Meta's markup, or the scrape
 * never reached the real page at all (login wall, consent gate, block page).
 * These markers separate them without dumping a multi-megabyte page into the
 * log, and without storing anything that isn't Meta's own chrome.
 */
export interface ParseDiagnostics {
  htmlBytes: number;
  /** Did the string every ad card carries appear anywhere? */
  sawLibraryIdMarker: boolean;
  /** Did any count-like text appear, even if unparsed? */
  sawResultsText: boolean;
  /** Meta's outbound redirect wrapper. Zero here means no CTAs were rendered. */
  redirectorLinks: number;
  /** Opening body text — enough to recognise a login or consent page on sight. */
  bodyTextSample: string;
}

export function diagnose(html: string): ParseDiagnostics {
  const $ = load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  return {
    htmlBytes: html.length,
    sawLibraryIdMarker: /Library ID/i.test(html),
    sawResultsText: /\b(results?|ads)\b/i.test(text.slice(0, 4000)),
    redirectorLinks: (html.match(/l\.php\?u=/g) ?? []).length,
    bodyTextSample: text.slice(0, 300),
  };
}
