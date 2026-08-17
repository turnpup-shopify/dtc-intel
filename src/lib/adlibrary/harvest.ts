import { fetchActiveAdCount } from "../meta";
import { scraper } from "../scrape";
import { adLibraryPageUrl } from "../url";
import { diagnose, parseAdLibrary, type ParseDiagnostics } from "./parse";
import { collapse, isShort, reconcile, type Completeness, type HarvestRow } from "./aggregate";
import { FAST_PASS, PATIENT_PASS } from "./profiles";

export type { HarvestRow, Completeness };

export interface HarvestReport {
  adLibraryUrl: string;
  cardsHarvested: number;
  /** How many ads there should be — the independent check on our harvest. */
  estimate: number | null;
  /** Where that number came from. "none" means nothing checked this run. */
  estimateSource: "api" | "page" | "none";
  /** Set when the API was asked for a count and refused. Distinct from no token. */
  countError: string | null;
  completeness: Completeness;
  /** Human-readable reason when completeness isn't "complete". */
  warning: string | null;
  /** Which scroll profile produced the result we kept. */
  scrollProfile: string;
  withDestination: number;
  withoutDestination: number;
  rows: HarvestRow[];
  /** Attached only when a run failed or came up short. */
  diagnostics: ParseDiagnostics | null;
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

  // Ask the API how many ads there SHOULD be, before scraping. It's structured,
  // it doesn't move when Meta restyles the page, and a failure here must not
  // sink the harvest — an unverified result still beats no result.
  let apiCount: { count: number; capped: boolean } | null = null;
  let countError: string | null = null;
  try {
    apiCount = await fetchActiveAdCount(pageId);
  } catch (err) {
    // A rejected token and an absent one produced the same message before, and
    // they need opposite fixes: one is "go add the variable", the other is "the
    // variable you added doesn't work". Keep them apart.
    countError = err instanceof Error ? err.message : String(err);
    console.error("[harvest] API count unavailable:", countError);
  }

  let profile = FAST_PASS;
  let html = (await adapter.fetchScrolled(url, profile)).html;
  let parsed = parseAdLibrary(html);

  const target = expectedCount(apiCount, parsed.estimate);

  // Retry slower when we came up short. Harvesting is keyed on Library ID, so
  // re-reading the same ads costs nothing but time, and we keep whichever pass
  // saw more.
  if (isShort(parsed.cards.length, target)) {
    const retryHtml = (await adapter.fetchScrolled(url, PATIENT_PASS)).html;
    const retry = parseAdLibrary(retryHtml);
    if (retry.cards.length > parsed.cards.length) {
      parsed = retry;
      html = retryHtml;
      profile = PATIENT_PASS;
    }
  }

  const { completeness, warning } = reconcile(parsed.cards.length, target);

  return {
    adLibraryUrl: url,
    cardsHarvested: parsed.cards.length,
    estimate: target,
    estimateSource: apiCount && !apiCount.capped ? "api" : parsed.estimate !== null ? "page" : "none",
    countError,
    completeness,
    warning,
    scrollProfile: `${profile.maxScrolls}x${profile.delayMs}ms`,
    withDestination: parsed.cards.filter((c) => c.destinationUrl).length,
    withoutDestination: parsed.cards.filter((c) => !c.destinationUrl).length,
    rows: collapse(parsed.cards),
    // Only worth carrying when something went wrong; a healthy run doesn't need
    // its own autopsy attached.
    diagnostics: parsed.cards.length === 0 || completeness !== "complete" ? diagnose(html) : null,
  };
}

/**
 * Which number the harvest gets measured against.
 *
 * The API wins when it has a complete answer. A capped API count is worse than
 * useless as a target — it understates the total, so a short harvest would be
 * declared complete, which is the precise failure reconciliation exists to
 * prevent. In that case fall back to the page's own figure.
 */
function expectedCount(
  api: { count: number; capped: boolean } | null,
  fromPage: number | null
): number | null {
  if (api && !api.capped) return api.count;
  if (fromPage !== null) return fromPage;
  if (api?.capped) return api.count;
  return null;
}
