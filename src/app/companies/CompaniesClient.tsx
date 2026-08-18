"use client";

import { useCallback, useEffect, useState } from "react";
import ErrorPanel from "@/components/ErrorPanel";
import RowDelete from "@/components/RowDelete";
import { deleteJson, errorMessage, getJson, postJson } from "@/lib/client";
import { CATEGORIES, TIERS } from "@/lib/categories";
import { adLibrarySearchUrl, extractMetaPageId } from "@/lib/url";

interface Company {
  id: string;
  name: string;
  domain: string | null;
  meta_page_id: string | null;
  tier: string | null;
  category: string | null;
  active: boolean;
}

/**
 * The only manual data entry in the system: pasting a meta_page_id per brand.
 * page_ids come from the Ad Library UI URL parameter `view_all_page_id`; there
 * is no automated resolver. Paste, tab, next.
 */
export default function CompaniesClient() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  /** Blocks the whole screen (load failed). */
  const [error, setError] = useState<string | null>(null);
  /** Inline, non-blocking (a single save failed). */
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState({ name: "", domain: "", tier: "direct", category: "supplements" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson<{ companies: Company[] }>("/api/companies");
      setCompanies(data.companies ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePageId(company: Company) {
    const raw = (drafts[company.id] ?? company.meta_page_id ?? "").trim();

    // Accept a pasted Ad Library URL, not just the bare digits — that URL is
    // what's on the clipboard after clicking through to the advertiser.
    const value = raw ? extractMetaPageId(raw) : "";
    if (raw && !value) {
      setNotice(
        `Couldn't find a page_id in that. Paste the Ad Library URL for ${company.name} ` +
          `(the one containing view_all_page_id=…) or just the numeric id.`
      );
      return;
    }
    if ((value ?? "") === (company.meta_page_id ?? "")) return;

    try {
      await postJson(`/api/companies/${company.id}`, { meta_page_id: value });
    } catch (err) {
      setNotice(errorMessage(err));
      return;
    }

    setNotice(null);
    setDrafts((d) => ({ ...d, [company.id]: value ?? "" }));
    setCompanies((prev) =>
      prev.map((c) => (c.id === company.id ? { ...c, meta_page_id: value || null } : c))
    );
    setSaved((s) => ({ ...s, [company.id]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [company.id]: false })), 1200);
  }

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!adding.name.trim()) return;
    try {
      await postJson("/api/companies", adding);
    } catch (err) {
      setNotice(errorMessage(err));
      return;
    }
    setNotice(null);
    setAdding({ name: "", domain: "", tier: "direct", category: "supplements" });
    void load();
  }

  const mapped = companies.filter((c) => c.meta_page_id).length;

  if (error) return <ErrorPanel error={error} onRetry={() => void load()} />;

  return (
    <div className="p-4">
      <div className="flex items-baseline gap-3 mb-3">
        <h1 className="text-sm font-medium">Companies</h1>
        <span className="muted text-xs">
          {mapped}/{companies.length} have a page_id · click{" "}
          <span style={{ color: "var(--accent)" }}>search Ad Library</span>, open the advertiser,
          then paste that page&apos;s URL back into the field
        </span>
        {notice && (
          <span className="text-xs" style={{ color: "var(--danger)" }}>
            {notice}
          </span>
        )}
      </div>

      <form onSubmit={addCompany} className="flex gap-2 mb-3 text-sm">
        <input
          className="text-xs"
          placeholder="Brand name"
          value={adding.name}
          onChange={(e) => setAdding({ ...adding, name: e.target.value })}
        />
        <input
          className="text-xs"
          placeholder="domain.com"
          value={adding.domain}
          onChange={(e) => setAdding({ ...adding, domain: e.target.value })}
        />
        <select
          className="text-xs"
          value={adding.tier}
          onChange={(e) => setAdding({ ...adding, tier: e.target.value })}
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          className="text-xs"
          value={adding.category}
          onChange={(e) => setAdding({ ...adding, category: e.target.value })}
        >
          <option value="">category…</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="submit" className="text-xs px-3 rounded" style={{ background: "var(--panel-2)" }}>
          Add
        </button>
      </form>

      {loading ? (
        <p className="muted text-sm">Loading…</p>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left muted text-xs border-b" style={{ borderColor: "var(--border)" }}>
                <th className="px-3 py-2 font-normal">Brand</th>
                <th className="px-3 py-2 font-normal">Domain</th>
                <th className="px-3 py-2 font-normal">Tier</th>
                <th className="px-3 py-2 font-normal">Category</th>
                <th className="px-3 py-2 font-normal">meta_page_id</th>
                <th className="px-3 py-2 font-normal">Find it</th>
                <th className="px-3 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-3 py-1.5 whitespace-nowrap">{c.name}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {c.domain ? (
                      <a
                        href={`https://${c.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="muted hover:underline"
                        title={`Open ${c.domain}`}
                      >
                        {c.domain} ↗
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{c.tier ?? "—"}</td>
                  <td className="px-3 py-1.5 muted text-xs">{c.category ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    <input
                      className="text-xs w-56 font-mono"
                      placeholder="id, or paste Ad Library URL"
                      value={drafts[c.id] ?? c.meta_page_id ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                      onBlur={() => void savePageId(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      style={{
                        borderColor: saved[c.id] ? "var(--accent)" : undefined,
                      }}
                    />
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {c.meta_page_id ? (
                      <a
                        href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=${c.meta_page_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs muted hover:underline"
                        title="See this brand's live ads"
                      >
                        view ads ↗
                      </a>
                    ) : (
                      <a
                        href={adLibrarySearchUrl(c.name)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs hover:underline"
                        style={{ color: "var(--accent)" }}
                        title={`Search the Ad Library for ${c.name}, click the advertiser, then paste the URL back`}
                      >
                        search Ad Library ↗
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <RowDelete
                      warn
                      title="Delete this brand. Its ads, hooks and landing pages go with it; captured pages survive but lose their brand label."
                      armedLabel="Delete brand?"
                      onConfirm={async () => {
                        try {
                          const res = await deleteJson<{ orphanedPages: number }>(
                            `/api/companies/${c.id}`
                          );
                          setCompanies((prev) => prev.filter((x) => x.id !== c.id));
                          if (res.orphanedPages > 0) {
                            setError(
                              `Deleted. ${res.orphanedPages} archived page(s) were kept but no longer show a brand.`
                            );
                          }
                        } catch (err) {
                          setError(errorMessage(err));
                        }
                      }}
                    />
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
