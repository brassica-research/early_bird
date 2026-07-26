import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_COOKIE,
  TECH_COOKIE,
  getAdminSecret,
  getTechSecret,
  verifySessionToken,
} from "@/lib/auth";

// ---------------------------------------------------------------------------
// Protects the two staff areas — the admin dashboard and the technician app —
// each behind its own signed-cookie gate. Customer routes are never matched.
//
// If a gate isn't configured (no password/passcode): open in development so the
// area is usable out of the box, locked in production.
// ---------------------------------------------------------------------------

interface Gate {
  cookie: string;
  loginPath: string;
  secret: () => string | null;
  notConfiguredMsg: string;
  /** True if this gate owns the given path (excluding its own login route). */
  owns: (pathname: string) => boolean;
}

const GATES: Gate[] = [
  {
    cookie: ADMIN_COOKIE,
    loginPath: "/admin/login",
    secret: getAdminSecret,
    notConfiguredMsg: "Admin is not configured. Set ADMIN_PASSWORD.",
    owns: (p) =>
      p === "/admin" ||
      (p.startsWith("/admin/") && p !== "/admin/login") ||
      p.startsWith("/api/submissions") ||
      p.startsWith("/api/feedback") ||
      p.startsWith("/api/heuristic") ||
      (p.startsWith("/api/admin/") &&
        p !== "/api/admin/login" &&
        p !== "/api/admin/logout"),
  },
  {
    cookie: TECH_COOKIE,
    loginPath: "/tech/login",
    secret: getTechSecret,
    notConfiguredMsg: "Technician access is not configured. Set TECH_PASSCODE.",
    owns: (p) => {
      // Public (unauthenticated) technician auth surfaces.
      const PUBLIC = new Set([
        "/tech/login",
        "/tech/register",
        "/tech/forgot",
        "/tech/reset",
        "/api/tech/login",
        "/api/tech/register",
        "/api/tech/forgot",
        "/api/tech/reset",
      ]);
      if (PUBLIC.has(p)) return false;
      return (
        p === "/tech" ||
        p.startsWith("/tech/") ||
        p.startsWith("/api/tech/")
      );
    },
  },
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const gate = GATES.find((g) => g.owns(pathname));
  if (!gate) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  const secret = gate.secret();

  // Not configured: open in dev, locked in prod.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      if (isApi) {
        return NextResponse.json(
          { error: gate.notConfiguredMsg },
          { status: 503 },
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = gate.loginPath;
      url.searchParams.set("setup", "1");
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(gate.cookie)?.value;
  if (await verifySessionToken(secret, token)) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = gate.loginPath;
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/tech/:path*",
    "/api/submissions/:path*",
    "/api/feedback/:path*",
    "/api/heuristic/:path*",
    "/api/admin/:path*",
    "/api/tech/:path*",
  ],
};
