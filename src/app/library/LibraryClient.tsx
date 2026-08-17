"use client";

import { useCallback, useEffect, useState } from "react";
import ErrorPanel from "@/components/ErrorPanel";
import WhyEmpty from "@/components/WhyEmpty";
import { errorMessage, getJson } from "@/lib/client";

interface LibraryPage {
  id: string;
  url: string;
  title: string | null;
  companyName: string | null;
  stars: number;
  notes: string | null;
  compositeScore: number | null;
  whyGood: string | null;
  capturedAt: string | null;
  tags: string[];
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

export default function LibraryClient() {
  const [pages, setPages] = useState<LibraryPage[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [company, setCompany] = useState("");
  const [tag, setTag] = useState("");
  const [blockType, setBlockType] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (company) params.set("company", company);
    if (tag) params.set("tag", tag);
    if (blockType) params.set("block_type", blockType);

    setError(null);
    try {
      const data = await getJson<{ pages: LibraryPage[]; tags: string[] }>(
        `/api/library?${params}`
      );
      setPages(data.pages ?? []);
      setTags(data.tags ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [company, tag, blockType]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void getJson<{ companies: Company[] }>("/api/companies")
      .then((d) => setCompanies(d.companies ?? []))
      .catch(() => undefined);
  }, []);

  if (error) return <ErrorPanel error={error} onRetry={() => void load()} />;

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3 text-sm">
        <h1 className="font-medium mr-2">Library</h1>

        <select value={company} onChange={(e) => setCompany(e.target.value)} className="text-xs">
          <option value="">All brands</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select value={tag} onChange={(e) => setTag(e.target.value)} className="text-xs">
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select value={blockType} onChange={(e) => setBlockType(e.target.value)} className="text-xs">
          <option value="">Any block type</option>
          {BLOCK_TYPES.map((b) => (
            <option key={b} value={b}>
              contains {b}
            </option>
          ))}
        </select>

        <span className="muted text-xs ml-auto">{pages.length} saved</span>
      </div>

      {loading ? (
        <p className="muted text-sm">Loading…</p>
      ) : pages.length === 0 ? (
        <WhyEmpty screen="library" />
      ) : (
        <div className="grid gap-2">
          {pages.map((page) => (
            <div key={page.id} className="panel px-4 py-3">
              <div className="flex items-baseline gap-2">
                <span className="tabular-nums text-sm" style={{ color: "var(--accent)" }}>
                  {"★".repeat(page.stars)}
                  <span className="muted">{"☆".repeat(3 - page.stars)}</span>
                </span>
                <span className="text-sm font-medium">{page.companyName ?? "Unknown"}</span>
                <span className="muted text-xs truncate">{page.title}</span>
                <span className="ml-auto muted text-xs tabular-nums">
                  {page.compositeScore?.toFixed(2) ?? "—"}
                </span>
              </div>

              {page.whyGood && <p className="text-sm mt-1.5">{page.whyGood}</p>}

              <div className="flex items-center gap-2 mt-2">
                <a
                  href={page.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs muted hover:underline truncate max-w-md"
                >
                  {page.url}
                </a>
                <div className="flex gap-1 ml-auto">
                  {page.tags.map((t) => (
                    <span
                      key={t}
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: "var(--panel-2)" }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
