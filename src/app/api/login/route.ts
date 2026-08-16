import { NextResponse } from "next/server";
import { AUTH_COOKIE, authEnabled, expectedToken } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authEnabled()) {
    return NextResponse.json({ ok: true, authDisabled: true });
  }

  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!password || password !== env.appPassword) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, expectedToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
