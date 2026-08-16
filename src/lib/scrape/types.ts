/** Spec §6.1 — the adapter boundary. Do not hard-code a vendor above this line. */

export interface ScrapeResult {
  html: string;
  /** Full-page screenshot. Empty buffer when the provider can't produce one. */
  screenshotBuffer: Buffer;
  /** Final URL after redirects. */
  finalUrl: string;
  statusCode: number;
}

export interface ScrapeAdapter {
  readonly name: string;
  fetch(url: string): Promise<ScrapeResult>;
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
