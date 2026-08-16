import { ScrapeError, type ScrapeAdapter, type ScrapeResult } from "./types";

/**
 * Plain fetch — no JS rendering, no screenshot. For local development and for
 * proving the rest of the pipeline without burning scrape credits.
 *
 * Do not use in production: Cloudflare blocks it and most Shopify landing pages
 * render their hero client-side.
 */
export class FetchAdapter implements ScrapeAdapter {
  readonly name = "fetch";

  async fetch(url: string): Promise<ScrapeResult> {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      throw new ScrapeError(`fetch adapter got ${res.status} for ${url}`, res.status);
    }

    return {
      html: await res.text(),
      screenshotBuffer: Buffer.alloc(0),
      finalUrl: res.url || url,
      statusCode: res.status,
    };
  }
}
