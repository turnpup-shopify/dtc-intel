"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/client";

interface State {
  companiesMapped: number | null;
  landingPages: number | null;
  pagesQueued: number | null;
  pagesSaved: number | null;
  pagesDiscarded: number | null;
}

/**
 * Explains an empty screen instead of just reporting one.
 *
 * "Queue empty" and "Nothing saved yet" are indistinguishable from a broken
 * app. There are five quite different reasons either screen can be blank —
 * nothing scanned, scanned but not captured, captured but all auto-discarded,
 * captured and waiting, or genuinely all caught up — and each has a different
 * next action. The counts already exist on /api/diagnostics, so the screen can
 * simply say which one you're in.
 *
 * Capture in particular is the step people miss: scanning fills worklists, it
 * does not fill the archive.
 */
export default function WhyEmpty({ screen }: { screen: "review" | "library" }) {
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await getJson<{ state: State }>("/api/diagnostics");
        setState(data.state);
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  if (failed || !state) {
    return (
      <p className="muted text-sm">
        {screen === "review" ? "Queue empty." : "Nothing saved yet."}
      </p>
    );
  }

  const { title, body, cta } = diagnose(state, screen);

  return (
    <div className="text-sm" style={{ maxWidth: "62ch" }}>
      <p>{title}</p>
      <p className="muted mt-1">{body}</p>
      {cta && (
        <p className="mt-3">
          <a href={cta.href} className="hover:underline" style={{ color: "var(--accent)" }}>
            {cta.label} →
          </a>
        </p>
      )}
    </div>
  );
}

function diagnose(s: State, screen: "review" | "library") {
  const captured = (s.pagesQueued ?? 0) + (s.pagesSaved ?? 0) + (s.pagesDiscarded ?? 0);

  if ((s.companiesMapped ?? 0) === 0) {
    return {
      title: "No brand has a meta_page_id yet.",
      body: "Nothing can be scanned until at least one brand is mapped to its Ad Library page.",
      cta: { href: "/companies", label: "Add one on Companies" },
    };
  }

  if ((s.landingPages ?? 0) === 0) {
    return {
      title: "Nothing has been scanned yet.",
      body: "Scanning reads each brand's live ads and collects the landing pages they point at.",
      cta: { href: "/landing", label: "Scan on Landing Pages" },
    };
  }

  if (captured === 0) {
    return {
      title: `${s.landingPages} landing pages found, none captured yet.`,
      body:
        "Capturing is a separate step from scanning: it fetches each page, scores the copy, " +
        "and puts it in the review queue. Nothing reaches Review or Library until then.",
      cta: { href: "/landing", label: "Hit Capture on Landing Pages" },
    };
  }

  if ((s.pagesQueued ?? 0) === 0 && (s.pagesSaved ?? 0) === 0) {
    return {
      title: `All ${s.pagesDiscarded} captured pages scored below the threshold.`,
      body:
        "They were fetched and scored, then auto-discarded before reaching this queue. That gate " +
        "is deliberate, but if it is rejecting everything, lower SCORE_THRESHOLD (default 2.5).",
      cta: { href: "/diagnostics", label: "Check the run log" },
    };
  }

  if (screen === "library" && (s.pagesQueued ?? 0) > 0) {
    return {
      title: `${s.pagesQueued} pages are waiting in Review.`,
      body:
        "Nothing reaches Library on its own — a page has to be saved in Review first. Search only " +
        "covers saved pages too, so the queue is a blind spot until it is worked.",
      cta: { href: "/review", label: "Work the queue" },
    };
  }

  if (screen === "review") {
    return {
      title: "Queue empty — everything captured has been reviewed.",
      body: `${s.pagesSaved} saved, ${s.pagesDiscarded} discarded. Scan and capture more to refill it.`,
      cta: { href: "/landing", label: "Capture more on Landing Pages" },
    };
  }

  return {
    title: "Nothing saved yet.",
    body: "Pages you save in Review show up here and become searchable.",
    cta: { href: "/review", label: "Go to Review" },
  };
}
