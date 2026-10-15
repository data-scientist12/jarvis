import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Optimistic gate: real session validation happens in pages/route handlers.
const PUBLIC = ["/", "/login", "/signup", "/privacy", "/terms"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.includes(pathname) || pathname.startsWith("/api/auth") || pathname.startsWith("/api/cron") || pathname === "/api/device/poll" || pathname === "/api/device/result") {
    return NextResponse.next();
  }
  if (!getSessionCookie(req)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp|webmanifest)$).*)"],
};
