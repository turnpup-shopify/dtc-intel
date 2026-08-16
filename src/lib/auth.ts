import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export const AUTH_COOKIE = "dtc_intel_auth";

/**
 * Single-tenant shared-password gate. Not multi-tenancy, not roles — just a
 * lock on the front door, because the whole app runs on the service-role key
 * and would otherwise be world-readable on a Vercel URL.
 *
 * Leave APP_PASSWORD unset to disable the gate entirely.
 */
export function authEnabled(): boolean {
  return env.appPassword.length > 0;
}

export function expectedToken(): string {
  return createHash("sha256").update(`dtc-intel:${env.appPassword}`).digest("hex");
}

/** Guards /api/cron/*. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function cronRequestIsAuthorized(request: Request): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
