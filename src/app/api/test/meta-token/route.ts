import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { fetchActiveAdCount } from "@/lib/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Transparent Labs. Any real page_id works; this one just needs no setup. */
const PROBE_PAGE_ID = "916973588364925";

/**
 * POST /api/test/meta-token — does the configured Meta credential actually work?
 *
 * Costs nothing and scrapes nothing. It makes the smallest possible Ad Library
 * call and reports either the count or Meta's verbatim refusal.
 *
 * The reason this is worth its own endpoint: the app now accepts an app id +
 * secret in place of a token, because Meta's app access token is just
 * "{app-id}|{app-secret}". Being able to CONSTRUCT that token says nothing
 * about whether ads_archive will honour it, and the only authority on that
 * question is Meta. So ask Meta, and print exactly what it says.
 *
 * Deliberately does not echo the credential back, only which variable supplied it.
 */
export async function POST() {
  const source = env.metaTokenSource;

  if (!env.metaToken) {
    return NextResponse.json({
      ok: false,
      source,
      verdict: "No Meta credential configured.",
      detail:
        "Set META_ACCESS_TOKEN, or META_APP_ID and META_APP_SECRET together, then redeploy.",
    });
  }

  try {
    const result = await fetchActiveAdCount(PROBE_PAGE_ID);
    return NextResponse.json({
      ok: true,
      source,
      verdict: `Working. Meta reports ${result?.count ?? 0} active US ads for the probe page${
        result?.capped ? " (hit the pagination ceiling, so the real total is higher)" : ""
      }.`,
      count: result?.count ?? null,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: false,
      source,
      verdict: "Meta rejected the credential.",
      detail,
      // The two refusals worth telling apart, because only one is fixable by
      // swapping credential type.
      hint: /app|capability|permission|ads_read|OAuth|token/i.test(detail)
        ? "This reads like a token-type or permission problem. ads_archive may not accept an app token — a User or System User token with ads_read is the usual fix."
        : "This does not look like a token-type problem. Read Meta's message above literally.",
    });
  }
}
