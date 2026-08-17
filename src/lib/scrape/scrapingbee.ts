import {
  ScrapeError,
  type ScrapeAdapter,
  type ScrapeResult,
  type ScrollOptions,
} from "./types";

const BASE = "https://app.scrapingbee.com/api/v1/";

/**
 * ScrapingBee renders JS and survives Cloudflare via `stealth_proxy`, but it
 * returns either HTML or an image per call — never both. So: two calls.
 * The screenshot call is best-effort; a page we can read but can't picture is
 * still worth reviewing.
 */
export class ScrapingBeeAdapter implements ScrapeAdapter {
  readonly name = "scrapingbee";

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("SCRAPER_API_KEY is required for SCRAPER_PROVIDER=scrapingbee");
  }

  async fetch(url: string): Promise<ScrapeResult> {
    const html = await this.getHtml(url);
    const screenshotBuffer = await this.getScreenshot(url).catch(() => Buffer.alloc(0));
    return { ...html, screenshotBuffer };
  }

  /**
   * Drive the lazy-loader with ScrapingBee's js_scenario, then return the DOM
   * as it stands. We cannot click "See more" — its class names are obfuscated
   * and ScrapingBee clicks by CSS selector, not by text — so scrolling is the
   * only lever, and it is why the caller MUST reconcile the harvested count
   * against Meta's own estimate instead of trusting a completed run.
   */
  async fetchScrolled(url: string, opts: ScrollOptions): Promise<ScrapeResult> {
    const scenario = {
      instructions: [
        { wait: 4000 },
        { infinite_scroll: { max_count: opts.rounds, delay: opts.delayMs } },
        { wait: 2000 },
      ],
    };

    const qs = new URLSearchParams({
      api_key: this.apiKey,
      url,
      render_js: "true",
      block_ads: "true",
      country_code: "us",
      return_page_source: "true",
      js_scenario: JSON.stringify(scenario),
    });

    const res = await fetch(`${BASE}?${qs}`, { signal: AbortSignal.timeout(240_000) });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ScrapeError(
        `ScrapingBee scrolled fetch failed (${res.status}): ${body.slice(0, 300)}`,
        res.status
      );
    }

    return {
      html: await res.text(),
      screenshotBuffer: Buffer.alloc(0),
      finalUrl: res.headers.get("spb-resolved-url") || url,
      statusCode: Number(res.headers.get("spb-initial-status-code")) || res.status,
    };
  }

  private async getHtml(url: string): Promise<Omit<ScrapeResult, "screenshotBuffer">> {
    const qs = new URLSearchParams({
      api_key: this.apiKey,
      url,
      render_js: "true",
      block_ads: "true",
      wait: "3000",
      return_page_source: "true",
    });

    const res = await fetch(`${BASE}?${qs}`, { signal: AbortSignal.timeout(120_000) });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ScrapeError(
        `ScrapingBee HTML fetch failed (${res.status}): ${body.slice(0, 300)}`,
        res.status
      );
    }

    return {
      html: await res.text(),
      // ScrapingBee reports the resolved URL and upstream status in headers.
      finalUrl: res.headers.get("spb-resolved-url") || url,
      statusCode: Number(res.headers.get("spb-initial-status-code")) || res.status,
    };
  }

  private async getScreenshot(url: string): Promise<Buffer> {
    const qs = new URLSearchParams({
      api_key: this.apiKey,
      url,
      render_js: "true",
      block_ads: "true",
      wait: "3000",
      screenshot: "true",
      screenshot_full_page: "true",
    });

    const res = await fetch(`${BASE}?${qs}`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new ScrapeError(`ScrapingBee screenshot failed (${res.status})`, res.status);
    return Buffer.from(await res.arrayBuffer());
  }
}
