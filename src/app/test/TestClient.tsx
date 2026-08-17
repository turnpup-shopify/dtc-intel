"use client";

import { useState } from "react";
import { errorMessage, postJson } from "@/lib/client";

/** Transparent Labs — the brand we're debugging against. */
const DEFAULT_URL =
  "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US" +
  "&is_targeted_country=false&media_type=all&search_type=page" +
  "&sort_data[direction]=desc&sort_data[mode]=total_impressions&view_all_page_id=916973588364925";

interface TestResult {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  estimate: number | null;
  cardsFound: number;
  withDestination: number;
  linkShapes: Record<string, number>;
  sampleCards: { libraryId: string; destinationUrl: string | null }[];
  domAroundFirstCard: string | null;
  diagnostics: {
    htmlBytes: number;
    sawLibraryIdMarker: boolean;
    sawResultsText: boolean;
    redirectorLinks: number;
    bodyTextSample: string;
  };
}

/**
 * A scratchpad for one advertiser. Writes nothing, merges nothing.
 *
 * The harvester's failures all look the same from the outside, so this shows
 * the evidence instead of a verdict: what came back, how the links are encoded,
 * and the DOM around a real ad card.
 */
interface TokenCheck {
  ok: boolean;
  source: string;
  verdict: string;
  detail?: string;
  hint?: string;
}

export default function TestClient() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<TokenCheck | null>(null);
  const [checkingToken, setCheckingToken] = useState(false);

  async function checkToken() {
    setCheckingToken(true);
    setToken(null);
    try {
      setToken(await postJson<TokenCheck>("/api/test/meta-token", {}));
    } catch (err) {
      setToken({ ok: false, source: "unknown", verdict: errorMessage(err) });
    } finally {
      setCheckingToken(false);
    }
  }

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await postJson<TestResult>("/api/test/adlibrary", { url }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-sm font-medium">Ad Library test bench</h1>
        <span className="muted text-xs">
          One advertiser, nothing written to the database. Shows what actually came back.
        </span>
      </div>

      <section className="panel p-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void checkToken()}
            disabled={checkingToken}
            className="text-xs px-3 py-1.5 rounded disabled:opacity-50 whitespace-nowrap"
            style={{ background: "var(--panel-2)" }}
          >
            {checkingToken ? "Asking Meta…" : "Check Meta credential"}
          </button>
          <span className="muted text-xs">
            Free. One tiny API call, no scrape credits. Works with either
            META_ACCESS_TOKEN or META_APP_ID + META_APP_SECRET.
          </span>
        </div>

        {token && (
          <div className="mt-3 text-xs space-y-1">
            <div style={{ color: token.ok ? "var(--accent)" : "var(--danger)" }}>
              {token.verdict}
            </div>
            <div className="muted font-mono">using: {token.source}</div>
            {token.detail && (
              <div className="font-mono" style={{ color: "var(--warn)" }}>
                Meta said: {token.detail}
              </div>
            )}
            {token.hint && <div className="muted">{token.hint}</div>}
          </div>
        )}
      </section>

      <div className="panel p-3 space-y-2">
        <label className="muted text-xs block">Ad Library URL</label>
        <textarea
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          rows={3}
          className="w-full text-xs font-mono"
          spellCheck={false}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void run()}
            disabled={running || !url.trim()}
            className="text-xs px-3 py-1.5 rounded disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#08130e" }}
          >
            {running ? "Scraping…" : "Run test"}
          </button>
          <span className="muted text-xs">
            Takes ~30s. Costs one scrape credit.
          </span>
        </div>
      </div>

      {error && (
        <div className="panel p-3 text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <section className="panel p-3">
            <h2 className="text-xs font-medium mb-2">What came back</h2>
            <table className="text-xs">
              <tbody>
                <Row k="HTTP status" v={result.statusCode} />
                <Row k="HTML size" v={`${Math.round(result.diagnostics.htmlBytes / 1024)} kb`} />
                <Row
                  k="final URL"
                  v={result.finalUrl}
                  warn={!result.finalUrl.includes("ads/library")}
                />
                <Row
                  k="cards found"
                  v={result.cardsFound}
                  warn={result.cardsFound === 0}
                />
                <Row
                  k="cards with a link"
                  v={result.withDestination}
                  warn={result.withDestination === 0}
                />
                <Row k="count on page" v={result.estimate ?? "not found"} />
              </tbody>
            </table>
            <p className="muted mt-2" style={{ fontSize: 11 }}>
              Page began: “{result.diagnostics.bodyTextSample.slice(0, 200)}”
            </p>
          </section>

          <section className="panel p-3">
            <h2 className="text-xs font-medium mb-2">
              How links are encoded
              <span className="muted font-normal">
                {" "}
                — whichever is non-zero is what we should be parsing
              </span>
            </h2>
            <table className="text-xs">
              <tbody>
                {Object.entries(result.linkShapes).map(([shape, n]) => (
                  <tr key={shape}>
                    <td className="pr-6 py-0.5 muted font-mono">{shape}</td>
                    <td
                      className="py-0.5 tabular-nums"
                      style={{ color: n > 0 ? "var(--accent)" : "var(--muted)" }}
                    >
                      {n}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {result.sampleCards.length > 0 && (
            <section className="panel p-3">
              <h2 className="text-xs font-medium mb-2">First cards parsed</h2>
              <table className="text-xs w-full">
                <tbody>
                  {result.sampleCards.map((c) => (
                    <tr key={c.libraryId}>
                      <td className="pr-4 py-0.5 muted font-mono">{c.libraryId}</td>
                      <td
                        className="py-0.5 break-all"
                        style={{ color: c.destinationUrl ? undefined : "var(--warn)" }}
                      >
                        {c.destinationUrl ?? "no destination extracted"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="panel p-3">
            <h2 className="text-xs font-medium mb-2">
              DOM around the first card
              <span className="muted font-normal"> — copy this to me if it still fails</span>
            </h2>
            <pre
              className="text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all p-2 rounded"
              style={{ background: "var(--panel-2)", maxHeight: 420, overflowY: "auto" }}
            >
              {result.domAroundFirstCard ?? "No “Library ID” found anywhere in the page."}
            </pre>
          </section>
        </>
      )}
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string | number; warn?: boolean }) {
  return (
    <tr>
      <td className="pr-6 py-0.5 muted align-top">{k}</td>
      <td
        className="py-0.5 font-mono break-all"
        style={{ color: warn ? "var(--warn)" : undefined }}
      >
        {String(v)}
      </td>
    </tr>
  );
}
