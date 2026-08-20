"use client";

import { useEffect, useState } from "react";
import { errorMessage, getJson, postJson } from "@/lib/client";

interface Threshold {
  value: number;
  source: "database" | "environment" | "default";
  storageAvailable: boolean;
}

const SOURCE_NOTE: Record<Threshold["source"], string> = {
  database: "set here — this overrides both the environment variable and the code default",
  environment: "coming from the SCORE_THRESHOLD environment variable",
  default: "the built-in default; nothing has overridden it",
};

/**
 * The one number worth tuning from inside the app.
 *
 * It is the difference between a full review queue and an empty one, and it is
 * calibrated by looking at the scores you actually get — which means adjusting
 * it, capturing a few pages, and adjusting again. Behind an env var that loop
 * costs a Vercel edit and a redeploy each time round, so in practice it never
 * gets tuned; it just stays wrong. Saving here takes effect on the next capture.
 *
 * The source line matters as much as the number: a SCORE_THRESHOLD left over in
 * Vercel outranks any later change to the code default, and that mismatch is
 * invisible until you can see which one is actually in force.
 */
export default function ScoreGate() {
  const [current, setCurrent] = useState<Threshold | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await getJson<{ scoreThreshold: Threshold }>("/api/settings");
        setCurrent(data.scoreThreshold);
        setDraft(String(data.scoreThreshold.value));
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, []);

  async function save(value: number | null) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const data = await postJson<{ scoreThreshold: Threshold }>("/api/settings", {
        scoreThreshold: value,
      });
      setCurrent(data.scoreThreshold);
      setDraft(String(data.scoreThreshold.value));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const parsed = Number(draft);
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= 5;
  const changed = current !== null && parsed !== current.value;

  return (
    <section className="panel p-3">
      <h2 className="text-xs font-medium mb-2">Score gate</h2>
      <p className="muted text-xs mb-3" style={{ maxWidth: "72ch" }}>
        A captured page scoring below this is auto-discarded and never reaches Review. It exists
        to keep junk out — bot walls, checkout pages, blank renders — not to judge quality; stars
        in Review do that. Composite runs 1–5 and an ordinary DTC page lands near 2.75, so a gate
        much above that rejects everything.
      </p>

      {!current ? (
        <p className="muted text-xs">{error ?? "Loading…"}</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs">
            <input
              type="number"
              step="0.1"
              min="1"
              max="5"
              value={draft}
              disabled={busy}
              onChange={(e) => {
                setDraft(e.target.value);
                setSaved(false);
              }}
              className="w-20 px-2 py-1 rounded tabular-nums"
              style={{ background: "var(--panel-2)" }}
            />
            <button
              onClick={() => void save(parsed)}
              disabled={busy || !valid || !changed}
              className="px-3 py-1 rounded"
              style={{ background: "var(--panel-2)", opacity: busy || !valid || !changed ? 0.4 : 1 }}
            >
              Save
            </button>
            {current.source === "database" && (
              <button
                onClick={() => void save(null)}
                disabled={busy}
                className="px-3 py-1 rounded muted"
                style={{ background: "var(--panel-2)" }}
                title="Delete the stored value and fall back to SCORE_THRESHOLD, then the code default."
              >
                Clear override
              </button>
            )}
            <span className="muted ml-2">
              in force: <span className="tabular-nums">{current.value}</span> ·{" "}
              {SOURCE_NOTE[current.source]}
            </span>
          </div>

          {!valid && draft !== "" && (
            <p className="text-xs mt-2" style={{ color: "var(--warn)" }}>
              Must be between 1 and 5.
            </p>
          )}
          {saved && !error && (
            <p className="text-xs mt-2" style={{ color: "var(--accent)" }}>
              Saved. Applies to the next capture — pages already discarded stay discarded until
              they are captured again.
            </p>
          )}
          {error && (
            <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          {!current.storageAvailable && (
            <p className="text-xs mt-2" style={{ color: "var(--warn)" }}>
              No app_settings table yet, so the value can be read but not changed. Run
              0014_app_settings.sql in the Supabase SQL editor.
            </p>
          )}
        </>
      )}
    </section>
  );
}
