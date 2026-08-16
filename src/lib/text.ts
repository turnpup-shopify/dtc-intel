import * as cheerio from "cheerio";
import { createHash } from "node:crypto";

/**
 * Text reduction (spec §6.3).
 *
 * Strip nav/footer/script/style/cookie banners/chat widgets. Preserve DOM order
 * and heading levels — hierarchy is signal for block classification, so headings
 * come out as `## Heading` markers rather than bare lines.
 */

const DROP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "template",
  "nav",
  "footer",
  "header nav",
  "[role='navigation']",
  "[role='banner'] nav",
  "[aria-hidden='true']",
  // cookie / consent
  "#onetrust-consent-sdk",
  ".ot-sdk-container",
  "#cookie-banner",
  "[id*='cookie' i][class*='banner' i]",
  "[class*='cookie-consent' i]",
  "[class*='cookie-notice' i]",
  "[id*='gdpr' i]",
  // chat widgets / launchers
  "[id*='intercom' i]",
  "[class*='intercom' i]",
  "[id*='drift' i]",
  "[id*='zendesk' i]",
  "[id*='gorgias' i]",
  "[class*='gorgias' i]",
  "[id*='tidio' i]",
  "[class*='chat-widget' i]",
  "[class*='livechat' i]",
  // misc chrome
  "[class*='skip-to-content' i]",
  "[class*='announcement-bar' i]",
  "[class*='breadcrumb' i]",
];

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "li",
  "td",
  "th",
  "blockquote",
  "figcaption",
  "dd",
  "dt",
  "button",
  "a",
  "label",
  "summary",
]);

export interface ReducedPage {
  text: string;
  title: string | null;
  contentHash: string;
}

export function reduceHtml(html: string): ReducedPage {
  const $ = cheerio.load(html);

  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    null;

  for (const sel of DROP_SELECTORS) {
    try {
      $(sel).remove();
    } catch {
      // A malformed selector shouldn't kill the whole reduction.
    }
  }

  const lines: string[] = [];

  const push = (raw: string) => {
    const clean = raw.replace(/\s+/g, " ").trim();
    if (!clean) return;
    // Drop single stray punctuation and other non-copy noise.
    if (clean.length < 2) return;
    lines.push(clean);
  };

  const root = $("main").length ? $("main") : $("body");

  root.find("*").each((_, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    if (!tag) return;

    const node = $(el);

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const text = node.text().replace(/\s+/g, " ").trim();
      if (text) push(`${"#".repeat(level)} ${text}`);
      return;
    }

    if (!BLOCK_TAGS.has(tag)) return;

    // Only take text owned directly by this node, so parents don't duplicate
    // everything their children already contributed.
    const own = node
      .contents()
      .filter((_i, c) => c.type === "text")
      .text();
    push(own);
  });

  // Alt text on hero imagery is often real copy.
  root.find("img[alt]").each((_, el) => {
    const alt = $(el).attr("alt")?.trim();
    if (alt && alt.length > 15) push(`[image: ${alt}]`);
  });

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }

  const text = deduped.join("\n");
  return { text, title, contentHash: sha256(text) };
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Normalize an ad headline (spec §6.5 step 4): trim, collapse whitespace,
 * strip emoji, lowercase. Observed titles often repeat the same headline with
 * ` | ` separators, so dedupe segments before normalizing.
 */
export function normalizeLinkTitle(raw: string | null | undefined): string {
  if (!raw) return "";

  const segments = raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  const uniqueSegments: string[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    const key = seg.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSegments.push(seg);
  }

  return uniqueSegments
    .join(" | ")
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
      ""
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The prettiest observed variant of a headline, for display. */
export function displayLinkTitle(raw: string | null | undefined): string {
  if (!raw) return "";
  const segments = raw
    .split("|")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique = segments.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return unique.join(" | ");
}
