import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  getAdminPassword,
  getAdminSecret,
  createSessionToken,
  safeEqual,
} from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/admin/login — exchange the shared admin password for a signed
// session cookie.
export async function POST(request: Request) {
  const password = getAdminPassword();
  const secret = getAdminSecret();
  if (!password || !secret) {
    return NextResponse.json(
      { error: "Admin is not configured. Set ADMIN_PASSWORD." },
      { status: 503 },
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const provided = typeof body.password === "string" ? body.password : "";
  if (!provided || !safeEqual(provided, password)) {
    return NextResponse.json(
      { error: "Incorrect password." },
      { status: 401 },
    );
  }

  const token = await createSessionToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return res;
}
