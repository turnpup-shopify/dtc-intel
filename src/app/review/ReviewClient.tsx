"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErrorPanel from "@/components/ErrorPanel";
import WhyEmpty from "@/components/WhyEmpty";
import { useRefreshOnFocus } from "@/hooks/useRefreshOnFocus";
import { errorMessage, getJson, postJson } from "@/lib/client";

interface ReviewItem {
  id: string;
  url: string;
  title: string | null;
  companyName: string | null;
  stars: number;
  source: string | null;
  scores: Record<string, number> | null;
  compositeScore: number | null;
  whyGood: string | null;
  screenshotUrl: string | null;
  tags: string[];
  blocks: { id: string; block_type: string; content: string; position: number }[];
}

const SCORE_LABELS: Record<string, string> = {
  claim_specificity: "Claim specificity",
  proof_density: "Proof density",
  objection_handling: "Objection handling",
  offer_clarity: "Offer clarity",
  voice_distinctiveness: "Voice distinctiveness",
  structural_craft: "Structural craft",
};

const BLOCK_COLORS: Record<string, string> = {
  hero: "#6ee7b7",
  subhead: "#93c5fd",
  benefit: "#c4b5fd",
  proof: "#fbbf24",
  objection: "#fca5a5",
  cta: "#f0abfc",
  guarantee: "#5eead4",
  offer: "#fdba74",
  faq: "#a5b4fc",
  other: "#8b94a3",
};

/**
 * The core loop. Three keystrokes for a page you like, under 30 seconds.
 * Pending count and nothing else — a stats dashboard here is a trap.
 */
export default function ReviewClient() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [pending, setPending] = useState(0);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [submitUrl, setSubmitUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const shotRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const current = items[index];

  /**
   * `silent` skips the loading flag so a background refresh doesn't blank the
   * screen. Without it, refreshing on focus replaced the whole table with
   * "Loading…", the page collapsed to one line, the browser scrolled to the top,
   * and any button mid-click was unmounted before it fired.
   */
  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const data = await getJson<{ items: ReviewItem[]; pending: number }>("/api/queue");
      setItems(data.items ?? []);
      setPending(data.pending ?? 0);
      setIndex(0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void getJson<{ tags: string[] }>("/api/library")
      .then((d) => setKnownTags(d.tags ?? []))
      .catch(() => undefined);
  }, [load]);

  // Pages arrive here from Landing Pages, the sitemap cron and paste-back, so a
  // queue fetched once on mount goes stale the moment you capture anything.
  //
  // Only auto-refresh an EMPTY queue, though. That is the case worth fixing —
  // you captured elsewhere and came back to what looks like nothing. Reloading
  // while someone is working the queue would swap the card under their cursor
  // mid-keystroke, which is a worse bug than a slightly stale list.
  useRefreshOnFocus(() => {
    if (items.length === 0) return load({ silent: true });
  });

  useEffect(() => {
    shotRef.current?.scrollTo({ top: 0 });
  }, [index]);

  const notify = (message: string) => {
    setFlash(message);
    setTimeout(() => setFlash(null), 1400);
  };

  const patch = (id: string, changes: Partial<ReviewItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)));

  const decide = useCallback(
    async (status: "saved" | "discarded") => {
      const item = items[index];
      if (!item) return;

      // Optimistic: drop it from the queue immediately so the loop never waits.
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setPending((p) => Math.max(0, p - 1));
      setIndex((i) => Math.min(i, Math.max(0, items.length - 2)));
      notify(status === "saved" ? `Saved · ${item.stars}★` : "Discarded");

      try {
        await postJson(`/api/pages/${item.id}/review`, {
          status,
          stars: item.stars,
          tags: item.tags,
        });
      } catch (err) {
        // Put it back rather than losing the decision silently.
        setItems((prev) => [item, ...prev]);
        setPending((p) => p + 1);
        setIndex(0);
        notify(`Save failed: ${errorMessage(err)}`);
      }
    },
    [items, index]
  );

  const setStars = useCallback(
    (stars: number) => {
      if (!current) return;
      patch(current.id, { stars });
    },
    [current]
  );

  const addTag = useCallback(
    (raw: string) => {
      if (!current) return;
      const label = raw
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (!label || current.tags.includes(label)) return;
      patch(current.id, { tags: [...current.tags, label] });
      if (!knownTags.includes(label)) setKnownTags((t) => [...t, label].sort());
    },
    [current, knownTags]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (inField) {
        if (e.key === "Escape") {
          setTagging(false);
          setTagDraft("");
          (target as HTMLInputElement).blur();
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case "s":
          e.preventDefault();
          void decide("saved");
          break;
        case "x":
          e.preventDefault();
          void decide("discarded");
          break;
        case "0":
        case "1":
        case "2":
        case "3":
          e.preventDefault();
          setStars(Number(e.key));
          break;
        case "t":
          e.preventDefault();
          setTagging(true);
          setTimeout(() => tagInputRef.current?.focus(), 0);
          break;
        case "j":
          e.preventDefault();
          setIndex((i) => Math.min(i + 1, items.length - 1));
          break;
        case "k":
          e.preventDefault();
          setIndex((i) => Math.max(i - 1, 0));
          break;
        case " ":
          e.preventDefault();
          shotRef.current?.scrollBy({
            top: (shotRef.current.clientHeight ?? 400) * 0.85,
            behavior: "smooth",
          });
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, setStars, items.length]);

  const tagSuggestions = useMemo(() => {
    if (!tagDraft) return [];
    const q = tagDraft.toLowerCase();
    return knownTags.filter((t) => t.includes(q) && !current?.tags.includes(t)).slice(0, 6);
  }, [tagDraft, knownTags, current]);

  async function submitManualUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!submitUrl.trim()) return;
    setSubmitting(true);

    let body: { unchanged?: boolean; status?: string; composite?: number };
    try {
      body = await postJson("/api/pages", { url: submitUrl.trim() });
    } catch (err) {
      setSubmitting(false);
      notify(errorMessage(err));
      return;
    }
    setSubmitting(false);

    if (body.unchanged) notify("Unchanged since last capture");
    else if (body.status === "discarded")
      notify(`Auto-rejected · ${body.composite?.toFixed(2)} below threshold`);
    else notify(`Queued · ${body.composite?.toFixed(2)}`);

    setSubmitUrl("");
    void load();
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 3rem)" }}>
      <div
        className="flex items-center gap-4 px-4 py-2 border-b text-sm"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="font-medium">
          {pending} pending
          {items.length > 0 && (
            <span className="muted font-normal">
              {" "}
              · {index + 1}/{items.length}
            </span>
          )}
        </span>

        <form onSubmit={submitManualUrl} className="flex gap-2 flex-1 max-w-xl">
          <input
            className="flex-1 text-sm"
            placeholder="Paste a landing page URL…"
            value={submitUrl}
            onChange={(e) => setSubmitUrl(e.target.value)}
          />
          <button
            type="submit"
            disabled={submitting}
            className="text-sm px-3 rounded disabled:opacity-50"
            style={{ background: "var(--panel-2)" }}
          >
            {submitting ? "Capturing…" : "Capture"}
          </button>
        </form>

        {flash && (
          <span className="text-sm" style={{ color: "var(--accent)" }}>
            {flash}
          </span>
        )}

        <button
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto text-xs px-2.5 py-1 rounded disabled:opacity-50"
          style={{ background: "var(--panel-2)" }}
          title="Re-read the queue. It also refreshes whenever this tab regains focus."
        >
          {loading ? "…" : "Refresh"}
        </button>

        <span className="muted text-xs flex gap-2 items-center">
          <kbd>S</kbd> save <kbd>X</kbd> discard <kbd>0-3</kbd> stars <kbd>T</kbd> tag{" "}
          <kbd>J</kbd>/<kbd>K</kbd> nav <kbd>␣</kbd> scroll
        </span>
      </div>

      {error ? (
        <ErrorPanel error={error} onRetry={() => void load()} />
      ) : loading ? (
        <p className="muted p-6 text-sm">Loading queue…</p>
      ) : !current ? (
        <div className="p-8">
          <WhyEmpty screen="review" />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Screenshot — scrollable, Space pages down */}
          <div
            ref={shotRef}
            className="w-1/2 overflow-y-auto border-r"
            style={{ borderColor: "var(--border)", background: "#000" }}
          >
            {current.screenshotUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={current.screenshotUrl} alt="" className="w-full block" />
            ) : (
              <div className="p-6 muted text-sm">
                No screenshot captured for this page. The scrape adapter either
                doesn&apos;t produce one (SCRAPER_PROVIDER=fetch) or the upload failed.
              </div>
            )}
          </div>

          {/* Extracted blocks + scores + rationale */}
          <div className="w-1/2 overflow-y-auto">
            <div className="p-4 border-b" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">
                  {current.companyName ?? "Unknown brand"}
                </span>
                <span className="muted text-xs">{current.source}</span>
                <span className="ml-auto text-lg tabular-nums">
                  {current.compositeScore?.toFixed(2) ?? "—"}
                </span>
              </div>
              <a
                href={current.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs muted hover:underline break-all block mt-1"
              >
                {current.url}
              </a>
              {current.whyGood && (
                <p className="mt-3 text-sm" style={{ color: "var(--accent)" }}>
                  {current.whyGood}
                </p>
              )}
            </div>

            <div
              className="grid grid-cols-3 gap-px p-px border-b"
              style={{ borderColor: "var(--border)", background: "var(--border)" }}
            >
              {Object.entries(SCORE_LABELS).map(([key, label]) => (
                <div key={key} className="px-3 py-2" style={{ background: "var(--panel)" }}>
                  <div className="muted text-[10px] uppercase tracking-wide">{label}</div>
                  <div className="text-base tabular-nums">{current.scores?.[key] ?? "—"}</div>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => setStars(n)}
                    className="w-7 h-7 rounded text-sm"
                    style={{
                      background: current.stars === n ? "var(--accent)" : "var(--panel-2)",
                      color: current.stars === n ? "#08130e" : "var(--muted)",
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-1 items-center flex-1">
                {current.tags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() =>
                      patch(current.id, { tags: current.tags.filter((t) => t !== tag) })
                    }
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ background: "var(--panel-2)" }}
                    title="Click to remove"
                  >
                    {tag}
                  </button>
                ))}
                {tagging && (
                  <div className="relative">
                    <input
                      ref={tagInputRef}
                      className="text-xs w-40"
                      placeholder="tag + Enter"
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onBlur={() => setTimeout(() => setTagging(false), 120)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag(tagDraft);
                          setTagDraft("");
                        }
                      }}
                    />
                    {tagSuggestions.length > 0 && (
                      <div
                        className="absolute z-10 mt-1 panel text-xs w-40 overflow-hidden"
                        style={{ background: "var(--panel-2)" }}
                      >
                        {tagSuggestions.map((s) => (
                          <button
                            key={s}
                            className="block w-full text-left px-2 py-1 hover:bg-white/5"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              addTag(s);
                              setTagDraft("");
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => void decide("saved")}
                className="text-xs px-3 py-1.5 rounded font-medium"
                style={{ background: "var(--accent)", color: "#08130e" }}
              >
                Save
              </button>
              <button
                onClick={() => void decide("discarded")}
                className="text-xs px-3 py-1.5 rounded"
                style={{ background: "var(--panel-2)" }}
              >
                Discard
              </button>
            </div>

            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {current.blocks.map((block) => (
                <div key={block.id} className="px-4 py-3">
                  <span
                    className="text-[10px] uppercase tracking-wide"
                    style={{ color: BLOCK_COLORS[block.block_type] ?? "var(--muted)" }}
                  >
                    {block.block_type}
                  </span>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{block.content}</p>
                </div>
              ))}
              {current.blocks.length === 0 && (
                <p className="muted text-sm px-4 py-6">No blocks extracted.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
