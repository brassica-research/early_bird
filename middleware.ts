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
// Protects the two staff areas — the admin console and the technician app —
// each behind its own signed-cookie gate. Customer routes are never matched.
//
// The admin console can be served from a NON-OBVIOUS slug (ADMIN_BASENAME):
// when set, requests to that slug are gated + rewritten to /admin, while the
// literal /admin path is hidden (404) so it can't be discovered by scanning.
// ---------------------------------------------------------------------------

const ADMIN_BASE = (process.env.ADMIN_BASENAME || "admin").replace(
  /^\/|\/$/g,
  "",
);
const ADMIN_CUSTOM = ADMIN_BASE !== "admin";

interface Gate {
  cookie: string;
  loginPath: string;
  secret: () => string | null;
  notConfiguredMsg: string;
  owns: (pathname: string) => boolean;
}

const GATES: Gate[] = [
  {
    cookie: ADMIN_COOKIE,
    loginPath: `/${ADMIN_BASE}/login`,
    secret: getAdminSecret,
    notConfiguredMsg: "Admin is not configured. Set ADMIN_PASSWORD.",
    owns: (p) => {
      const login = `/${ADMIN_BASE}/login`;
      const inPages =
        p === `/${ADMIN_BASE}` ||
        (p.startsWith(`/${ADMIN_BASE}/`) && p !== login);
      const inApi =
        p.startsWith("/api/submissions") ||
        p.startsWith("/api/feedback") ||
        p.startsWith("/api/heuristic") ||
        (p.startsWith("/api/admin/") &&
          p !== "/api/admin/login" &&
          p !== "/api/admin/logout");
      return inPages || inApi;
    },
  },
  {
    cookie: TECH_COOKIE,
    loginPath: "/tech/login",
    secret: getTechSecret,
    notConfiguredMsg: "Technician access is not configured. Set TECH_PASSCODE.",
    owns: (p) => {
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
      return p === "/tech" || p.startsWith("/tech/") || p.startsWith("/api/tech/");
    },
  },
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Hide the default /admin path when a non-obvious slug is configured.
  if (ADMIN_CUSTOM && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const gate = GATES.find((g) => g.owns(pathname));
  if (!gate) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  const secret = gate.secret();

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

// Run on everything except Next internals and static assets (the matcher must
// be static, so we can't name the configurable admin slug here — the gate
// logic above matches it at runtime and no-ops on everything else).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
