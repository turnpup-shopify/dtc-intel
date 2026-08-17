import type { AdCard } from "./parse";
import { normalizeDestination, type PageType } from "./normalize";

/**
 * Pure aggregation: cards in, deduped landing pages out. No network, no
 * database, no scraper — which is what makes every rule in here testable
 * without Meta in the loop. harvest.ts owns the I/O and calls into this.
 */

/** One unique landing page, already collapsed across every ad in this run. */
export interface HarvestRow {
  key: string;
  url: string;
  pageType: PageType;
  /** How many ads in THIS run point at this page. */
  adCount: number;
  exampleAdUrl: string;
  params: Record<string, string>;
}

export type Completeness = "complete" | "short" | "unverified";

/** Below this fraction of Meta's own estimate, the lazy-loader stalled on us. */
const COMPLETE_AT = 0.95;

export function isShort(harvested: number, estimate: number | null): boolean {
  return estimate !== null && estimate > 0 && harvested < estimate * COMPLETE_AT;
}

/**
 * Check the harvest against the count Meta printed itself.
 *
 * This is not optional. The Ad Library's lazy-loader fails silently: it stops
 * appending, the "See more" control disappears, and a half-loaded page is
 * indistinguishable from a finished one. A run that gets 80 of 120 ads doesn't
 * throw — it just reports numbers that are wrong in a way nothing downstream
 * can detect.
 */
export function reconcile(
  harvested: number,
  estimate: number | null
): { completeness: Completeness; warning: string | null } {
  if (estimate === null) {
    return {
      completeness: "unverified",
      warning:
        "Meta printed no result count on this page, so the harvest could not be checked " +
        "against anything. Treat these numbers as a floor, not a total.",
    };
  }
  if (isShort(harvested, estimate)) {
    return {
      completeness: "short",
      warning:
        `Harvested ${harvested} ads but Meta reports ~${estimate}. The lazy-loader stalled — ` +
        `every count below is understated. Re-run before drawing conclusions.`,
    };
  }
  return { completeness: "complete", warning: null };
}

/**
 * STAGE ONE of the merge: collapse duplicates WITHIN this run.
 *
 * This has to happen before anything touches the registry. Many ads legitimately
 * point at one landing page, and if each were merged separately then runs_seen
 * would climb once per ad instead of once per run — two runs reporting five.
 * Collapsing first makes the registry merge a one-row-per-page operation.
 */
export function collapse(cards: AdCard[]): HarvestRow[] {
  const byKey = new Map<string, HarvestRow>();

  for (const card of cards) {
    if (!card.destinationUrl) continue;
    const norm = normalizeDestination(card.destinationUrl);
    if (!norm) continue;

    const existing = byKey.get(norm.key);
    if (existing) {
      existing.adCount += 1;
      // Keep any params we have seen; later ads often carry richer tagging.
      for (const [k, v] of Object.entries(norm.params)) existing.params[k] ??= v;
      continue;
    }

    byKey.set(norm.key, {
      key: norm.key,
      url: norm.url,
      pageType: norm.pageType,
      adCount: 1,
      exampleAdUrl: card.snapshotUrl,
      params: { ...norm.params },
    });
  }

  return Array.from(byKey.values()).sort((a, b) => b.adCount - a.adCount);
}
