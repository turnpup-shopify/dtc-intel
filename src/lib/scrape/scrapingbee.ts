import {
  ScrapeError,
  type ScrapeAdapter,
  type ScrapeResult,
  type ScrollOptions,
} from "./types";

const BASE = "https://app.scrapingbee.com/api/v1/";

/**
 * Escape a string for safe embedding in an XPath expression. XPath has no
 * escape character, so a value containing an apostrophe has to be assembled
 * with concat() rather than quoted.
 */
function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  return `concat('${value.split("'").join(`', "'", '`)}')`;
}

/**
 * ScrapingBee renders JS, but returns either HTML or an image per call — never
 * both. So: two calls. The screenshot call is best-effort; a page we can read
 * but can't picture is still worth reviewing.
 *
 * Note on geotargeting: `country_code` is NOT set anywhere here, because
 * ScrapingBee only accepts it alongside `premium_proxy=true` and rejects the
 * request outright otherwise. That is a five-fold credit increase for something
 * the Ad Library URL already does itself via its own `country=US` parameter.
 * If Meta starts blocking the classic proxy pool, premium is the escalation —
 * but it should be a deliberate choice, not a silent default.
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
   * as it stands.
   *
   * THE BINDING CONSTRAINT IS 40 SECONDS. ScrapingBee caps total js_scenario
   * execution there, so the scroll budget is not "however long it takes" — it
   * is a fixed envelope the caller has to fit inside. Every value below is
   * chosen so the worst case lands comfortably under it:
   *
   *     3s initial wait + (maxScrolls x delayMs) must stay well below 40s
   *
   * That cap is also why there is no "just scroll more" retry. A busy
   * advertiser can genuinely have more ads than 40 seconds of scrolling will
   * reach, and no parameter fixes that — which is exactly why reconciling
   * against Meta's printed count is not optional.
   *
   * `block_resources` is off here on purpose. It speeds ordinary scrapes up by
   * skipping images, but lazy-loading is usually driven by viewport
   * intersection, and a page with no images to intersect may never append a
   * second batch.
   */
  async fetchScrolled(url: string, opts: ScrollOptions): Promise<ScrapeResult> {
    const scroll: Record<string, unknown> = {
      max_count: opts.maxScrolls,
      delay: opts.delayMs,
    };
    if (opts.endClickText) {
      scroll.end_click = {
        selector: `//*[contains(text(), ${xpathLiteral(opts.endClickText)})]`,
        selector_type: "xpath",
      };
    }

    const scenario = { instructions: [{ wait: 3000 }, { infinite_scroll: scroll }] };

    const qs = new URLSearchParams({
      api_key: this.apiKey,
      url,
      render_js: "true",
      block_resources: "false",
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

  /**
   * NOTE: no `return_page_source` here, deliberately.
   *
   * It reads like "give me the HTML", but it means "give me the HTML from
   * BEFORE JavaScript ran" — which silently cancels out `render_js`. On a
   * client-rendered landing page that returns an empty shell, and the pipeline
   * then blames the site: "page yielded almost no text, likely a bot wall."
   * Omitting it is safe under either reading of the flag, since a request
   * without `screenshot` returns HTML regardless.
   */
  private async getHtml(url: string): Promise<Omit<ScrapeResult, "screenshotBuffer">> {
    const qs = new URLSearchParams({
      api_key: this.apiKey,
      url,
      render_js: "true",
      block_ads: "true",
      wait: "3000",
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
