import type { PipelineResult } from "./pipeline";

/**
 * How to read the outcome of a single page capture.
 *
 * The distinction that matters: a page scored low and auto-discarded is the
 * pipeline WORKING — that gate exists to keep junk out of the review queue, and
 * logging it as a failure would bury the real ones. A page that couldn't be
 * fetched, or came back with almost no text because it hit a bot wall, is a
 * genuine failure and reads as one.
 *
 * processUrl reports failure by RETURNING it rather than throwing, so the
 * message has to be lifted out here or it never reaches the log.
 */
export function classifyCapture(r: PipelineResult) {
  const summary = {
    url: r.url,
    outcome: r.ok ? (r.unchanged ? "unchanged" : (r.status ?? "captured")) : "failed",
    composite: r.composite ?? null,
  };

  return r.ok
    ? { status: "ok" as const, summary }
    : { status: "error" as const, summary, error: r.error ?? "capture failed" };
}
