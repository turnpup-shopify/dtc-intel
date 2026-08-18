"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Remove-row control: a circled minus that arms on first click and acts on the
 * second.
 *
 * Two clicks rather than a modal. Row deletes are frequent and mostly trivial,
 * and a dialog for each one trains people to dismiss dialogs. Arming disarms
 * itself after a few seconds, so a stray click never leaves a live trigger
 * sitting under the cursor.
 *
 * `warn` is for the cases that take other data with them — deleting a brand
 * removes its ads, hooks and landing pages too. Those say what will happen in
 * the armed state instead of just turning red.
 */
export default function RowDelete({
  onConfirm,
  title,
  armedLabel = "Remove?",
  warn = false,
}: {
  onConfirm: () => void | Promise<void>;
  /** Tooltip on the resting state. Say what removal means here. */
  title: string;
  armedLabel?: string;
  warn?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function disarmLater() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), 4000);
  }

  async function click() {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      disarmLater();
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  if (armed) {
    return (
      <button
        onClick={() => void click()}
        onBlur={() => setArmed(false)}
        disabled={busy}
        autoFocus
        className="text-xs px-2 py-1 rounded whitespace-nowrap disabled:opacity-50"
        style={{
          background: warn ? "var(--danger)" : "var(--panel-2)",
          color: warn ? "#fff" : "var(--danger)",
          border: `1px solid var(--danger)`,
        }}
      >
        {busy ? "…" : armedLabel}
      </button>
    );
  }

  return (
    <button
      onClick={() => void click()}
      title={title}
      aria-label={title}
      className="rounded-full flex items-center justify-center transition-colors"
      style={{
        width: 20,
        height: 20,
        lineHeight: 1,
        border: "1px solid var(--border)",
        background: "transparent",
        color: "var(--muted)",
        fontSize: 14,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--danger)";
        e.currentTarget.style.color = "var(--danger)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.color = "var(--muted)";
      }}
    >
      −
    </button>
  );
}
