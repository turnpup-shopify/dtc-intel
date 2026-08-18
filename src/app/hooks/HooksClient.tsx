"use client";

import { useCallback, useEffect, useState } from "react";
import ErrorPanel from "@/components/ErrorPanel";
import RowDelete from "@/components/RowDelete";
import { deleteJson, errorMessage, getJson, postJson } from "@/lib/client";

interface Company {
  id: string;
  name: string;
  meta_page_id: string | null;
  active: boolean;
}

interface ScanRow {
  company: string;
  state: "queued" | "running" | "done" | "error";
  adsSeen?: number;
  headlines?: number;
  hooksTouched?: number;
  error?: string;
}

interface Hook {
  id: string;
  companyName: string | null;
  displayTitle: string;
  variantCount: number;
  peakVariantCount: number;
  daysRunning: number;
  snapshotUrl: string | null;
  creativeUrl: string | null;
  creativeAdId: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [scan, setScan] = useState<ScanRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson<{ hooks: Hook[] }>("/api/hooks");
      setHooks(data.hooks ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const notify = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 2500);
  };

  /**
   * Fill the queue by SCRAPING the Ad Library, not by calling its API.
   *
   * The API route still exists and still works if you hold a User or System
   * User token, but it refuses an app token outright, and it never had the
   * destination URL anyway. The scrape carries the headline, the snapshot link
   * and the ad id — everything the hook rollup reads — so this needs no Meta
   * credential at all.
   *
   * One brand per request, looped here, because scrolling an advertiser to the
   * bottom takes most of a minute and a single serverless call cannot hold the
   * whole set.
   */
  async function scanAds() {
    setPolling(true);
    try {
      const { companies } = await getJson<{ companies: Company[] }>("/api/companies");
      const targets = (companies ?? []).filter((c) => c.meta_page_id && c.active);

      if (targets.length === 0) {
        notify("No brand has a meta_page_id yet — add one on /companies.");
        return;
      }

      setScan(targets.map((t) => ({ company: t.name, state: "queued" as const })));

      for (let i = 0; i < targets.length; i++) {
        setScan((prev) => prev.map((r, idx) => (idx === i ? { ...r, state: "running" } : r)));
        try {
          const res = await postJson<{
            cardsHarvested: number;
            headlinesFound: number;
            hooksTouched: number;
          }>("/api/landing/harvest", { companyId: targets[i].id });

          setScan((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? {
                    ...r,
                    state: "done",
                    adsSeen: res.cardsHarvested,
                    headlines: res.headlinesFound,
                    hooksTouched: res.hooksTouched,
                  }
                : r
            )
          );
        } catch (err) {
          setScan((prev) =>
            prev.map((r, idx) =>
              idx === i ? { ...r, state: "error", error: errorMessage(err) } : r
            )
          );
        }
      }

      await load();
    } catch (err) {
      notify(errorMessage(err));
    } finally {
      setPolling(false);
    }
  }

  async function convert(hook: Hook) {
    const url = (drafts[hook.id] ?? "").trim();
    if (!url) return;
    setBusy(hook.id);

    let body: { page?: Record<string, unknown> };
    try {
      body = await postJson(`/api/hooks/${hook.id}`, { resulting_url: url });
    } catch (err) {
      setBusy(null);
      notify(errorMessage(err));
      return;
    }
    setBusy(null);
    const page = (body.page ?? {}) as { unchanged?: boolean; status?: string; composite?: number };
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
    try {
      await postJson(`/api/hooks/${hook.id}`, { status });
    } catch (err) {
      setBusy(null);
      notify(errorMessage(err));
      return;
    }
    setBusy(null);

    // `clicked` is a breadcrumb, not a decision — the row has to stay put,
    // because the paste-back field is where the human is headed next.
    if (status === "dismissed") {
      setHooks((prev) => prev.filter((h) => h.id !== hook.id));
    } else {
      setHooks((prev) => prev.map((h) => (h.id === hook.id ? { ...h, status } : h)));
    }
  }

  if (error) return <ErrorPanel error={error} onRetry={() => void load()} />;

  return (
    <div className="p-4">
      <div className="flex items-baseline gap-3 mb-3">
        <h1 className="text-sm font-medium">Hooks queue</h1>
        <span className="muted text-xs">
          Ranked by concurrent variants, then days running. Click the snapshot, land on the
          page, paste the URL back.
        </span>
        {flash && (
          <span className="text-xs" style={{ color: "var(--accent)" }}>
            {flash}
          </span>
        )}
        <button
          onClick={() => void scanAds()}
          disabled={polling}
          className="text-xs px-3 py-1.5 rounded ml-auto disabled:opacity-50"
          style={{ background: "var(--panel-2)" }}
          title="Scrape each seeded brand's live ads from the public Ad Library. No Meta credential needed."
        >
          {polling ? "Scanning…" : "Scan ads"}
        </button>
      </div>

      {scan.length > 0 && (
        <div className="panel p-3 mb-3 text-xs">
          <div className="flex gap-4">
            <span>
              <span className="muted">ads seen</span>{" "}
              <span className="tabular-nums">
                {scan.reduce((n, r) => n + (r.adsSeen ?? 0), 0)}
              </span>
            </span>
            <span>
              <span className="muted">hooks built</span>{" "}
              <span className="tabular-nums">
                {scan.reduce((n, r) => n + (r.hooksTouched ?? 0), 0)}
              </span>
            </span>
            <button onClick={() => setScan([])} className="ml-auto muted hover:underline">
              dismiss
            </button>
          </div>

          <table className="mt-2 w-full">
            <tbody>
              {scan.map((r) => (
                <tr key={r.company}>
                  <td className="py-0.5 pr-4">{r.company}</td>
                  <td className="py-0.5 pr-4 tabular-nums muted">
                    {r.state === "done" ? `${r.adsSeen} ads` : r.state === "running" ? "…" : ""}
                  </td>
                  <td
                    className="py-0.5"
                    style={{ color: r.error ? "var(--danger)" : "var(--muted)" }}
                  >
                    {r.error ??
                      (r.state === "done"
                        ? `${r.hooksTouched} hooks` +
                          // A gap here means the headline sat somewhere the parser
                          // couldn't isolate. Those ads still count as landing
                          // pages; they just can't be ranked as hooks.
                          (r.adsSeen && r.headlines !== undefined && r.headlines < r.adsSeen
                            ? ` · ${r.adsSeen - r.headlines} ads had no readable headline`
                            : "")
                        : r.state)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading ? (
        <p className="muted text-sm">Loading…</p>
      ) : hooks.length === 0 ? (
        <div className="muted text-sm">
          <p>No hooks yet. Two things have to be true before this fills:</p>
          <ol className="mt-2 ml-4 list-decimal space-y-1">
            <li>
              At least one brand has a <code>meta_page_id</code> on{" "}
              <a href="/companies" className="hover:underline" style={{ color: "var(--accent)" }}>
                /companies
              </a>
              .
            </li>
            <li>
              A scan has run — hit <strong>Scan ads</strong> above. Scanning on{" "}
              <a href="/landing" className="hover:underline" style={{ color: "var(--accent)" }}>
                Landing Pages
              </a>{" "}
              fills this queue too; it is the same scrape.
            </li>
          </ol>
          <p className="mt-3">
            This reads the public Ad Library directly, so it needs no Meta credential. The
            paste-back field below is now optional — the scrape usually reads the destination
            URL straight off the ad, and those land on Landing Pages ready to capture.
          </p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left muted text-xs border-b" style={{ borderColor: "var(--border)" }}>
                <th className="px-3 py-2 font-normal">Ad</th>
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
                  <td className="px-3 py-2">
                    {hook.creativeUrl ? (
                      <a
                        href={hook.snapshotUrl ?? hook.creativeUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={
                          hook.creativeAdId
                            ? `Library ID ${hook.creativeAdId} — open in Ad Library`
                            : "Open in Ad Library"
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={hook.creativeUrl}
                          alt=""
                          width={64}
                          height={64}
                          loading="lazy"
                          className="rounded object-cover"
                          style={{ width: 64, height: 64, background: "var(--panel-2)" }}
                        />
                      </a>
                    ) : (
                      <div
                        className="rounded flex items-center justify-center muted"
                        style={{ width: 64, height: 64, background: "var(--panel-2)", fontSize: 10 }}
                        title="No creative stored for this hook yet"
                      >
                        no art
                      </div>
                    )}
                  </td>
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
                    <span className="inline-block ml-2 align-middle">
                      <RowDelete
                        title="Dismiss this hook. It stays dismissed through future scans."
                        armedLabel="Dismiss?"
                        onConfirm={async () => {
                          try {
                            await deleteJson(`/api/hooks/${hook.id}`);
                            setHooks((prev) => prev.filter((h) => h.id !== hook.id));
                          } catch (err) {
                            notify(errorMessage(err));
                          }
                        }}
                      />
                    </span>
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
