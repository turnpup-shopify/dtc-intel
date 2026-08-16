"use client";

import { useCallback, useEffect, useState } from "react";

interface Hook {
  id: string;
  companyName: string | null;
  displayTitle: string;
  variantCount: number;
  peakVariantCount: number;
  daysRunning: number;
  snapshotUrl: string | null;
  status: string;
}

/**
 * Ranked ad headlines, budget concentration first, longevity second.
 *
 * Both signals accumulate from our own polling history — there is no
 * server-side longevity filter — so this queue is weak for roughly the first
 * six weeks and strong afterwards. Don't judge it on its first fortnight.
 */
export default function HooksClient() {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/hooks");
    const data = await res.json();
    setHooks(data.hooks ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const notify = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 2500);
  };

  async function convert(hook: Hook) {
    const url = (drafts[hook.id] ?? "").trim();
    if (!url) return;
    setBusy(hook.id);

    const res = await fetch(`/api/hooks/${hook.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resulting_url: url }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      notify(body.error ?? "Capture failed");
      return;
    }
    const page = body.page ?? {};
    notify(
      page.unchanged
        ? "Converted · page unchanged since last capture"
        : page.status === "discarded"
          ? `Converted · auto-rejected at ${page.composite?.toFixed(2)}`
          : `Converted · queued at ${page.composite?.toFixed(2)}`
    );
    setHooks((prev) => prev.filter((h) => h.id !== hook.id));
  }

  async function mark(hook: Hook, status: "clicked" | "dismissed") {
    setBusy(hook.id);
    await fetch(`/api/hooks/${hook.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null);

    // `clicked` is a breadcrumb, not a decision — the row has to stay put,
    // because the paste-back field is where the human is headed next.
    if (status === "dismissed") {
      setHooks((prev) => prev.filter((h) => h.id !== hook.id));
    } else {
      setHooks((prev) => prev.map((h) => (h.id === hook.id ? { ...h, status } : h)));
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-baseline gap-3 mb-3">
        <h1 className="text-sm font-medium">Hooks queue</h1>
        <span className="muted text-xs">
          Ranked by concurrent variants, then days running. Click the snapshot, land on the
          page, paste the URL back.
        </span>
        {flash && (
          <span className="text-xs ml-auto" style={{ color: "var(--accent)" }}>
            {flash}
          </span>
        )}
      </div>

      {loading ? (
        <p className="muted text-sm">Loading…</p>
      ) : hooks.length === 0 ? (
        <p className="muted text-sm">
          No new hooks. The daily poll fills this once companies have a meta_page_id.
        </p>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left muted text-xs border-b" style={{ borderColor: "var(--border)" }}>
                <th className="px-3 py-2 font-normal">Brand</th>
                <th className="px-3 py-2 font-normal">Headline</th>
                <th className="px-3 py-2 font-normal text-right">Variants</th>
                <th className="px-3 py-2 font-normal text-right">Days</th>
                <th className="px-3 py-2 font-normal">Snapshot</th>
                <th className="px-3 py-2 font-normal">Landing page URL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {hooks.map((hook) => (
                <tr key={hook.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-3 py-2 whitespace-nowrap">{hook.companyName ?? "—"}</td>
                  <td className="px-3 py-2 max-w-md">{hook.displayTitle}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {hook.variantCount}
                    {hook.peakVariantCount > hook.variantCount && (
                      <span className="muted text-xs"> /{hook.peakVariantCount}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{hook.daysRunning}</td>
                  <td className="px-3 py-2">
                    {hook.snapshotUrl ? (
                      <a
                        href={hook.snapshotUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs hover:underline"
                        style={{ color: "var(--accent)" }}
                        onClick={() => void mark(hook, "clicked")}
                      >
                        open ↗
                      </a>
                    ) : (
                      <span className="muted text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="text-xs w-64"
                      placeholder="paste LP url…"
                      value={drafts[hook.id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [hook.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void convert(hook);
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      onClick={() => void convert(hook)}
                      disabled={busy === hook.id || !(drafts[hook.id] ?? "").trim()}
                      className="text-xs px-2 py-1 rounded disabled:opacity-40"
                      style={{ background: "var(--accent)", color: "#08130e" }}
                    >
                      {busy === hook.id ? "…" : "Capture"}
                    </button>
                    <button
                      onClick={() => void mark(hook, "dismissed")}
                      disabled={busy === hook.id}
                      className="text-xs px-2 py-1 rounded ml-1"
                      style={{ background: "var(--panel-2)" }}
                    >
                      Dismiss
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
