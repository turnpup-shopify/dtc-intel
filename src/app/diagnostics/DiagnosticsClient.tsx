"use client";

import { useCallback, useEffect, useState } from "react";
import ScoreGate from "@/components/ScoreGate";
import { errorMessage, getJson } from "@/lib/client";

interface Run {
  id: string;
  kind: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string;
  summary: Record<string, unknown>;
  warning: string | null;
  error: string | null;
  subject: string | null;
  companyName: string | null;
}

interface State {
  companies: number | null;
  companiesActive: number | null;
  companiesMapped: number | null;
  adsActive: number | null;
  hooksNew: number | null;
  hooksConverted: number | null;
  pagesQueued: number | null;
  pagesSaved: number | null;
  pagesDiscarded: number | null;
  landingPages: number | null;
  landingLive: number | null;
}

type Health = Record<string, unknown> & { ok?: boolean; env?: Record<string, string> };

interface PendingMigration {
  migration: string;
  feature: string;
  missing: string;
}

const KINDS: Record<string, string> = {
  ad_poll: "Ad poll",
  lp_harvest: "LP harvest",
  sitemap_diff: "Sitemap diff",
  page_capture: "Page capture",
};

/**
 * Diagnostics: is this thing configured, is it producing anything, and what
 * happened the last time it ran.
 *
 * Ordered by how early a problem stops everything downstream — configuration
 * first, then whether the database holds anything worth reading, then the run
 * history. A missing env var makes every number below it meaningless, so it
 * gets read first.
 */
export default function DiagnosticsClient() {
  const [health, setHealth] = useState<Health | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [pending, setPending] = useState<PendingMigration[]>([]);
  const [runLogMissing, setRunLogMissing] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setDataError(null);

    // Health is fetched raw: it answers with 503 precisely when it has the most
    // to say, and throwing that away would hide the actual diagnosis.
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setHealth((await res.json()) as Health);
    } catch (err) {
      setHealth({ ok: false, error: errorMessage(err) });
    }

    try {
      const qs = new URLSearchParams();
      if (kind) qs.set("kind", kind);
      if (problemsOnly) qs.set("problems", "1");
      const data = await getJson<{
        runs: Run[];
        state: State;
        pendingMigrations: PendingMigration[];
        runLogMissing?: boolean;
      }>(`/api/diagnostics?${qs}`);
      setRuns(data.runs ?? []);
      setState(data.state ?? null);
      setPending(data.pendingMigrations ?? []);
      setRunLogMissing(Boolean(data.runLogMissing));
    } catch (err) {
      setDataError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [kind, problemsOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const problems = runs.filter((r) => r.status !== "ok" && r.status !== "running");

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-sm font-medium">Diagnostics</h1>
        <span className="muted text-xs">
          Configuration, what&apos;s in the database, and every job this app has run.
        </span>
        <button
          onClick={() => void load()}
          className="text-xs px-3 py-1.5 rounded ml-auto"
          style={{ background: "var(--panel-2)" }}
        >
          Refresh
        </button>
      </div>

      {pending.length > 0 && (
        <section className="panel p-3" style={{ borderColor: "var(--warn)" }}>
          <h2 className="text-xs font-medium mb-2" style={{ color: "var(--warn)" }}>
            {pending.length} migration{pending.length === 1 ? "" : "s"} not applied
          </h2>
          <p className="muted text-xs mb-2" style={{ maxWidth: "72ch" }}>
            The deployed code is ahead of the database. Features below are switched off rather
            than broken — the screens that use them fall back and keep working. Run these in the
            Supabase SQL editor, in order.
          </p>
          <table className="text-xs">
            <tbody>
              {pending.map((m) => (
                <tr key={m.migration}>
                  <td className="pr-6 py-0.5 font-mono" style={{ color: "var(--warn)" }}>
                    {m.migration}
                  </td>
                  <td className="pr-6 py-0.5 muted font-mono">missing {m.missing}</td>
                  <td className="py-0.5 muted">disables {m.feature}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── 1. Configuration ─────────────────────────────────────────────── */}
      <section className="panel p-3">
        <h2 className="text-xs font-medium mb-2">
          Configuration{" "}
          <span style={{ color: configVerdict(health).color }}>{configVerdict(health).label}</span>
        </h2>
        {!health ? (
          <p className="muted text-xs">Checking…</p>
        ) : (
          <table className="text-xs">
            <tbody>
              {Object.entries((health.env ?? {}) as Record<string, string>).map(([k, v]) => (
                <tr key={k}>
                  <td className="pr-6 py-0.5 muted align-top">{k}</td>
                  <td
                    className="py-0.5 font-mono"
                    style={{ color: /missing|unset|disabled/.test(String(v)) ? "var(--warn)" : undefined }}
                  >
                    {String(v)}
                  </td>
                </tr>
              ))}
              {["database", "companies", "queuedPages", "warning", "nextStep"].map((k) =>
                health[k] === undefined ? null : (
                  <tr key={k}>
                    <td className="pr-6 py-0.5 muted align-top">{k}</td>
                    <td
                      className="py-0.5 font-mono"
                      style={{ color: k === "warning" || k === "nextStep" ? "var(--warn)" : undefined }}
                    >
                      {String(health[k])}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </section>

      {/* ── 2. What's actually in there ──────────────────────────────────── */}
      <section className="panel p-3">
        <h2 className="text-xs font-medium mb-2">Pipeline state</h2>
        {dataError ? (
          <p className="text-xs" style={{ color: "var(--danger)" }}>
            {dataError}
          </p>
        ) : !state ? (
          <p className="muted text-xs">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
              <Stat label="brands active" value={state.companiesActive} />
              <Stat
                label="with page_id"
                value={state.companiesMapped}
                warn={
                  state.companiesMapped !== null &&
                  state.companiesActive !== null &&
                  state.companiesMapped < state.companiesActive
                }
                note={
                  state.companiesActive
                    ? `${state.companiesActive - (state.companiesMapped ?? 0)} can't be polled`
                    : undefined
                }
              />
              <Stat label="ads live" value={state.adsActive} warn={state.adsActive === 0} />
              <Stat label="hooks waiting" value={state.hooksNew} />
              <Stat label="hooks converted" value={state.hooksConverted} />
              <Stat label="landing pages" value={state.landingPages} />
              <Stat label="…running ads now" value={state.landingLive} />
              <Stat label="pages to review" value={state.pagesQueued} />
              <Stat label="pages saved" value={state.pagesSaved} />
              <Stat label="auto-discarded" value={state.pagesDiscarded} />
            </div>
            {state.companiesMapped === 0 && (
              <p className="text-xs mt-3" style={{ color: "var(--warn)" }}>
                No brand has a meta_page_id, so the poll and the harvester have nothing to read.
                Add one on Companies.
              </p>
            )}
            {state.adsActive === 0 && (state.companiesMapped ?? 0) > 0 && (
              <p className="text-xs mt-3" style={{ color: "var(--warn)" }}>
                Brands are mapped but no live ads are stored. Either the poll has never run, or
                META_ACCESS_TOKEN is rejected — the run log below will say which.
              </p>
            )}
          </>
        )}
      </section>

      {/* ── 3. The one knob ──────────────────────────────────────────────── */}
      <ScoreGate />

      {/* ── 4. What it did ───────────────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="flex items-center gap-2 p-3 text-xs">
          <h2 className="font-medium">Run log</h2>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="text-xs ml-2">
            <option value="">All jobs</option>
            {Object.entries(KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 muted">
            <input
              type="checkbox"
              checked={problemsOnly}
              onChange={(e) => setProblemsOnly(e.target.checked)}
            />
            problems only
          </label>
          <span className="muted ml-auto">
            {problems.length > 0 ? (
              <span style={{ color: "var(--warn)" }}>
                {problems.length} of the last {runs.length} runs need a look
              </span>
            ) : runs.length > 0 ? (
              `${runs.length} runs, all clean`
            ) : (
              ""
            )}
          </span>
        </div>

        {loading ? (
          <p className="muted text-sm px-3 pb-3">Loading…</p>
        ) : runLogMissing ? (
          <p className="text-sm px-3 pb-3" style={{ color: "var(--warn)", maxWidth: "72ch" }}>
            No run log table. Jobs are still running and still working — they just are not being
            recorded. Apply 0006_run_log.sql and the next run shows up here.
          </p>
        ) : runs.length === 0 ? (
          <p className="muted text-sm px-3 pb-3">
            Nothing logged yet. Runs appear here after a poll, a harvest, a sitemap sweep, or a
            page capture. If you ran one before applying migration 0006, it did the work but
            wasn&apos;t recorded.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left muted text-xs border-b" style={{ borderColor: "var(--border)" }}>
                <th className="px-3 py-2 font-normal">When</th>
                <th className="px-3 py-2 font-normal">Job</th>
                <th className="px-3 py-2 font-normal">Subject</th>
                <th className="px-3 py-2 font-normal text-right">Took</th>
                <th className="px-3 py-2 font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className="border-b cursor-pointer hover:bg-white/5"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                >
                  <td className="px-3 py-2 whitespace-nowrap muted text-xs">
                    {new Date(r.started_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {KINDS[r.kind] ?? r.kind}
                    {r.trigger === "cron" && <span className="muted text-xs"> · cron</span>}
                  </td>
                  <td className="px-3 py-2 max-w-md truncate muted text-xs">
                    {r.companyName ?? r.subject ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums muted text-xs">
                    {r.duration_ms === null ? "—" : `${(r.duration_ms / 1000).toFixed(1)}s`}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: statusColor(r.status) }}>
                    <div>{statusLabel(r)}</div>
                    {expanded === r.id && (
                      <div className="mt-2 space-y-1 font-mono" style={{ color: "var(--muted)" }}>
                        {Object.entries(r.summary ?? {}).map(([k, v]) => (
                          <div key={k}>
                            {k}: {v === null ? "—" : String(v)}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
  note,
}: {
  label: string;
  value: number | null;
  warn?: boolean;
  note?: string;
}) {
  return (
    <div>
      <div
        className="text-lg tabular-nums"
        style={{ color: warn ? "var(--warn)" : undefined }}
      >
        {value === null ? "—" : value}
      </div>
      <div className="muted">{label}</div>
      {note && <div className="muted text-[11px]">{note}</div>}
    </div>
  );
}

/**
 * The header has to agree with the rows underneath it. /api/health reports ok
 * when the app can *run* — a missing META_ACCESS_TOKEN doesn't stop it booting,
 * it just silently disables the poll. Saying "ok" above an amber row trains you
 * to skim past exactly the line that matters.
 */
function configVerdict(health: Health | null): { label: string; color: string } {
  if (!health) return { label: "", color: "var(--muted)" };
  if (!health.ok) return { label: "· needs attention", color: "var(--danger)" };

  const partial = Object.values(health.env ?? {}).some((v) => /missing|unset/.test(String(v)));
  return partial
    ? { label: "· running, some features off", color: "var(--warn)" }
    : { label: "· ok", color: "var(--accent)" };
}

function statusLabel(r: Run): string {
  if (r.status === "error") return r.error ?? "failed";
  if (r.status === "stalled") return r.error ?? "stalled";
  if (r.status === "warning") return r.warning ?? "completed with warnings";
  if (r.status === "running") return "running…";
  return "ok";
}

function statusColor(status: string): string {
  if (status === "error" || status === "stalled") return "var(--danger)";
  if (status === "warning") return "var(--warn)";
  if (status === "running") return "var(--muted)";
  return "var(--muted)";
}
