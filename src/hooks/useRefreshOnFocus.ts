"use client";

import { useEffect, useRef } from "react";

/**
 * Re-run a loader when the tab regains focus.
 *
 * These screens fetch once on mount, which is wrong for a queue that other
 * screens write into. Capture a page on Landing Pages, switch to Review, and
 * the client router can hand back the component it already had — so you are
 * looking at a fetch from before the row existed, and the queue appears empty
 * when it isn't. Nothing says it is stale; it just looks broken.
 *
 * Throttled, because focus fires on every alt-tab and a refresh here costs
 * several queries.
 */
export function useRefreshOnFocus(load: () => void | Promise<void>, minIntervalMs = 3000) {
  const lastRun = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const maybeRun = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRun.current < minIntervalMs) return;
      lastRun.current = now;
      void loadRef.current();
    };

    window.addEventListener("focus", maybeRun);
    document.addEventListener("visibilitychange", maybeRun);
    return () => {
      window.removeEventListener("focus", maybeRun);
      document.removeEventListener("visibilitychange", maybeRun);
    };
  }, [minIntervalMs]);
}
