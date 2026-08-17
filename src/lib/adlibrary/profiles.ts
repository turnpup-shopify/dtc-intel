/**
 * Scroll profiles for harvesting the Ad Library, and the ceiling they must fit.
 *
 * ScrapingBee caps total js_scenario execution at 40 seconds. That is a hard
 * provider limit, not a tuning knob: exceed it and the call fails outright
 * rather than returning what it managed to load. The first version of this
 * harvester asked for 96 seconds of scrolling and simply broke.
 *
 * Kept in their own module so the arithmetic can be unit-tested. If someone
 * later raises a scroll count to chase a stubborn advertiser, the test fails
 * before the API does.
 */

export interface ScrollProfile {
  maxScrolls: number;
  delayMs: number;
}

/** Provider ceiling for a whole js_scenario. */
export const SCENARIO_CAP_MS = 40_000;

/** Leave room for page load jitter rather than sailing right up to the cap. */
export const SAFETY_MARGIN_MS = 8_000;

/** Fixed wait before scrolling starts, giving the first batch time to render. */
export const INITIAL_WAIT_MS = 3_000;

/** Most advertisers: many quick scrolls. */
export const FAST_PASS: ScrollProfile = { maxScrolls: 60, delayMs: 400 };

/**
 * Retry profile. Deliberately NOT "more scrolling" — against a fixed time cap
 * that buys nothing. It trades scroll count for patience, for a loader that
 * stalled because each batch needed longer than 400ms to arrive.
 */
export const PATIENT_PASS: ScrollProfile = { maxScrolls: 30, delayMs: 900 };

/** Worst-case wall time a profile can consume inside the provider's scenario. */
export function scenarioBudgetMs(profile: ScrollProfile): number {
  return INITIAL_WAIT_MS + profile.maxScrolls * profile.delayMs;
}

export function fitsScenarioCap(profile: ScrollProfile): boolean {
  return scenarioBudgetMs(profile) <= SCENARIO_CAP_MS - SAFETY_MARGIN_MS;
}
