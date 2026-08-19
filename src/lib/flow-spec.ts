/**
 * THE LIVING SPEC.
 *
 * This is the source of truth for how the app is supposed to work, and it ships
 * inside the app so it cannot rot in a document nobody opens. It renders in the
 * hamburger menu on every screen.
 *
 * KEEP IT CURRENT: when you change what a stage does, edit it here in the same
 * commit. A spec that lags the code is worse than none — it teaches people the
 * wrong model and they debug against it.
 */

export const SPEC_UPDATED = "2026-08-19";

export interface Stage {
  id: string;
  title: string;
  /** Where the person actually clicks. */
  where: string;
  /** One line: what this stage is for. */
  purpose: string;
  /** What happens, in order. */
  steps: string[];
  /** Tables it writes. */
  writes: string[];
  /** The way this stage disappoints you, and what it means. */
  gotcha?: string;
}

export const STAGES: Stage[] = [
  {
    id: "brands",
    title: "1 · Add a brand",
    where: "Companies",
    purpose: "Point the app at a competitor's Ad Library page.",
    steps: [
      "Add the brand, or use one already seeded.",
      "Paste its meta_page_id — the number in the Ad Library URL after view_all_page_id=. The field also accepts the whole URL.",
      "Use “Find it” to open the Ad Library pre-searched for that brand.",
    ],
    writes: ["companies"],
    gotcha:
      "A brand with no meta_page_id is inert. It will never be scanned, and nothing will say so beyond the greyed-out Scan button.",
  },
  {
    id: "scan",
    title: "2 · Scan for landing pages",
    where: "Companies → Scan all / Scan selected / Scan ads",
    purpose: "Find every page the brand is currently sending ad traffic to.",
    steps: [
      "Scan all does every mapped brand; tick rows and Scan selected does just those; Scan ads on a row does one. Same job either way, run one brand at a time.",
      "Scrolls the brand's public Ad Library page with a JS-rendering scraper.",
      "Reads each ad's destination out of Meta's l.php link wrapper — no Meta API, no credential.",
      "Dedupes on host + path, so one page counts once no matter how many ads point at it.",
      "Also builds the hooks queue from the same scrape, and stores one creative image per hook.",
    ],
    writes: ["landing_pages", "ads", "ad_hooks"],
    gotcha:
      "Scanning fills worklists. It does NOT put anything in Review or Library — that is the next stage, and it is the step most people miss.",
  },
  {
    id: "capture",
    title: "3 · Capture into the pipeline",
    where: "Landing Pages → Capture, or Capture live pages",
    purpose: "Turn a URL into scored, structured copy.",
    steps: [
      "Fetches the landing page and reduces it to text.",
      "Claude segments the copy into blocks and scores six dimensions.",
      "Composite below SCORE_THRESHOLD is auto-discarded; at or above it is queued for Review.",
    ],
    writes: ["pages", "page_versions", "copy_blocks", "tags"],
    gotcha:
      "“rejected 2.56” is not an error — it is the gate. The gate exists to keep junk out, not to judge quality; that is what stars are for. If everything is rejected, the threshold is too high.",
  },
  {
    id: "review",
    title: "4 · Review",
    where: "Review",
    purpose: "The one human decision, and the only route into the archive.",
    steps: [
      "Opens on a list of everything queued — brand, page, score, stars, why it scored.",
      "Click a row to open it: screenshot, score breakdown, extracted copy blocks. Esc or “← All” goes back.",
      "0–3 stars, tags, then S to save or X to discard.",
      "Saving is what makes a page searchable.",
    ],
    writes: ["pages.status", "pages.stars", "page_tags"],
    gotcha:
      "A queued page is invisible to Search. The queue is not a backlog, it is a blind spot — nothing in it can be found until it is saved.",
  },
  {
    id: "retrieve",
    title: "5 · Library and Search",
    where: "Library, Search",
    purpose: "Get the copy back out. This is the point of the whole system.",
    steps: [
      "Library lists saved pages, best-starred first.",
      "Search runs full text over the copy blocks of saved pages.",
    ],
    writes: [],
    gotcha: "Both read status = 'saved' only. Nothing else exists as far as retrieval is concerned.",
  },
];

export interface AutoJob {
  name: string;
  when: string;
  what: string;
}

export const AUTOMATIC: AutoJob[] = [
  {
    name: "Sitemap diff",
    when: "Weekly, by cron",
    what:
      "Walks each brand's sitemap, diffs against known URLs, and captures what is new — the only tier that produces pages with no human involved. Capped per run so one brand launching forty pages cannot flood the queue.",
  },
  {
    name: "Ad poll",
    when: "Daily, by cron",
    what:
      "The original API-based hook poll. Superseded by scanning, and it needs a Meta User or System User token; an app token is refused. Harmless if it fails.",
  },
];

/** Where to look when something is wrong, in the order worth trying. */
export const DEBUGGING: string[] = [
  "Hamburger → Logs — every failed request, unreachable server and uncaught crash this browser has seen. Survives a reload, needs no database.",
  "Hamburger → Logs → Copy report — config, pipeline counts, missing migrations, recent runs and those faults in one paste. Send this rather than describing the symptom.",
  "Diagnostics — the same picture server-side, plus the run log of every job and which migrations the schema is missing.",
  "An empty Review or Library says WHY it is empty, and links to the fix.",
];

/** Where things vanish without an error. Every one of these is by design. */
export const SILENT_DROPS: string[] = [
  "Scored below SCORE_THRESHOLD — captured, scored, then filed as discarded without ever appearing in Review.",
  "Queued but never saved — in the database, invisible to Search.",
  "No readable headline on an ad — it still becomes a landing page, but never a hook.",
  "Past the sitemap daily cap — deferred to next week's run, not lost.",
  "A landing page you hid, or a hook you dismissed — both survive re-scans on purpose.",
];
