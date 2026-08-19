"use client";

/**
 * An in-browser record of everything that went wrong.
 *
 * Server logs live in Vercel, which is the wrong place to look when a screen
 * misbehaves in front of you — and the run log lives in Postgres, which is no
 * help at all when the problem IS the database. This buffer needs neither: it
 * records in the tab, survives a reload, and can be read while everything else
 * is failing.
 *
 * Deliberately capped and local. It is a black box recorder for the last few
 * dozen faults, not an analytics pipeline, and nothing here is sent anywhere.
 */

export type LogKind = "api" | "network" | "crash" | "note";

export interface LogEntry {
  at: string;
  kind: LogKind;
  /** What the person was doing — usually the route that failed. */
  where: string;
  message: string;
  /** Status code, response body, stack — whatever the source had. */
  detail?: string;
}

const KEY = "dtc-intel.logbook.v1";
const MAX = 60;

let memory: LogEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Quota or private mode. The in-memory copy still works for this session.
  }
}

function hydrate() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = JSON.parse(raw) as LogEntry[];
  } catch {
    memory = [];
  }
}

export function log(kind: LogKind, where: string, message: string, detail?: string) {
  if (typeof window === "undefined") return;
  hydrate();

  const entry: LogEntry = {
    at: new Date().toISOString(),
    kind,
    where,
    message: String(message).slice(0, 500),
    detail: detail ? String(detail).slice(0, 1500) : undefined,
  };

  // Collapse an identical fault repeating within a few seconds. A failing
  // screen that retries on focus would otherwise bury everything before it.
  const last = memory[0];
  if (last && last.kind === kind && last.where === where && last.message === entry.message) {
    if (Date.now() - new Date(last.at).getTime() < 5000) return;
  }

  memory = [entry, ...memory].slice(0, MAX);
  persist();
  listeners.forEach((fn) => fn());
}

export function entries(): LogEntry[] {
  hydrate();
  return memory;
}

export function clear() {
  memory = [];
  persist();
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Catch what never reaches a try/catch — a render that throws, a promise
 * nobody awaited. Installed once, from the layout.
 */
export function installGlobalHandlers() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __dtcLogbookInstalled?: boolean };
  if (w.__dtcLogbookInstalled) return;
  w.__dtcLogbookInstalled = true;

  window.addEventListener("error", (e) => {
    log("crash", location.pathname, e.message, e.error?.stack);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { message?: string; stack?: string } | string | undefined;
    const message = typeof reason === "string" ? reason : reason?.message ?? "unhandled rejection";
    log("crash", location.pathname, message, typeof reason === "object" ? reason?.stack : undefined);
  });
}
