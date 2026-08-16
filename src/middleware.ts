import { NextResponse, type NextRequest } from "next/server";

const AUTH_COOKIE = "dtc_intel_auth";

/**
 * Front-door gate. Runs on the edge runtime, so it uses Web Crypto rather than
 * node:crypto (see src/lib/auth.ts for the Node-side equivalent — the token
 * formula must stay identical between the two).
 *
 * Cron routes carry their own bearer check and are exempt.
 */
async function expectedToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`dtc-intel:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/cron/") ||
    pathname === "/login" ||
    pathname === "/api/login"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (token && token === (await expectedToken(password))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
