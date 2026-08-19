"use client";

import { useEffect, useState } from "react";
import { AUTOMATIC, SILENT_DROPS, SPEC_UPDATED, STAGES } from "@/lib/flow-spec";

/**
 * The spec, one click away on every screen.
 *
 * Lives in the app rather than a document because the questions it answers —
 * where do I run this, why is that empty, what does "rejected" mean — get asked
 * while looking at the screen, not while reading a wiki. Content comes from
 * lib/flow-spec.ts, which is committed alongside the code it describes.
 */
export default function FlowMenu() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="How this app works"
        title="How this app works"
        className="flex flex-col justify-center gap-[3px] px-2 py-1.5 rounded hover:bg-white/5"
        style={{ width: 30 }}
      >
        <span style={{ height: 1.5, background: "currentColor", display: "block" }} />
        <span style={{ height: 1.5, background: "currentColor", display: "block" }} />
        <span style={{ height: 1.5, background: "currentColor", display: "block" }} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: "rgba(0,0,0,.55)" }}
          onClick={() => setOpen(false)}
        >
          <aside
            className="h-full overflow-y-auto"
            style={{
              width: "min(680px, 100%)",
              background: "var(--bg)",
              borderLeft: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sticky top-0 flex items-baseline gap-3 px-5 py-3 border-b"
              style={{ background: "var(--bg)", borderColor: "var(--border)" }}
            >
              <h2 className="text-sm font-medium">How this app works</h2>
              <span className="muted text-xs">updated {SPEC_UPDATED}</span>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto text-xs px-2 py-1 rounded"
                style={{ background: "var(--panel-2)" }}
              >
                Close
              </button>
            </div>

            <div className="px-5 py-4 space-y-5 text-sm">
              <p className="muted" style={{ maxWidth: "62ch" }}>
                Five stages, in order. Each one produces the input for the next, and nothing skips
                ahead — a page only becomes searchable by passing through all five.
              </p>

              {STAGES.map((stage) => (
                <section
                  key={stage.id}
                  className="panel p-4"
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-medium">{stage.title}</h3>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded font-mono"
                      style={{ background: "var(--panel-2)", color: "var(--accent)" }}
                    >
                      {stage.where}
                    </span>
                  </div>

                  <p className="muted text-xs">{stage.purpose}</p>

                  <ol className="ml-4 list-decimal space-y-1 text-xs">
                    {stage.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>

                  {stage.writes.length > 0 && (
                    <p className="muted text-xs font-mono">writes: {stage.writes.join(", ")}</p>
                  )}

                  {stage.gotcha && (
                    <p className="text-xs" style={{ color: "var(--warn)" }}>
                      {stage.gotcha}
                    </p>
                  )}
                </section>
              ))}

              <section className="panel p-4 space-y-2">
                <h3 className="font-medium text-sm">Runs on its own</h3>
                {AUTOMATIC.map((job) => (
                  <div key={job.name}>
                    <p className="text-xs">
                      <strong>{job.name}</strong>{" "}
                      <span className="muted font-mono">· {job.when}</span>
                    </p>
                    <p className="muted text-xs">{job.what}</p>
                  </div>
                ))}
              </section>

              <section className="panel p-4 space-y-2">
                <h3 className="font-medium text-sm">Where things vanish without an error</h3>
                <p className="muted text-xs">
                  All of these are deliberate. All of them look like a bug from the outside, which
                  is why they are worth knowing.
                </p>
                <ul className="ml-4 list-disc space-y-1 text-xs muted">
                  {SILENT_DROPS.map((drop) => (
                    <li key={drop}>{drop}</li>
                  ))}
                </ul>
                <p className="text-xs">
                  <a href="/diagnostics" style={{ color: "var(--accent)" }} className="hover:underline">
                    Diagnostics
                  </a>{" "}
                  <span className="muted">
                    reports which of these you are actually hitting, plus any migration the
                    database is missing.
                  </span>
                </p>
              </section>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
