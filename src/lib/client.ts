"use client";

import { log } from "./logbook";

/**
 * Every screen fetches through this.
 *
 * A bare `await res.json()` on a failed request throws on an empty or HTML
 * error body, which skips the caller's `setLoading(false)` and leaves the UI
 * stuck on "Loading…" with nothing to diagnose from. This always resolves to
 * either data or a readable Error.
 */
export async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const message = `Could not reach ${url} — is the dev server still running?`;
    log("network", url, message, err instanceof Error ? err.message : String(err));
    throw new Error(message);
  }
  return parse<T>(res, url);
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = `Could not reach ${url} — is the dev server still running?`;
    log("network", url, message, err instanceof Error ? err.message : String(err));
    throw new Error(message);
  }
  return parse<T>(res, url);
}

export async function deleteJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "DELETE" });
  } catch (err) {
    const message = `Could not reach ${url} — is the dev server still running?`;
    log("network", url, message, err instanceof Error ? err.message : String(err));
    throw new Error(message);
  }
  return parse<T>(res, url);
}

async function parse<T>(res: Response, url: string): Promise<T> {
  const raw = await res.text();

  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Non-JSON body — an HTML error page or an empty 500.
    }
  }

  if (!res.ok) {
    const message =
      (parsed as { error?: string } | null)?.error ??
      (raw ? raw.slice(0, 200) : `${url} returned ${res.status} with an empty body`);
    // Recorded here rather than at each call site: every screen funnels through
    // this, so one hook catches all of them and none can forget.
    log("api", url, message, `HTTP ${res.status}${raw ? ` · ${raw.slice(0, 400)}` : ""}`);
    throw new Error(message);
  }

  if (parsed === null) throw new Error(`${url} returned a non-JSON response`);
  return parsed as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
