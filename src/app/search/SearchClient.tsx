"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ErrorPanel from "@/components/ErrorPanel";
import { errorMessage, getJson } from "@/lib/client";

interface Result {
  blockId: string;
  pageId: string;
  blockType: string;
  content: string;
  companyName: string | null;
  pageUrl: string;
  pageTitle: string | null;
  stars: number;
  whyGood: string | null;
  compositeScore: number | null;
}

interface Company {
  id: string;
  name: string;
}

const BLOCK_TYPES = [
  "hero",
  "subhead",
  "benefit",
  "proof",
  "objection",
  "cta",
  "guarantee",
  "offer",
  "faq",
  "other",
];

/**
 * The product is retrieval. Results are blocks, not pages — when you're writing
 * a hero you want thirty heroes, each linking back to its parent page.
 */
export default function SearchClient() {
  const [query, setQuery] = useState("");
  const [blockType, setBlockType] = useState("");
  const [company, setCompany] = useState("");
  const [minStars, setMinStars] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (blockType) params.set("block_type", blockType);
    if (company) params.set("company", company);
    if (minStars) params.set("min_stars", String(minStars));

    setError(null);
    try {
      const data = await getJson<{ results: Result[] }>(`/api/search?${params}`);
      setResults(data.results ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [query, blockType, company, minStars]);

  useEffect(() => {
    inputRef.current?.focus();
    void getJson<{ companies: Company[] }>("/api/companies")
      .then((d) => setCompanies(d.companies ?? []))
      .catch(() => undefined);
  }, []);

  // Debounce so typing feels live without hammering the RPC.
  useEffect(() => {
    const t = setTimeout(() => void run(), 220);
    return () => clearTimeout(t);
  }, [run]);

  async function copy(result: Result) {
    await navigator.clipboard.writeText(result.content);
    setCopied(result.blockId);
    setTimeout(() => setCopied(null), 1200);
  }

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-3">
        <input
          ref={inputRef}
          className="flex-1 max-w-2xl text-sm"
          placeholder="money back guarantee…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={blockType} onChange={(e) => setBlockType(e.target.value)} className="text-xs">
          <option value="">Any block</option>
          {BLOCK_TYPES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select value={company} onChange={(e) => setCompany(e.target.value)} className="text-xs">
          <option value="">Any brand</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={minStars}
          onChange={(e) => setMinStars(Number(e.target.value))}
          className="text-xs"
        >
          <option value={0}>Any stars</option>
          <option value={1}>1★+</option>
          <option value={2}>2★+</option>
          <option value={3}>3★</option>
        </select>
      </div>

      <p className="muted text-xs mb-3">
        {loading ? "Searching…" : `${results.length} blocks`}
      </p>

      {error && <ErrorPanel error={error} onRetry={() => void run()} />}

      <div className="grid gap-2">
        {results.map((r) => (
          <div key={r.blockId} className="panel px-4 py-3">
            <div className="flex items-baseline gap-2 text-xs">
              <span style={{ color: "var(--accent)" }}>{r.blockType}</span>
              <span className="muted">{r.companyName ?? "Unknown"}</span>
              <span className="muted">{"★".repeat(r.stars)}</span>
              <button
                onClick={() => void copy(r)}
                className="ml-auto muted hover:underline"
              >
                {copied === r.blockId ? "copied" : "copy"}
              </button>
              <a
                href={r.pageUrl}
                target="_blank"
                rel="noreferrer"
                className="muted hover:underline"
              >
                source ↗
              </a>
            </div>
            <p className="text-sm mt-1.5 whitespace-pre-wrap">{r.content}</p>
            {r.whyGood && (
              <p className="muted text-xs mt-1.5 italic">{r.whyGood}</p>
            )}
          </div>
        ))}
      </div>

      {!loading && results.length === 0 && (
        <p className="muted text-sm">
          No matches. Search covers saved pages only — discarded and unreviewed pages are
          deliberately invisible here.
        </p>
      )}
    </div>
  );
}
