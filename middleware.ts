import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_COOKIE,
  getAdminSecret,
  verifySessionToken,
} from "@/lib/auth";

// ---------------------------------------------------------------------------
// Protects the admin dashboard and admin-only API routes.
//
// - Public (customer) routes are never matched here.
// - If no ADMIN_PASSWORD is configured: allow in development (so the dashboard
//   is usable out of the box) but lock down in production.
// - Otherwise require a valid signed session cookie; page requests redirect to
//   the login screen, API requests get a 401.
// ---------------------------------------------------------------------------

const PROTECTED_API_PREFIXES = [
  "/api/submissions",
  "/api/feedback",
  "/api/heuristic",
];

function isProtected(pathname: string): boolean {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  return PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow the login page and its API.
  if (pathname === "/admin/login" || pathname.startsWith("/api/admin/")) {
    return NextResponse.next();
  }

  if (!isProtected(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  const secret = getAdminSecret();

  // Not configured: open in dev, locked in prod.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      if (isApi) {
        return NextResponse.json(
          { error: "Admin is not configured. Set ADMIN_PASSWORD." },
          { status: 503 },
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("setup", "1");
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  const ok = await verifySessionToken(secret, token);
  if (ok) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/admin/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/submissions/:path*",
    "/api/feedback/:path*",
    "/api/heuristic/:path*",
  ],
};
