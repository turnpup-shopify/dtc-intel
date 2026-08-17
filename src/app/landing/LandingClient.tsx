"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ErrorPanel from "@/components/ErrorPanel";
import { errorMessage, getJson, postJson } from "@/lib/client";

interface Company {
  id: string;
  name: string;
  meta_page_id: string | null;
  active: boolean;
}

interface LandingPage {
  id: string;
  url: string;
  page_type: string;
  first_seen: string;
  last_seen: string;
  runs_seen: number;
  ad_records_latest: number;
  ad_records_total: number;
  example_ad_url: string | null;
  params: Record<string, string>;
  company_id: string;
  companyName: string | null;
}

interface HarvestResponse {
  company: string;
  adLibraryUrl: string;
  cardsHarvested: number;
  estimate: number | null;
  estimateSource: "api" | "page" | "none";
  countError: string | null;
  completeness: "complete" | "short" | "unverified";
  warning: string | null;
  withDestination: number;
  withoutDestination: number;
  inserted: number;
  updated: number;
  retired: number;
  rows: { key: string }[];
  diagnostics: {
    htmlBytes: number;
    sawLibraryIdMarker: boolean;
    sawResultsText: boolean;
    redirectorLinks: number;
    bodyTextSample: string;
  } | null;
}

interface ScanRow {
  company: string;
  status: "pending" | "running" | "done" | "error";
  result?: HarvestResponse;
  error?: string;
}

const PAGE_TYPES = [
  "homepage",
  "pdp",
  "collection",
  "landing page",
  "quiz",
  "article",
  "social profile",
  "other",
];

/**
 * Unique landing pages, harvested from the Ad Library web UI.
 *
 * Scanning is driven from the browser one brand at a time rather than from a
 * single server call. Scrolling a busy advertiser to the bottom takes most of a
 * minute, so a loop over seventeen brands would blow the serverless ceiling
 * mid-run; this way each brand commits its own results and you watch it happen.
 */
export default function LandingClient() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [capturing, setCapturing] = useState<Set<string>>(new Set());
  const [captured, setCaptured] = useState<Record<string, string>>({});

  const [brandFilter, setBrandFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [liveOnly, setLiveOnly] = useState(false);

  const scannable = useMemo(
    () => companies.filter((c) => c.meta_page_id && c.active),
    [companies]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, p] = await Promise.all([
        getJson<{ companies: Company[] }>("/api/companies"),
        getJson<{ pages: LandingPage[] }>("/api/landing"),
      ]);
      setCompanies(c.companies ?? []);
      setPages(p.pages ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function scanAll(targets: Company[]) {
    if (!targets.length || scanning) return;
    setScanning(true);
    setScan(targets.map((t) => ({ company: t.name, status: "pending" as const })));

    for (let i = 0; i < targets.length; i++) {
      setScan((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "running" } : r)));
      try {
        const result = await postJson<HarvestResponse>("/api/landing/harvest", {
          companyId: targets[i].id,
        });
        setScan((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "done", result } : r))
        );
      } catch (err) {
        setScan((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: "error", error: errorMessage(err) } : r
          )
        );
      }
    }

    setScanning(false);
    await load();
  }

  /**
   * Push landing pages into the review pipeline — the step paste-back used to
   * do by hand. Batched at four because each page costs a scrape plus a scoring
   * pass, and a serverless function will not sit through more than that.
   */
  async function capture(ids: string[]) {
    const queue = ids.filter((id) => !capturing.has(id));
    if (queue.length === 0) return;
    setCapturing((prev) => new Set([...prev, ...queue]));

    for (let i = 0; i < queue.length; i += 4) {
      const batch = queue.slice(i, i + 4);
      try {
        const res = await postJson<{
          results: { id: string; ok: boolean; status?: string; composite?: number; error?: string }[];
        }>("/api/landing/capture", { ids: batch });

        setCaptured((prev) => {
          const next = { ...prev };
          for (const r of res.results ?? []) {
            next[r.id] = r.ok
              ? r.status === "discarded"
                ? `rejected ${r.composite?.toFixed(2) ?? ""}`
                : `queued ${r.composite?.toFixed(2) ?? ""}`
              : (r.error ?? "failed");
          }
          return next;
        });
      } catch (err) {
        const message = errorMessage(err);
        setCaptured((prev) => {
          const next = { ...prev };
          for (const id of batch) next[id] = message;
          return next;
        });
      } finally {
        setCapturing((prev) => {
          const next = new Set(prev);
          for (const id of batch) next.delete(id);
          return next;
        });
      }
    }
  }

  const visible = pages.filter((p) => {
    if (brandFilter && p.company_id !== brandFilter) return false;
    if (typeFilter && p.page_type !== typeFilter) return false;
    if (liveOnly && p.ad_records_latest === 0) return false;
    return true;
  });

  const suspect = scan.filter(
    (r) => r.result && r.result.completeness !== "complete"
  );

  if (error) return <ErrorPanel error={error} onRetry={() => void load()} />;

  return (
    <div className="p-4">
      <div className="flex items-baseline gap-3 mb-3">
        <h1 className="text-sm font-medium">Landing pages</h1>
        <span className="muted text-xs">
          Unique destinations pulled out of each brand&apos;s live ads. Deduped on host + path,
          so <code>fbclid</code> can&apos;t split one page into hundreds.
        </span>
        <button
          onClick={() => void capture(visible.filter((p) => p.ad_records_latest > 0).map((p) => p.id))}
          disabled={capturing.size > 0 || visible.length === 0}
          className="text-xs px-3 py-1.5 rounded ml-auto disabled:opacity-50 whitespace-nowrap"
          style={{ background: "var(--panel-2)" }}
          title="Scrape and score every listed page that is still running ads"
        >
          {capturing.size > 0 ? `Capturing ${capturing.size}…` : "Capture live pages"}
        </button>
        <button
          onClick={() => void scanAll(scannable)}
          disabled={scanning || scannable.length === 0}
          className="text-xs px-3 py-1.5 rounded disabled:opacity-50 whitespace-nowrap"
          style={{ background: "var(--accent)", color: "#08130e" }}
        >
          {scanning ? "Scanning…" : `Scan all ${scannable.length}`}
        </button>
      </div>

      {scan.length > 0 && (
        <div className="panel p-3 mb-3 text-xs">
          {suspect.length > 0 && (
            <p className="mb-2" style={{ color: "var(--warn)" }}>
              {suspect.length} brand{suspect.length === 1 ? "" : "s"} came back unverified or
              short — Meta&apos;s lazy-loader stalls silently, so those counts are a floor, not a
              total. Re-scan before trusting them.
            </p>
          )}
          <table className="w-full">
            <thead>
              <tr className="text-left muted">
                <th className="font-normal py-1">Brand</th>
                <th className="font-normal py-1 text-right">Ads</th>
                <th className="font-normal py-1 text-right">Meta says</th>
                <th className="font-normal py-1 text-right">Unique pages</th>
                <th className="font-normal py-1 text-right">New</th>
                <th className="font-normal py-1">State</th>
              </tr>
            </thead>
            <tbody>
              {scan.map((r) => (
                <tr key={r.company} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1 pr-3">{r.company}</td>
                  <td className="py-1 text-right tabular-nums">
                    {r.result ? r.result.cardsHarvested : "—"}
                  </td>
                  <td className="py-1 text-right tabular-nums muted">
                    {r.result?.estimate ?? "—"}
                  </td>
                  <td className="py-1 text-right tabular-nums">{r.result?.rows.length ?? "—"}</td>
                  <td className="py-1 text-right tabular-nums">
                    {r.result ? `+${r.result.inserted}` : "—"}
                  </td>
                  <td className="py-1" style={{ color: stateColor(r) }}>
                    {stateLabel(r)}
                    {r.result?.diagnostics && (
                      <div className="mt-1 font-mono muted" style={{ fontSize: 11 }}>
                        {explainDiagnostics(r.result.diagnostics)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 text-xs">
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="text-xs"
        >
          <option value="">All brands</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="text-xs">
          <option value="">All page types</option>
          {PAGE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 muted">
          <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
          running now
        </label>
        <span className="muted ml-auto tabular-nums">
          {visible.length} unique page{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <p className="muted text-sm">Loading…</p>
      ) : pages.length === 0 ? (
        <div className="muted text-sm">
          <p>Nothing harvested yet. This tab reads the Ad Library&apos;s public web pages, not
          the API — the API has no destination-URL field, which is why the hooks queue needs a
          human. Here the landing page is sitting in the CTA link itself.</p>
          <p className="mt-2">
            You need a brand with a <code>meta_page_id</code> and a JS-rendering scraper
            (<code>SCRAPER_PROVIDER=scrapingbee</code> or <code>scrapfly</code>). Then hit{" "}
            <strong>Scan all</strong>. {scannable.length} brand
            {scannable.length === 1 ? " is" : "s are"} ready.
          </p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left muted text-xs border-b"
                style={{ borderColor: "var(--border)" }}
              >
                <th className="px-3 py-2 font-normal">Brand</th>
                <th className="px-3 py-2 font-normal">Landing page</th>
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal text-right" title="Ads pointing here in the most recent scan">
                  Ads now
                </th>
                <th className="px-3 py-2 font-normal text-right" title="Cumulative ad sightings across every scan">
                  Total
                </th>
                <th className="px-3 py-2 font-normal text-right">Runs</th>
                <th className="px-3 py-2 font-normal">Last seen</th>
                <th className="px-3 py-2 font-normal">Ad</th>
                <th className="px-3 py-2 font-normal">Archive</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-3 py-2 whitespace-nowrap">{p.companyName ?? "—"}</td>
                  <td className="px-3 py-2 max-w-lg">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline break-all"
                      style={{ color: "var(--accent)" }}
                    >
                      {p.url.replace(/^https:\/\//, "")}
                    </a>
                    {Object.keys(p.params).length > 0 && (
                      <span className="muted text-xs block">
                        {Object.entries(p.params)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap muted text-xs">{p.page_type}</td>
                  <td
                    className="px-3 py-2 text-right tabular-nums"
                    style={{ color: p.ad_records_latest === 0 ? "var(--muted)" : undefined }}
                  >
                    {p.ad_records_latest}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums muted">{p.ad_records_total}</td>
                  <td className="px-3 py-2 text-right tabular-nums muted">{p.runs_seen}</td>
                  <td className="px-3 py-2 whitespace-nowrap muted text-xs">
                    {p.last_seen.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    {p.example_ad_url ? (
                      <a
                        href={p.example_ad_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs hover:underline"
                        style={{ color: "var(--accent)" }}
                      >
                        open ↗
                      </a>
                    ) : (
                      <span className="muted text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {captured[p.id] ? (
                      <span
                        className="text-xs"
                        style={{
                          color: /queued/.test(captured[p.id]) ? "var(--accent)" : "var(--muted)",
                        }}
                      >
                        {captured[p.id]}
                      </span>
                    ) : (
                      <button
                        onClick={() => void capture([p.id])}
                        disabled={capturing.has(p.id)}
                        className="text-xs px-2 py-1 rounded disabled:opacity-40"
                        style={{ background: "var(--panel-2)" }}
                        title="Scrape this page, score it, and put it in the review queue"
                      >
                        {capturing.has(p.id) ? "…" : "Capture"}
                      </button>
                    )}
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

/**
 * Turn the raw markers into the actual diagnosis.
 *
 * "Unverified" and "zero pages" have two very different causes that look
 * identical from outside: the parser stopped matching Meta's markup, or the
 * scrape never reached the real page. These markers tell them apart, so say
 * which one it is rather than printing booleans at someone.
 */
function explainDiagnostics(d: NonNullable<HarvestResponse["diagnostics"]>): string {
  if (d.htmlBytes < 20_000) {
    return `Only ${d.htmlBytes} bytes came back — that is not the Ad Library. Page began: "${d.bodyTextSample.slice(0, 120)}"`;
  }
  if (!d.sawLibraryIdMarker) {
    return `Full page received (${Math.round(d.htmlBytes / 1024)}kb) but no "Library ID" anywhere — either a block/consent page, or Meta renamed the marker. Page began: "${d.bodyTextSample.slice(0, 120)}"`;
  }
  if (d.redirectorLinks === 0) {
    return `Cards present but zero outbound l.php links — CTAs did not render. Try a longer initial wait.`;
  }
  return `${Math.round(d.htmlBytes / 1024)}kb, ${d.redirectorLinks} outbound links found${
    d.sawResultsText ? "" : ", no count text on page"
  }.`;
}

function stateLabel(r: ScanRow): string {
  if (r.status === "pending") return "queued";
  if (r.status === "running") return "scanning…";
  if (r.status === "error") return r.error ?? "failed";
  if (!r.result) return "done";
  if (r.result.completeness === "short") return "SHORT — loader stalled";
  if (r.result.completeness === "unverified")
    return r.result.countError
      ? `unverified — the Ad Library API refused the count: ${r.result.countError}`
      : r.result.estimateSource === "none"
        ? "unverified — no META_ACCESS_TOKEN set, and no count on the page"
        : "unverified — no count available";
  return `complete · ${r.result.withoutDestination} ads had no link`;
}

function stateColor(r: ScanRow): string {
  if (r.status === "error") return "var(--danger)";
  if (r.result && r.result.completeness !== "complete") return "var(--warn)";
  return "var(--muted)";
}
