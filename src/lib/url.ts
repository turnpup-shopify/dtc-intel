/**
 * URL normalization (spec §6.2). Applied before any insert or dedup check.
 *
 * 1. Follow redirects; normalize the FINAL url (the caller passes finalUrl).
 * 2. Lowercase host, strip leading `www.`
 * 3. Drop all query params (allowlist below only)
 * 4. Drop fragment
 * 5. Strip trailing slash
 */

/**
 * Params that demonstrably change page content. Deliberately tiny — the spec
 * says allowlist, don't blocklist. Add entries only with evidence.
 */
const PARAM_ALLOWLIST = new Set(["variant", "product", "p"]);

export function normalizeUrl(input: string): string {
  const url = new URL(input.trim());

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";

  const kept: [string, string][] = [];
  url.searchParams.forEach((value, key) => {
    if (PARAM_ALLOWLIST.has(key.toLowerCase())) kept.push([key.toLowerCase(), value]);
  });
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);

  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path;

  // Default ports add nothing.
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  return url.toString();
}

/** Best-effort — returns null instead of throwing on malformed input. */
export function tryNormalizeUrl(input: string): string | null {
  try {
    return normalizeUrl(input);
  } catch {
    return null;
  }
}

export function hostOf(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
