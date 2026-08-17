import { NextResponse } from "next/server";
import { diagnose, parseAdLibrary } from "@/lib/adlibrary/parse";
import { FAST_PASS } from "@/lib/adlibrary/profiles";
import { requires, withConfig } from "@/lib/api";
import { scraper } from "@/lib/scrape";
import { adLibraryPageUrl } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/test/adlibrary { pageId?, url? } — ground truth for one advertiser.
 *
 * A debugging endpoint, not part of the pipeline. It writes nothing and merges
 * nothing; it scrapes one Ad Library page and reports what actually came back.
 *
 * This exists because the harvester's failures are all invisible from outside.
 * "No ads had a link" has at least three causes that look identical: the card
 * boundary is wrong and excludes the CTA, Meta changed its link wrapper, or the
 * CTAs never rendered. Guessing between them one deploy at a time is slow and
 * mostly wrong, so this returns the raw evidence instead — including a window
 * into the DOM around a real card.
 */
async function postHandler(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { pageId?: string; url?: string };
  const target = body.url?.trim() || (body.pageId ? adLibraryPageUrl(body.pageId.trim()) : null);
  if (!target) {
    return NextResponse.json({ error: "pageId or url is required" }, { status: 400 });
  }

  const adapter = scraper();
  if (!adapter.fetchScrolled) {
    return NextResponse.json(
      { error: `SCRAPER_PROVIDER=${adapter.name} cannot scroll. Use scrapingbee or scrapfly.` },
      { status: 400 }
    );
  }

  const scraped = await adapter.fetchScrolled(target, FAST_PASS);
  const html = scraped.html ?? "";
  const parsed = parseAdLibrary(html);

  return NextResponse.json({
    ok: true,
    requestedUrl: target,
    finalUrl: scraped.finalUrl,
    statusCode: scraped.statusCode,
    diagnostics: diagnose(html),
    estimate: parsed.estimate,
    cardsFound: parsed.cards.length,
    withDestination: parsed.cards.filter((c) => c.destinationUrl).length,

    // Every way a destination might be encoded, counted separately. Whichever
    // is non-zero tells us what to parse; all zero means the CTAs never
    // rendered and no amount of parsing will help.
    linkShapes: countLinkShapes(html),

    // What the parser sees inside each card. If a card has zero hrefs while the
    // page has thousands, the card boundary is too tight — the marker and the
    // CTA are in different subtrees.
    sampleCards: parsed.cards.slice(0, 5).map((c) => ({
      libraryId: c.libraryId,
      destinationUrl: c.destinationUrl,
    })),

    // The actual DOM around a real card. This is the piece that ends the
    // guessing, so it is deliberately large enough to show the structure.
    domAroundFirstCard: excerptAround(html, "Library ID", 4000),
  });
}

/** Count the encodings Meta has used for outbound ad links, past and present. */
function countLinkShapes(html: string): Record<string, number> {
  const count = (re: RegExp) => (html.match(re) ?? []).length;
  return {
    "l.facebook.com/l.php": count(/l\.facebook\.com\/l\.php/g),
    "lm.facebook.com/l.php": count(/lm\.facebook\.com\/l\.php/g),
    "any l.php?u=": count(/l\.php\?u=/g),
    "data-lynx-uri": count(/data-lynx-uri/g),
    "all anchors": count(/<a\s/gi),
    "https:// in href": count(/href="https:\/\//g),
  };
}

/**
 * Pull the HTML surrounding the first occurrence of `needle`, centred on it.
 * Capped so a 2MB page can't be returned wholesale through a JSON response.
 */
function excerptAround(html: string, needle: string, span: number): string | null {
  const at = html.indexOf(needle);
  if (at === -1) return null;
  const start = Math.max(0, at - Math.floor(span / 2));
  return html.slice(start, start + span);
}

export const POST = withConfig([requires.scraper], postHandler);
