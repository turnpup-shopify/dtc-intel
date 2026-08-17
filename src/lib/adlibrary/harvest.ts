import { scraper } from "../scrape";
import { adLibraryPageUrl } from "../url";
import { parseAdLibrary } from "./parse";
import { collapse, isShort, reconcile, type Completeness, type HarvestRow } from "./aggregate";

export type { HarvestRow, Completeness };

export interface HarvestReport {
  adLibraryUrl: string;
  cardsHarvested: number;
  /** Meta's own "~N results" figure — the independent check on our harvest. */
  estimate: number | null;
  completeness: Completeness;
  /** Human-readable reason when completeness isn't "complete". */
  warning: string | null;
  scrollRounds: number;
  withDestination: number;
  withoutDestination: number;
  rows: HarvestRow[];
}

const FIRST_PASS_ROUNDS = 25;
const RETRY_ROUNDS = 60;
const DELAY_MS = 1500;

/**
 * Harvest one brand's Ad Library page into a deduped list of landing pages.
 *
 * One brand per call, deliberately. Scrolling a busy advertiser to the bottom
 * takes the better part of a minute, and a serverless function that tried all
 * seventeen would hit its ceiling somewhere in the middle with nothing to show.
 * The client drives the loop instead, so progress is visible and a single slow
 * brand can't sink the run.
 */
export async function harvestBrand(pageId: string): Promise<HarvestReport> {
  const adapter = scraper();
  if (!adapter.fetchScrolled) {
    throw new Error(
      `SCRAPER_PROVIDER=${adapter.name} cannot scroll a lazy-loaded page. The Ad Library is ` +
        `client-rendered and paginates on scroll, so harvesting needs scrapingbee or scrapfly.`
    );
  }

  const url = adLibraryPageUrl(pageId);

  let rounds = FIRST_PASS_ROUNDS;
  let parsed = parseAdLibrary(
    (await adapter.fetchScrolled(url, { rounds, delayMs: DELAY_MS })).html
  );

  // One retry with a longer scroll budget when we came up short. Harvesting is
  // keyed on Library ID, so re-reading the same ads costs nothing but time.
  if (isShort(parsed.cards.length, parsed.estimate)) {
    rounds = RETRY_ROUNDS;
    const retry = parseAdLibrary(
      (await adapter.fetchScrolled(url, { rounds, delayMs: DELAY_MS })).html
    );
    if (retry.cards.length > parsed.cards.length) parsed = retry;
  }

  const { completeness, warning } = reconcile(parsed.cards.length, parsed.estimate);

  return {
    adLibraryUrl: url,
    cardsHarvested: parsed.cards.length,
    estimate: parsed.estimate,
    completeness,
    warning,
    scrollRounds: rounds,
    withDestination: parsed.cards.filter((c) => c.destinationUrl).length,
    withoutDestination: parsed.cards.filter((c) => !c.destinationUrl).length,
    rows: collapse(parsed.cards),
  };
}
