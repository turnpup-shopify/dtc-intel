import { env } from "../env";
import { FetchAdapter } from "./fetch";
import { ScrapflyAdapter } from "./scrapfly";
import { ScrapingBeeAdapter } from "./scrapingbee";
import type { ScrapeAdapter } from "./types";

export * from "./types";

let adapter: ScrapeAdapter | null = null;

/** Selected by SCRAPER_PROVIDER. Swapping vendors is a one-env-var change. */
export function scraper(): ScrapeAdapter {
  if (adapter) return adapter;

  switch (env.scraperProvider.toLowerCase()) {
    case "scrapingbee":
      adapter = new ScrapingBeeAdapter(env.scraperKey);
      break;
    case "scrapfly":
      adapter = new ScrapflyAdapter(env.scraperKey);
      break;
    case "fetch":
      adapter = new FetchAdapter();
      break;
    default:
      throw new Error(
        `Unknown SCRAPER_PROVIDER "${env.scraperProvider}". Expected scrapingbee | scrapfly | fetch.`
      );
  }

  return adapter;
}
