import { scraper } from "../scrape";
import { adLibraryPageUrl } from "../url";
import { parseAdLibrary } from "./parse";
import { collapse, isShort, reconcile, type Completeness, type HarvestRow } from "./aggregate";
import { FAST_PASS, PATIENT_PASS } from "./profiles";

export type { HarvestRow, Completeness };

export interface HarvestReport {
  adLibraryUrl: string;
  cardsHarvested: number;
  /** Meta's own "~N results" figure — the independent check on our harvest. */
  estimate: number | null;
  completeness: Completeness;
  /** Human-readable reason when completeness isn't "complete". */
  warning: string | null;
  /** Which scroll profile produced the result we kept. */
  scrollProfile: string;
  withDestination: number;
  withoutDestination: number;
  rows: HarvestRow[];
}


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

  let profile = FAST_PASS;
  let parsed = parseAdLibrary((await adapter.fetchScrolled(url, profile)).html);

  // Retry slower when we came up short. Harvesting is keyed on Library ID, so
  // re-reading the same ads costs nothing but time, and we keep whichever pass
  // saw more.
  if (isShort(parsed.cards.length, parsed.estimate)) {
    const retry = parseAdLibrary((await adapter.fetchScrolled(url, PATIENT_PASS)).html);
    if (retry.cards.length > parsed.cards.length) {
      parsed = retry;
      profile = PATIENT_PASS;
    }
  }

  const { completeness, warning } = reconcile(parsed.cards.length, parsed.estimate);

  return {
    adLibraryUrl: url,
    cardsHarvested: parsed.cards.length,
    estimate: parsed.estimate,
    completeness,
    warning,
    scrollProfile: `${profile.maxScrolls}x${profile.delayMs}ms`,
    withDestination: parsed.cards.filter((c) => c.destinationUrl).length,
    withoutDestination: parsed.cards.filter((c) => !c.destinationUrl).length,
    rows: collapse(parsed.cards),
  };
}
