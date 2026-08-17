import { db } from "./supabase";

export type RunKind = "ad_poll" | "lp_harvest" | "sitemap_diff" | "page_capture";
export type RunStatus = "running" | "ok" | "warning" | "error";

export interface FinishOptions {
  status: RunStatus;
  summary?: Record<string, unknown>;
  warning?: string | null;
  error?: string | null;
}

/**
 * Job logging.
 *
 * ONE RULE ABOVE ALL: observing a job must never break it. Every function here
 * swallows its own failures and returns rather than throwing — a logging table
 * that takes down the daily poll because a column is missing would be worse
 * than no logging at all. That is also why startRun returns `null` on failure
 * and finishRun accepts a null id without complaint.
 */
export async function startRun(
  kind: RunKind,
  opts: { trigger?: "manual" | "cron"; companyId?: string | null; subject?: string | null } = {}
): Promise<string | null> {
  try {
    const { data, error } = await db()
      .from("run_log")
      .insert({
        kind,
        trigger: opts.trigger ?? "manual",
        company_id: opts.companyId ?? null,
        subject: opts.subject ?? null,
        status: "running",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return (data?.id as string) ?? null;
  } catch (err) {
    console.error("[runlog] could not open run", describe(err));
    return null;
  }
}

export async function finishRun(
  id: string | null,
  startedAtMs: number,
  opts: FinishOptions
): Promise<void> {
  if (!id) return;
  try {
    const finishedAt = new Date();
    const { error } = await db()
      .from("run_log")
      .update({
        finished_at: finishedAt.toISOString(),
        duration_ms: Date.now() - startedAtMs,
        status: opts.status,
        summary: opts.summary ?? {},
        warning: opts.warning ?? null,
        error: opts.error ?? null,
      })
      .eq("id", id);

    if (error) throw new Error(error.message);

    // Opportunistic retention. Cheap, and it means nothing extra to schedule.
    if (Math.random() < 0.02) await db().rpc("prune_run_log", { p_days: 90 });
  } catch (err) {
    console.error("[runlog] could not close run", describe(err));
  }
}

/**
 * Wrap a job so it is logged whether it succeeds, fails, or throws.
 *
 * `classify` lets a job report "completed but do not trust this" — the poll that
 * returned zero ads, the harvest that stalled. Those are the failures worth
 * catching, because they look exactly like success from the outside.
 */
export async function withRunLog<T>(
  kind: RunKind,
  opts: {
    trigger?: "manual" | "cron";
    companyId?: string | null;
    subject?: string | null;
    classify?: (result: T) => {
      status: RunStatus;
      summary?: Record<string, unknown>;
      warning?: string | null;
      /** For jobs that report failure by returning it rather than throwing. */
      error?: string | null;
    };
  },
  job: () => Promise<T>
): Promise<T> {
  const startedAtMs = Date.now();
  const id = await startRun(kind, opts);

  try {
    const result = await job();
    const verdict = opts.classify?.(result) ?? { status: "ok" as RunStatus };
    await finishRun(id, startedAtMs, {
      status: verdict.status,
      summary: verdict.summary,
      warning: verdict.warning ?? null,
      error: verdict.error ?? null,
    });
    return result;
  } catch (err) {
    await finishRun(id, startedAtMs, { status: "error", error: describe(err) });
    throw err;
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err ?? "unknown error");
}
