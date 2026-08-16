"use client";

import { useCallback, useEffect, useState } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState({ name: "", domain: "", tier: "direct", category: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/companies");
    const data = await res.json();
    setCompanies(data.companies ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePageId(company: Company) {
    const value = (drafts[company.id] ?? company.meta_page_id ?? "").trim();
    if (value === (company.meta_page_id ?? "")) return;

    const res = await fetch(`/api/companies/${company.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meta_page_id: value }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? "Save failed");
      return;
    }
    setError(null);
    setCompanies((prev) =>
      prev.map((c) => (c.id === company.id ? { ...c, meta_page_id: value || null } : c))
    );
    setSaved((s) => ({ ...s, [company.id]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [company.id]: false })), 1200);
  }

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!adding.name.trim()) return;
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(adding),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not add brand");
      return;
    }
    setAdding({ name: "", domain: "", tier: "direct", category: "" });
    void load();
  }

  const mapped = companies.filter((c) => c.meta_page_id).length;

  return (
    <div className="p-4">
      <div className="flex items-baseline gap-3 mb-3">
        <h1 className="text-sm font-medium">Companies</h1>
        <span className="muted text-xs">
          {mapped}/{companies.length} have a page_id · grab it from the Ad Library URL parameter{" "}
          <code>view_all_page_id</code>
        </span>
        {error && (
          <span className="text-xs" style={{ color: "var(--danger)" }}>
            {error}
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
          <option value="direct">direct</option>
          <option value="adjacent">adjacent</option>
          <option value="copycraft">copycraft</option>
          <option value="advertorial">advertorial</option>
        </select>
        <input
          className="text-xs"
          placeholder="category"
          value={adding.category}
          onChange={(e) => setAdding({ ...adding, category: e.target.value })}
        />
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
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-3 py-1.5 whitespace-nowrap">{c.name}</td>
                  <td className="px-3 py-1.5 muted text-xs">{c.domain ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{c.tier ?? "—"}</td>
                  <td className="px-3 py-1.5 muted text-xs">{c.category ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    <input
                      className="text-xs w-48 font-mono"
                      placeholder="paste page_id"
                      defaultValue={c.meta_page_id ?? ""}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
