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
  /** How many lazy-load rounds to drive before returning. */
  rounds: number;
  /** Pause between rounds, in ms, so the loader has time to append. */
  delayMs: number;
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
