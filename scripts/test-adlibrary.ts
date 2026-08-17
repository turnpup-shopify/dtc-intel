/**
 * Tests for the Ad Library extraction chain.
 *
 * Run: npm run test:adlibrary
 *
 * These cover the layer that can be tested without Meta: URL unwrapping, the
 * dedupe key, page typing, within-run collapsing, and count reconciliation.
 * Every failure mode below is one that produces confidently wrong data rather
 * than an error, which is exactly why they are pinned here.
 */

import { parseAdLibrary, destinationFrom } from "../src/lib/adlibrary/parse";
import { normalizeDestination, classify } from "../src/lib/adlibrary/normalize";
import { collapse, reconcile } from "../src/lib/adlibrary/aggregate";

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${name}\n     expected: ${e}\n     actual:   ${a}`);
}

/** Meta's real shape: obfuscated rotating class names, deep nesting, l.php CTA. */
function card(libraryId: string, href: string | null, extra = "") {
  const anchor = href ? `<a class="x1i10hfl xjbqb8w" href="${href}">Shop now</a>` : "";
  return `
    <div class="x1lliihq xjkvuk6">
      <div class="x78zum5 xdt5ytf">
        <div class="_7jvw x2izyaf">
          <span class="x8t9es0">Library ID: ${libraryId}</span>
          <div class="x1n2onr6">${anchor}${extra}</div>
        </div>
      </div>
    </div>`;
}

function wrap(u: string) {
  return `https://l.facebook.com/l.php?u=${encodeURIComponent(u)}&h=AT1xyz&__tn__=-UK-R`;
}

// ── The wrapper trick ────────────────────────────────────────────────────────
check(
  "unwraps l.php destination",
  destinationFrom([wrap("https://drinkag1.com/products/gummies")]),
  "https://drinkag1.com/products/gummies"
);

check(
  "prefers the l.php wrapper over a bare Meta link",
  destinationFrom(["https://www.facebook.com/AG1", wrap("https://drinkag1.com/")]),
  "https://drinkag1.com/"
);

check(
  "falls back to the first non-Meta anchor when no wrapper is present",
  destinationFrom(["https://www.facebook.com/AG1", "https://instagram.com/ag1", "https://hiya.co/vitamins"]),
  "https://hiya.co/vitamins"
);

check("returns null when every anchor is Meta's", destinationFrom(["https://www.facebook.com/AG1"]), null);
check("survives a malformed href", destinationFrom(["javascript:void(0)", "#"]), null);

// Single vs double decode. `searchParams.get()` already decodes once; decoding
// again turns an encoded ampersand into a real delimiter and silently splits
// one query param into two.
check(
  "decodes the wrapper exactly once",
  destinationFrom([wrap("https://shop.com/p?a=1%26b=2")]),
  "https://shop.com/p?a=1%26b=2"
);

// ── Dedupe key ───────────────────────────────────────────────────────────────
const variants = [
  "https://www.drinkag1.com/Products/Gummies/?fbclid=IwAR_unique_per_impression",
  "https://drinkag1.com/products/gummies",
  "https://drinkag1.com/products/gummies/",
  "http://www.drinkag1.com/products/gummies?fbclid=different",
];
check(
  "fbclid, www, casing and trailing slash all collapse to one key",
  Array.from(new Set(variants.map((v) => normalizeDestination(v)!.key))),
  ["drinkag1.com/products/gummies"]
);

check(
  "a genuinely different path stays distinct",
  normalizeDestination("https://drinkag1.com/products/travel-packs")!.key,
  "drinkag1.com/products/travel-packs"
);

check("homepage normalizes to bare host", normalizeDestination("https://www.drinkag1.com/")!.key, "drinkag1.com");
check(
  "percent-encoded path decodes before comparison",
  normalizeDestination("https://shop.com/Products%2FGummies")!.key,
  "shop.com/products/gummies"
);
check(
  "meaningful params are kept out of the key but retained",
  normalizeDestination("https://hiya.co/pages/lp?utm_content=v2&fbclid=xyz&variant=b")!.params,
  { utm_content: "v2", variant: "b" }
);
check("rejects non-http schemes", normalizeDestination("mailto:hi@ag1.com"), null);

// ── Page typing ──────────────────────────────────────────────────────────────
check("types by first segment only", [
  classify("drinkag1.com", ""),
  classify("drinkag1.com", "/products/gummies"),
  classify("drinkag1.com", "/collections/all"),
  classify("drinkag1.com", "/pages/lp-2b"),
  classify("drinkag1.com", "/quiz/start"),
  classify("drinkag1.com", "/blogs/news/why-greens"),
  classify("instagram.com", "/drinkag1"),
  classify("drinkag1.com", "/checkout/thanks"),
], ["homepage", "pdp", "collection", "landing page", "quiz", "article", "social profile", "other"]);

// ── Parsing a page ───────────────────────────────────────────────────────────
const html = `<html><body>
  <div class="xrvj5dj"><span>~7 results</span></div>
  <div class="x1hq5gj4">
    ${card("1010101010101", wrap("https://drinkag1.com/products/gummies?fbclid=a"))}
    ${card("2020202020202", wrap("https://www.drinkag1.com/Products/Gummies/?fbclid=b"))}
    ${card("3030303030303", wrap("https://drinkag1.com/products/gummies/"))}
    ${card("4040404040404", wrap("https://drinkag1.com/pages/quiz"))}
    ${card("5050505050505", null)}
    <div class="outer-wrapper-around-one-card">${card("6060606060606", wrap("https://drinkag1.com/"))}</div>
  </div>
</body></html>`;

const parsed = parseAdLibrary(html);
check("finds every card exactly once (innermost wins)", parsed.cards.map((c) => c.libraryId).sort(), [
  "1010101010101", "2020202020202", "3030303030303", "4040404040404", "5050505050505", "6060606060606",
]);
check("reads Meta's own result estimate", parsed.estimate, 7);
check("builds a snapshot permalink", parsed.cards[0].snapshotUrl, "https://www.facebook.com/ads/library/?id=1010101010101");
check("a card with no outbound link yields null", parsed.cards.find((c) => c.libraryId === "5050505050505")!.destinationUrl, null);

// ── Within-run collapse (stage one of the merge) ─────────────────────────────
const rows = collapse(parsed.cards);
check("collapses 6 ads into 3 unique landing pages", rows.length, 3);
check(
  "counts ads per page, busiest first",
  rows.map((r) => [r.key, r.adCount]),
  [["drinkag1.com/products/gummies", 3], ["drinkag1.com/pages/quiz", 1], ["drinkag1.com", 1]]
);
check("carries the page type through", rows.map((r) => r.pageType), ["pdp", "landing page", "homepage"]);

// ── Reconciliation ───────────────────────────────────────────────────────────
check("full harvest is complete", reconcile(113, 113).completeness, "complete");
check("the stall case is caught", reconcile(80, 120).completeness, "short");
check("slight overshoot still counts as complete", reconcile(115, 113).completeness, "complete");
check("a missing estimate is never silently trusted", reconcile(80, null).completeness, "unverified");

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  ✗ ${f}\n`);
process.exit(failures.length ? 1 : 0);
