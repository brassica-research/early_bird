import { TECH_COOKIE } from "@/lib/auth";
import { noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/logout — clear the technician session cookie.
export async function POST() {
  const res = noStoreJson({ ok: true });
  res.cookies.set(TECH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
