"use client";

import { useCallback, useEffect, useState } from "react";
import { clear, entries, subscribe, type LogEntry } from "@/lib/logbook";

const COLOR: Record<string, string> = {
  api: "var(--danger)",
  network: "var(--danger)",
  crash: "var(--danger)",
  note: "var(--muted)",
};

/**
 * What has gone wrong, and a button that turns it into something you can paste.
 *
 * The report is the point. Diagnosing this app remotely has meant asking for
 * one number at a time — is the table there, what does the run log say, how
 * many are queued — with a redeploy between each guess. This gathers all of it
 * in one go: config, pipeline counts, missing migrations, and the last faults
 * the browser saw.
 */
export default function LogPanel() {
  const [items, setItems] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const refresh = useCallback(() => setItems([...entries()]), []);

  useEffect(() => {
    refresh();
    return subscribe(refresh);
  }, [refresh]);

  async function copyReport() {
    setBuilding(true);
    setCopied(null);
    try {
      const [health, diag, settings] = await Promise.all([
        fetch("/api/health", { cache: "no-store" })
          .then((r) => r.json())
          .catch((e) => ({ unreachable: String(e) })),
        fetch("/api/diagnostics", { cache: "no-store" })
          .then((r) => r.json())
          .catch((e) => ({ unreachable: String(e) })),
        fetch("/api/settings", { cache: "no-store" })
          .then((r) => r.json())
          .catch((e) => ({ unreachable: String(e) })),
      ]);

      // Worth its own line rather than being buried in config: "everything is
      // getting rejected" is the most common complaint, and the answer is
      // usually the gate's value together with which source set it.
      const gate = settings?.scoreThreshold as
        | { value: number; source: string; storageAvailable: boolean }
        | undefined;

      const report = [
        `# dtc-intel report · ${new Date().toISOString()}`,
        ``,
        `## Configuration`,
        "```json",
        JSON.stringify(health, null, 2),
        "```",
        ``,
        `## Score gate`,
        gate ? `- ${gate.value} (from ${gate.source})` : `- unavailable`,
        ``,
        `## Pipeline state`,
        "```json",
        JSON.stringify(diag?.state ?? null, null, 2),
        "```",
        ``,
        `## Migrations not applied`,
        (diag?.pendingMigrations ?? []).length
          ? (diag.pendingMigrations as { migration: string; missing: string }[])
              .map((m) => `- ${m.migration} (missing ${m.missing})`)
              .join("\n")
          : "- none detected",
        ``,
        `## Recent job runs`,
        (diag?.runs ?? []).length
          ? (diag.runs as { kind: string; status: string; subject?: string; warning?: string; error?: string }[])
              .slice(0, 12)
              .map(
                (r) =>
                  `- ${r.kind} · ${r.status}${r.subject ? ` · ${r.subject}` : ""}${
                    r.error ? ` · ${r.error}` : r.warning ? ` · ${r.warning}` : ""
                  }`
              )
              .join("\n")
          : "- none (run log empty or table missing)",
        ``,
        `## Browser faults (newest first)`,
        items.length
          ? items
              .slice(0, 25)
              .map(
                (e) =>
                  `- ${e.at} · ${e.kind} · ${e.where}\n  ${e.message}${
                    e.detail ? `\n  ${e.detail}` : ""
                  }`
              )
              .join("\n")
          : "- none recorded",
        ``,
      ].join("\n");

      await navigator.clipboard.writeText(report);
      setCopied(`Copied ${report.length.toLocaleString()} characters. Paste it into the chat.`);
    } catch (err) {
      setCopied(`Could not copy: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="panel p-4 space-y-2">
        <h3 className="font-medium text-sm">Something not working?</h3>
        <p className="muted text-xs" style={{ maxWidth: "62ch" }}>
          This builds one report with everything needed to diagnose it — configuration, what is
          in the database, any migration the schema is missing, recent job runs, and the faults
          this browser has seen. Paste it into the chat rather than describing the symptom.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void copyReport()}
            disabled={building}
            className="text-xs px-3 py-1.5 rounded disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#08130e" }}
          >
            {building ? "Gathering…" : "Copy report"}
          </button>
          {copied && <span className="muted text-xs">{copied}</span>}
        </div>
      </div>

      <div className="flex items-baseline gap-3">
        <h3 className="font-medium text-sm">Browser faults</h3>
        <span className="muted text-xs">
          {items.length === 0 ? "nothing recorded" : `${items.length} recorded, newest first`}
        </span>
        {items.length > 0 && (
          <button onClick={clear} className="ml-auto muted text-xs hover:underline">
            clear
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="muted text-xs" style={{ maxWidth: "62ch" }}>
          Every failed request, unreachable server and uncaught crash lands here automatically,
          and survives a reload. Empty is good — it means nothing has failed in this browser
          since the log was last cleared.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((e, i) => (
            <div key={`${e.at}-${i}`} className="panel p-3 text-xs">
              <div className="flex gap-2 items-baseline">
                <span className="font-mono" style={{ color: COLOR[e.kind] ?? "var(--muted)" }}>
                  {e.kind}
                </span>
                <span className="muted font-mono truncate">{e.where}</span>
                <span className="muted ml-auto whitespace-nowrap">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
              </div>
              <p className="mt-1">{e.message}</p>
              {e.detail && (
                <pre
                  className="mt-1 font-mono whitespace-pre-wrap break-all muted"
                  style={{ fontSize: 10 }}
                >
                  {e.detail}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
