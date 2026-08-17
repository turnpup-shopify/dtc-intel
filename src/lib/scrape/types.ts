/** Spec §6.1 — the adapter boundary. Do not hard-code a vendor above this line. */

export interface ScrapeResult {
  html: string;
  /** Full-page screenshot. Empty buffer when the provider can't produce one. */
  screenshotBuffer: Buffer;
  /** Final URL after redirects. */
  finalUrl: string;
  statusCode: number;
}

export interface ScrollOptions {
  /** Maximum scroll actions. Must fit the provider's scenario time budget. */
  maxScrolls: number;
  /** Pause between scrolls, in ms, so the loader has time to append. */
  delayMs: number;
  /**
   * Text of a "load more" control to click when the page bottom is reached.
   * Off by default: a selector that matches nothing may fail the whole call,
   * and an incomplete harvest is caught by reconciliation anyway.
   */
  endClickText?: string;
}

export interface ScrapeAdapter {
  readonly name: string;
  fetch(url: string): Promise<ScrapeResult>;
  /**
   * Render a lazily-paginated list, scrolling until it stops growing.
   *
   * Optional capability: the plain-fetch adapter has no browser and cannot do
   * this at all, so callers must check for it rather than assume it. Screenshots
   * are skipped here — this path exists to read a list, not to picture it.
   */
  fetchScrolled?(url: string, opts: ScrollOptions): Promise<ScrapeResult>;
}

export class ScrapeError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}
