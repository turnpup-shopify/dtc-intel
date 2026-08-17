import {
  ScrapeError,
  type ScrapeAdapter,
  type ScrapeResult,
  type ScrollOptions,
} from "./types";

const BASE = "https://api.scrapfly.io/scrape";

interface ScrapflyResponse {
  result?: {
    content?: string;
    status_code?: number;
    url?: string;
    screenshots?: Record<string, { url?: string; extension?: string }>;
  };
}

/**
 * Scrapfly returns HTML and screenshot metadata in a single JSON response, so
 * one call gets both (the screenshot itself is then downloaded by URL).
 */
export class ScrapflyAdapter implements ScrapeAdapter {
  readonly name = "scrapfly";

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("SCRAPER_API_KEY is required for SCRAPER_PROVIDER=scrapfly");
  }

  /** Scrapfly drives lazy lists with auto_scroll; see the ScrapingBee note on reconciliation. */
  async fetchScrolled(url: string, opts: ScrollOptions): Promise<ScrapeResult> {
    const qs = new URLSearchParams({
      key: this.apiKey,
      url,
      render_js: "true",
      asp: "true",
      country: "us",
      auto_scroll: "true",
      rendering_wait: String(Math.min(25_000, 3000 + opts.maxScrolls * opts.delayMs)),
    });

    const res = await fetch(`${BASE}?${qs}`, { signal: AbortSignal.timeout(240_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ScrapeError(
        `Scrapfly scrolled fetch failed (${res.status}): ${body.slice(0, 300)}`,
        res.status
      );
    }

    const json = (await res.json()) as ScrapflyResponse;
    const result = json.result ?? {};
    return {
      html: result.content ?? "",
      screenshotBuffer: Buffer.alloc(0),
      finalUrl: result.url ?? url,
      statusCode: result.status_code ?? res.status,
    };
  }

  async fetch(url: string): Promise<ScrapeResult> {
    const qs = new URLSearchParams({
      key: this.apiKey,
      url,
      render_js: "true",
      asp: "true", // anti-scraping protection bypass
      country: "us",
      rendering_wait: "3000",
      "screenshots[main]": "fullpage",
    });

    const res = await fetch(`${BASE}?${qs}`, { signal: AbortSignal.timeout(150_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ScrapeError(
        `Scrapfly fetch failed (${res.status}): ${body.slice(0, 300)}`,
        res.status
      );
    }

    const json = (await res.json()) as ScrapflyResponse;
    const result = json.result ?? {};

    const shotUrl = result.screenshots?.main?.url;
    let screenshotBuffer = Buffer.alloc(0);
    if (shotUrl) {
      try {
        const sep = shotUrl.includes("?") ? "&" : "?";
        const shot = await fetch(`${shotUrl}${sep}key=${encodeURIComponent(this.apiKey)}`, {
          signal: AbortSignal.timeout(60_000),
        });
        if (shot.ok) screenshotBuffer = Buffer.from(await shot.arrayBuffer());
      } catch {
        // Best effort — see ScrapingBeeAdapter.
      }
    }

    return {
      html: result.content ?? "",
      screenshotBuffer,
      finalUrl: result.url ?? url,
      statusCode: result.status_code ?? res.status,
    };
  }
}
